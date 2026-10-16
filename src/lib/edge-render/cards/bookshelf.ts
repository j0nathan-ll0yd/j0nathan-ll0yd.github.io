// Bookshelf in a data state (atlas decision 0160, PR B, owner decision 2026-10-16).
//
// The design system renders shelf items inline in widgets/reading/Bookshelf.astro; no markup function
// is shared. The build therefore renders that component once more, with value-free SLOT books, into
// two item templates (`reading` with its progress bar, and `shelf` with stars and a finished date,
// both with an AVIF <picture>): src/pages/ssr-templates.astro. Each real book clones its template,
// drops the parts it does not have, and writes its values through the text and attribute APIs.
//
// `bookItemView` restates the item expressions of Bookshelf.astro (the sort, the cover choice, the
// `data-book` record, the labels). tests/oracle pins the result to the Astro render of the same props,
// so a design-system change cannot diverge silently. A `bookshelfItemView` export from the design
// system would remove this restatement (follow-up).
import {SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'
import {a11y, widgets} from '@j0nathan-ll0yd/copy'
import type {DashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'
import {mirroredCoverUrl, PLACEHOLDER_IMAGE_SRC, sanitizeImageUrl} from '@j0nathan-ll0yd/web/runtime/image-utils'
import {formatMonthYear} from '@j0nathan-ll0yd/web/runtime/widget-state'
import {type DataState, dataVariant, registerDataState} from '../card-state'
import {fillFragment, setAttribute, setOptionalAttribute, slotWith, textSlot} from '../fragment'
import {shelfItemKey, type ShelfItemShape} from '../slot-props'
import {templateFor, type Templates} from '../templates'

export const BOOKSHELF_CARD = 'cardBooks'

type BookshelfProps = DashboardViewModels['bookshelf']
type BookEntry = NonNullable<BookshelfProps['books']>['books'][number]

const STATUS_ORDER: Record<string, number> = {reading: 0, upNext: 1, finished: 2}
const SHELF_SIZE = 5
const STARS = [1, 2, 3, 4, 5] as const
/** The page URL the template resolves same-origin covers against (Astro.url of `/`). */
const PAGE_URL = new URL('/', SITE_URL)
const SANITIZER = {baseUrl: PAGE_URL, onReject: 'omit' as const}

/** The books the shelf shows, in its documented order: reading, up next, finished; at most five. */
export function shelfBooks(props: BookshelfProps): BookEntry[] {
  return (props.books?.books ?? []).slice().sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99)).slice(0, SHELF_SIZE)
}

export interface BookItemView {
  reading: boolean
  className: string
  style: string
  dataBook: string
  ariaLabel: string
  imgSrc: string
  imgSrcset: string | null
  avifSrcset: string | null
  fallback: string | null
  title: string
  author: string
  statusClass: string
  statusText: string
  progress: number | null
  rating: number | null
  finishedText: string | null
}

/** One shelf item's values, as Bookshelf.astro computes them. */
export function bookItemView(b: BookEntry, index: number, props: BookshelfProps, localCovers: ReadonlySet<string>): BookItemView {
  const asin = b.asin || b.isbn
  const bookMeta = props.books?.bookMeta ?? {}
  const statusLabels: Record<string, string> = props.books?.statusLabels ?? {}
  const local = (candidate: string | null) => mirroredCoverUrl(candidate, localCovers, SANITIZER)
  const contractCard = sanitizeImageUrl(b.mainImageCard || b.mainImage, SANITIZER)
  const contractThumb = sanitizeImageUrl(b.mainImageThumb || b.mainImage, SANITIZER)
  const contractAvifCard = sanitizeImageUrl(b.mainImageCardAvif || b.mainImageAvif, SANITIZER)
  const contractAvifThumb = sanitizeImageUrl(b.mainImageThumbAvif || b.mainImageAvif, SANITIZER)
  const displayCard = local(contractCard) || contractCard
  const displayThumb = local(contractThumb) || contractThumb
  const imgSrc = displayCard || displayThumb || PLACEHOLDER_IMAGE_SRC
  const displayAvifCard = local(contractAvifCard) || contractAvifCard
  const displayAvifThumb = local(contractAvifThumb) || contractAvifThumb
  const avifSrcset = [displayAvifCard ? `${displayAvifCard} 1x` : null, displayAvifThumb ? `${displayAvifThumb} 2x` : null].filter(Boolean).join(', ') ||
    null
  const meta: Partial<NonNullable<BookshelfProps['books']>['bookMeta'][string]> = (asin ? bookMeta[asin] : undefined) ?? {}
  const reading = b.status === 'reading'
  return {
    reading,
    className: `shelf-book${reading ? ' shelf-book-active' : ''}`,
    style: `animation-delay: ${index * 0.08}s`,
    dataBook: JSON.stringify({
      title: b.title,
      author: b.author,
      asin: asin,
      status: b.status,
      statusLabel: statusLabels[b.status],
      rating: b.rating,
      progress: b.progress,
      link: `https://www.amazon.com/dp/${asin}?tag=lifegames04-20&linkCode=ll2&language=en_US&ref_=as_li_ss_tl`,
      notes: b.notes || null,
      finishedAt: b.finishedAt || null,
      startedAt: b.startedAt || null,
      series: meta.seriesName || null,
      seriesNumber: meta.seriesNumber || null,
      seriesTotal: meta.seriesTotal || null,
      pages: meta.pages || null,
      year: meta.year || null,
      publicationDate: meta.publicationDate || null,
      desc: meta.desc || null,
      genres: meta.genres || [],
      mainImage: sanitizeImageUrl(b.mainImage, {baseUrl: PAGE_URL}),
      mainImageAvif: sanitizeImageUrl(b.mainImageAvif, SANITIZER)
    }),
    ariaLabel: a11y.bookshelf.bookItem.replace('{title}', b.title).replace('{author}', b.author),
    imgSrc,
    imgSrcset: displayCard && displayThumb ? `${displayCard} 1x, ${displayThumb} 2x` : null,
    avifSrcset,
    fallback: imgSrc !== PLACEHOLDER_IMAGE_SRC || avifSrcset ? PLACEHOLDER_IMAGE_SRC : null,
    title: b.title,
    author: b.author,
    statusClass: reading ? 'shelf-book-status shelf-status-reading' : `shelf-book-status shelf-status-${b.status}`,
    statusText: reading ? widgets.bookshelf.statusReading : (statusLabels[b.status] ?? ''),
    progress: b.progress ?? null,
    rating: b.rating ?? null,
    finishedText: !reading && b.status === 'finished' && b.finishedAt
      ? widgets.bookshelf.finishedDate.replace('{date}', formatMonthYear(b.finishedAt))
      : null
  }
}

