// Value-free stand-in props for the data-state templates (atlas decision 0160, PR B; owner decision
// 2026-10-16, option B). src/pages/ssr-templates.astro renders the design system's components with
// these props at build time. They are not fixtures and not export data: each one only makes a slot
// render, so the template shows the slot's element, attributes and padding. The edge overwrites every
// slot (./cards/), and tests/oracle fails if a stand-in survives into a page.
import {CLOUDFRONT_BASE} from '@j0nathan-ll0yd/portal-contract/constants'
import type {DashboardViewModels} from '@j0nathan-ll0yd/web/runtime/view-models'

/** A valid time a stale template names. The edge overwrites it. */
export const SLOT_TIME = '2000-01-01T00:00:00.000Z'
/** A time no stale "as of" label can show (a stale export whose `generatedAt` does not parse). */
export const SLOT_UNPARSED_TIME = 'ssr-slot'
/** The stand-in text of every text slot. */
export const SLOT_TEXT = 'ssr-slot'

/** The data-state variants a card template covers. */
export type DataVariant = 'live' | 'stale' | 'stale-untimed'
export const DATA_VARIANTS: readonly DataVariant[] = ['live', 'stale', 'stale-untimed']

function stateProps(variant: DataVariant): {state: 'live' | 'stale'; generatedAt: string} {
  if (variant === 'live') {
    return {state: 'live', generatedAt: SLOT_TIME}
  }
  return {state: 'stale', generatedAt: variant === 'stale' ? SLOT_TIME : SLOT_UNPARSED_TIME}
}

const QUANTITY = (value: number) => ({value, unit: SLOT_TEXT})

/** Heart Rate with a reading, or paused (watch off the wrist). */
export function heartRateSlotProps(variant: DataVariant, paused: boolean): DashboardViewModels['heartRate'] {
  return {
    ...stateProps(variant),
    health: {
      quantities: {
        heartRate: QUANTITY(72),
        hrvSDNN: QUANTITY(50),
        restingHeartRate: QUANTITY(60),
        respiratoryRate: QUANTITY(15),
        wristTemperatureDelta: QUANTITY(0.5)
      },
      ...(paused ? {watch: {worn: false, source: 'hrGap' as const}} : {})
    }
  }
}

function slotImage(name: string): string {
  return `${CLOUDFRONT_BASE}/images/ssr-slot-${name}`
}

/** Theatre Reviews with one stand-in review; the edge replaces the card list as a whole. */
export function theatreSlotProps(variant: DataVariant): DashboardViewModels['theatreReviews'] {
  return {
    ...stateProps(variant),
    totalReviews: 1,
    reviews: [{
      title: SLOT_TEXT,
      slug: SLOT_TEXT,
      url: 'https://ssr-slot.invalid/',
      author: SLOT_TEXT,
      publishedAt: SLOT_TIME,
      rating: null,
      ratingNumeric: null,
      excerpt: SLOT_TEXT,
      imageUrl: null,
      imageUrlAvif: null,
      imageUrlCard: null,
      imageUrlCardAvif: null,
      imageWidth: null,
      imageHeight: null
    }]
  }
}

type BookshelfBooks = NonNullable<DashboardViewModels['bookshelf']['books']>
type Book = BookshelfBooks['books'][number]

/** The shapes a shelf item takes in Bookshelf.astro. */
export interface ShelfItemShape {
  reading: boolean
  /** reading: a progress bar; otherwise: a star rating. */
  measure: boolean
  /** Not reading: a finished date. */
  dated: boolean
  /** An AVIF <picture>, or a bare <img>. */
  picture: boolean
}

export function shelfItemKey({reading, measure, dated, picture}: ShelfItemShape): string {
  return `item-${reading ? 'reading' : 'shelf'}-${measure ? 'measured' : 'plain'}${reading ? '' : dated ? '-dated' : '-undated'}-${
    picture ? 'picture' : 'img'
  }`
}

export const SHELF_ITEM_SHAPES: readonly ShelfItemShape[] = [true, false].flatMap((reading) =>
  [true, false].flatMap((measure) =>
    (reading ? [false] : [true, false]).flatMap((dated) => [true, false].map((picture) => ({reading, measure, dated, picture})))
  )
)

function slotBook(shape: ShelfItemShape): Book {
  return {
    asin: SLOT_TEXT,
    title: SLOT_TEXT,
    author: SLOT_TEXT,
    status: shape.reading ? 'reading' : 'finished',
    ...(shape.reading && shape.measure ? {progress: 50} : {}),
    ...(!shape.reading && shape.measure ? {rating: 5} : {}),
    ...(!shape.reading && shape.dated ? {finishedAt: SLOT_TIME} : {}),
    mainImage: slotImage('main'),
    mainImageThumb: slotImage('thumb'),
    mainImageCard: slotImage('card'),
    ...(shape.picture ? {mainImageAvif: slotImage('main-avif'), mainImageThumbAvif: slotImage('thumb-avif'), mainImageCardAvif: slotImage('card-avif')} : {})
  }
}

/** Bookshelf with one stand-in book of the given shape. */
export function bookshelfSlotProps(variant: DataVariant, shape: ShelfItemShape = SHELF_ITEM_SHAPES[0]!): DashboardViewModels['bookshelf'] {
  return {...stateProps(variant), books: {books: [slotBook(shape)], bookMeta: {}, statusLabels: {finished: SLOT_TEXT}}}
}
