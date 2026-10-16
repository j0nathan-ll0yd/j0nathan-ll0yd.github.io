// Theatre Reviews in a data state (atlas decision 0160, PR B, owner decision 2026-10-16).
//
// The design system renders the review cards with one markup function, `theatreCardsHtml`, for the
// Astro template and the browser updater alike. The edge keeps it the only source of the markup but
// never lets it place a value: it renders the cards from SLOT stand-ins (fixed text and URLs that
// pass the same URL rules as the real ones), so the structure follows the real reviews (a poster or
// none, a grade or none, a link or none) and the strings hold no data. A fill pass then writes the
// real titles, links and image URLs through the text and attribute APIs.
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import type {DashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'
import {safeHttpsUrl} from '@j0nathan-ll0yd/web/runtime/html-utils'
import {sanitizeImageUrl} from '@j0nathan-ll0yd/web/runtime/image-sanitizer'
import {THEATRE_SITE, type TheatreCardReview, theatreCardsHtml, theatreCountLabel} from '@j0nathan-ll0yd/web/runtime/updaters-theatre'
import {type DataState, registerDataState} from '../card-state'
import {fillFragment, setText} from '../fragment'
import {staleTimestampFragment} from '../timestamp'

export const THEATRE_CARD = 'cardTheatreReviews'

type ImageField = 'imageUrl' | 'imageUrlAvif' | 'imageUrlCard' | 'imageUrlCardAvif'
const IMAGE_FIELDS: readonly ImageField[] = ['imageUrl', 'imageUrlAvif', 'imageUrlCard', 'imageUrlCardAvif']

/** A stand-in the image sanitizer accepts, unique per review and field. */
function imageSlot(index: number, field: ImageField): string {
  return `${CLOUDFRONT_BASE}/images/ssr-slot-${index}-${field}`
}
/** A stand-in that is present but that the sanitizer rejects, as the real value is. */
const REJECTED_IMAGE = 'about:blank'
function linkSlot(index: number): string {
  return `https://ssr-slot.invalid/${index}`
}
const REJECTED_LINK = 'http://ssr-slot.invalid/'
const TITLE_SLOT = 'ssr-slot'

type Review = TheatreCardReview

/**
 * The slot stand-in for one review: every string replaced, every presence and every URL verdict
 * kept, so `theatreCardsHtml` takes the same branches it takes for the real review. The grade stays:
 * it selects the grade colour, and the fill pass rewrites its text.
 */
function slotReview(review: Review, index: number): Review {
  const image = (field: ImageField): string | null => {
    const value = review[field]
    if (value === null || value === undefined || value === '') {
      return value ?? null
    }
    return sanitizeImageUrl(value, {onReject: 'omit'}) ? imageSlot(index, field) : REJECTED_IMAGE
  }
  return {
    title: TITLE_SLOT,
    url: review.url ? (safeHttpsUrl(review.url) ? linkSlot(index) : REJECTED_LINK) : review.url,
    rating: review.rating,
    imageUrl: image('imageUrl'),
    imageUrlAvif: image('imageUrlAvif'),
    imageUrlCard: image('imageUrlCard'),
    imageUrlCardAvif: image('imageUrlCardAvif')
  }
}

/** Replaces each slot stand-in in an attribute value with the real value it stands for. */
function realAttribute(value: string, review: Review, index: number): string {
  let out = value
  for (const field of IMAGE_FIELDS) {
    const real = review[field]
    if (real) {
      out = out.split(imageSlot(index, field)).join(real)
    }
  }
  if (review.url) {
    out = out.split(linkSlot(index)).join(review.url)
  }
  return out
}

/** The review cards: the design system's markup for the slots, with the real values written. */
export function theatreCards(reviews: readonly Review[]): Promise<string> {
  let index = -1
  // The review whose card the pass is inside: cards arrive in order, one `a.theatre-card` each.
  const current = (): Review => {
    const review = reviews[index]
    if (!review) {
      throw new Error('theatre card without a review')
    }
    return review
  }
  const rewrite = (attribute: string) => (el: HTMLRewriterElement) => {
    const value = el.getAttribute(attribute)
    if (value !== null) {
      el.setAttribute(attribute, realAttribute(value, current(), index))
    }
  }
  return fillFragment(theatreCardsHtml(reviews.map(slotReview)), (rewriter) =>
    rewriter.on('a.theatre-card', {
      element(el) {
        index++
        rewrite('href')(el)
      }
    }).on('a.theatre-card source', {element: rewrite('srcset')}).on('a.theatre-card img', {
      element(el) {
        rewrite('src')(el)
        rewrite('srcset')(el)
      }
    }).on('a.theatre-card .theatre-grade', {element: (el) => setText(el, current().rating ?? '')}).on('a.theatre-card .theatre-title span', {
      element: (el) => setText(el, current().title)
    }))
}

/** Everything the card needs before the page pass starts. */
export interface TheatreFill {
  cards: string
  staleTimestamp: string | null
}

export async function prepareTheatre(props: DashboardViewModels['theatreReviews'], state: DataState): Promise<TheatreFill> {
  return {cards: await theatreCards(props.reviews ?? []), staleTimestamp: state === 'stale' ? await staleTimestampFragment('', props.generatedAt) : null}
}

export function registerTheatre(rewriter: HTMLRewriter, props: DashboardViewModels['theatreReviews'], state: DataState, fill: TheatreFill): HTMLRewriter {
  registerDataState(rewriter, THEATRE_CARD, state, props.generatedAt ?? null)
  return rewriter.on('#theatreCount', {
    element(el) {
      if (fill.staleTimestamp !== null) {
        el.before(fill.staleTimestamp, {html: true})
      }
      el.tagName = 'a'
      el.setAttribute('href', THEATRE_SITE)
      el.setAttribute('target', '_blank')
      el.setAttribute('rel', 'noopener noreferrer')
      setText(el, theatreCountLabel(props.totalReviews))
    }
  }).on('#theatreRow', {
    element(el) {
      el.removeAttribute('hidden')
      // Markup the design system rendered from slot stand-ins, with every value written through
      // the text and attribute APIs (theatreCards above). It holds no string built from data.
      el.setInnerContent(fill.cards, {html: true})
    }
  })
}