/** The five stars of a rating: each one's class and glyph, with the template's padding. */
function starSlot(rating: number | null): HTMLRewriterElementHandlers {
  let star = -1
  const on = () => rating !== null && (STARS[star] ?? 0) <= rating
  return slotWith(textSlot(() => (on() ? '★' : '☆')), (el) => {
    star++
    setAttribute(el, 'class', on() ? 'star-on' : 'star-off')
  })
}

/** The item template shape this book takes in Bookshelf.astro. */
function itemShape(view: BookItemView): ShelfItemShape {
  return {
    reading: view.reading,
    measure: view.reading ? view.progress !== null : Boolean(view.rating),
    dated: !view.reading && view.finishedText !== null,
    picture: view.avifSrcset !== null
  }
}

/** One item: its shape's template, with every value written. */
function bookItem(view: BookItemView, templates: Templates): Promise<string> {
  const template = templateFor(templates, BOOKSHELF_CARD, shelfItemKey(itemShape(view)))
  return fillFragment(template, (rewriter) =>
    rewriter.on('li.shelf-book', {
      element(el) {
        setAttribute(el, 'class', view.className)
        setAttribute(el, 'style', view.style)
        setAttribute(el, 'data-book', view.dataBook)
        setAttribute(el, 'aria-label', view.ariaLabel)
      }
    }).on('source', {element: (el) => setOptionalAttribute(el, 'srcset', view.avifSrcset)}).on('img', {
      element(el) {
        setAttribute(el, 'src', view.imgSrc)
        setOptionalAttribute(el, 'srcset', view.imgSrcset)
        setAttribute(el, 'alt', view.title)
        setOptionalAttribute(el, 'data-fallback', view.fallback)
      }
    }).on('.shelf-book-title span', textSlot(view.title)).on('.shelf-book-author', textSlot(view.author)).on('.shelf-book-status',
      slotWith(textSlot(view.statusText), (el) => setAttribute(el, 'class', view.statusClass))).on('.shelf-book-progress-fill', {
        element: (el) => setAttribute(el, 'style', `width: ${view.progress}%`)
      }).on('.shelf-book-progress', textSlot(`${view.progress}%`)).on('.shelf-book-stars span', starSlot(view.rating)).on('.shelf-book-finished-date',
        textSlot(view.finishedText ?? '')))
}

/** The card, filled from its build-time template, with one item per shelf book. */
export async function fillBookshelf(props: BookshelfProps, state: DataState, templates: Templates, localCovers: readonly string[]): Promise<string> {
  const mirrored = new Set(localCovers)
  const items = (await Promise.all(shelfBooks(props).map((b, i) => bookItem(bookItemView(b, i, props, mirrored), templates)))).join('')
  return fillFragment(templateFor(templates, BOOKSHELF_CARD, dataVariant(state, props.generatedAt)),
    (rewriter) =>
      registerDataState(rewriter, BOOKSHELF_CARD, state, props.generatedAt ?? null).on('#dashShelfRow li', {
        element(el) {
          // Items cloned from the design system's templates, every value written through the text and
          // attribute APIs (bookItem above). No string built from data.
          el.replace(items, {html: true})
        }
      }))
}
