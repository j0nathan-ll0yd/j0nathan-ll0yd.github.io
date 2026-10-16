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
import {type DataState, registerDataState} from '../card-state'
import {fillFragment, setOptionalAttribute, setText} from '../fragment'
import {templateFor, type Templates} from '../templates'

export const BOOKSHELF_CARD = 'cardBooks'
/** The two item templates the build renders (src/pages/ssr-templates.astro). */
export const BOOK_ITEM_TEMPLATES = {reading: 'cardBooks:item-reading', shelf: 'cardBooks:item-shelf'} as const

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

/** One item: its template, with the parts the book lacks dropped and every value written. */
function bookItem(view: BookItemView, templates: Templates): Promise<string> {
  const template = templateFor(templates, BOOKSHELF_CARD, view.reading ? 'item-reading' : 'item-shelf')
  let star = 0
  const drop = (el: HTMLRewriterElement) => void el.remove()
  return fillFragment(template, (rewriter) =>
    rewriter.on('li.shelf-book', {
      element(el) {
        el.setAttribute('class', view.className)
        el.setAttribute('style', view.style)
        el.setAttribute('data-book', view.dataBook)
        el.setAttribute('aria-label', view.ariaLabel)
      }
    }).on('picture', {element: (el) => void (view.avifSrcset ? el : el.removeAndKeepContent())}).on('source', {
      element: (el) => void (view.avifSrcset ? el.setAttribute('srcset', view.avifSrcset) : el.remove())
    }).on('img', {
      element(el) {
        el.setAttribute('src', view.imgSrc)
        setOptionalAttribute(el, 'srcset', view.imgSrcset)
        el.setAttribute('alt', view.title)
        setOptionalAttribute(el, 'data-fallback', view.fallback)
      }
    }).on('.shelf-book-title span', {element: (el) => setText(el, view.title)}).on('.shelf-book-author', {element: (el) => setText(el, view.author)}).on(
      '.shelf-book-status',
      {
        element(el) {
          el.setAttribute('class', view.statusClass)
          setText(el, view.statusText)
        }
      }
    ).on('.shelf-book-progress-bar', {element: (el) => void (view.progress === null ? el.remove() : el)}).on('.shelf-book-progress-fill', {
      element: (el) => void el.setAttribute('style', `width: ${view.progress}%`)
    }).on('.shelf-book-progress', {element: (el) => (view.progress === null ? drop(el) : setText(el, `${view.progress}%`))}).on('.shelf-book-stars', {
      element: (el) => void (view.rating ? el : el.remove())
    }).on('.shelf-book-stars span', {
      element(el) {
        const s = STARS[star++] ?? 0
        const on = view.rating !== null && s <= view.rating
        el.setAttribute('class', on ? 'star-on' : 'star-off')
        setText(el, on ? '★' : '☆')
      }
    }).on('.shelf-book-finished-date', {element: (el) => (view.finishedText === null ? drop(el) : setText(el, view.finishedText))}))
}

export async function prepareBookshelf(props: BookshelfProps, templates: Templates, localCovers: readonly string[]): Promise<string> {
  const mirrored = new Set(localCovers)
  const items = await Promise.all(shelfBooks(props).map((b, i) => bookItem(bookItemView(b, i, props, mirrored), templates)))
  return items.join('')
}

export function registerBookshelf(rewriter: HTMLRewriter, props: BookshelfProps, state: DataState, items: string): HTMLRewriter {
  registerDataState(rewriter, BOOKSHELF_CARD, state, props.generatedAt ?? null)
  return rewriter.on('#dashShelfRow', {
    element(el) {
      el.removeAttribute('hidden')
      // Items cloned from the design system's value-free templates, every value written through the
      // text and attribute APIs (bookItem above). No string built from data.
      el.setInnerContent(items, {html: true})
    }
  })
}
