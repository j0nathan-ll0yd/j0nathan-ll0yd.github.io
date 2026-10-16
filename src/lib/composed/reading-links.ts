// The Reading card's props as the composer renders them (atlas decision 0160; web 4.3.0, DS #312).
//
// The design system links an article title whenever its URL parses as https (`safeHttpsUrl`) and
// joins every note into one uncapped `title`. The Worker admits a narrower set (./fragment-policy.ts),
// and one refused fragment serves the data-free page for the whole of `/`. So the composer degrades
// what the Worker would refuse instead of failing: a link the Worker would refuse renders as the
// title text (`span.article-list-title`, the DS's own no-link form; the row stays), and a note title
// is cut to MAX_TITLE. Under READING_LINKS 'strip' every title renders as text. The Worker's check
// is unchanged, so a forged artifact is still refused.
import {articleHrefAllowed, hrefAllowed, MAX_TITLE} from './fragment-policy'
import {READING_LINKS, type ReadingLinks} from './reading-option'

/** The ellipsis a cut note title ends with. */
const CUT_MARK = '…'

/** One article as the DS ReadingFeed reads it; other fields pass through untouched. */
interface ArticleProps {
  url?: string | null
  noteText?: string | null
}

/** True when the Worker would admit `url` as an article title's link under `option`. */
export function articleLinkKept(url: string, option: ReadingLinks = READING_LINKS): boolean {
  return option === 'allow' && (hrefAllowed(url) || articleHrefAllowed(url))
}

/** `text` cut to at most MAX_TITLE characters, on a code-point boundary, ending in an ellipsis. */
export function capNoteText(text: string): string {
  if (text.length <= MAX_TITLE) {
    return text
  }
  let cut = ''
  for (const point of text) {
    if (cut.length + point.length > MAX_TITLE - CUT_MARK.length) {
      break
    }
    cut += point
  }
  return cut + CUT_MARK
}

/**
 * The ReadingFeed props with every link the Worker would refuse removed (the DS then renders the
 * title as text) and every note title within MAX_TITLE. Props without articles return unchanged.
 */
export function composableReading<T extends object>(props: T, option: ReadingLinks = READING_LINKS): T {
  const reading = (props as {reading?: {articles?: ArticleProps[]}}).reading
  if (!reading || !Array.isArray(reading.articles)) {
    return props
  }
  const articles = reading.articles.map((article) => ({
    ...article,
    url: typeof article.url === 'string' && articleLinkKept(article.url, option) ? article.url : null,
    noteText: typeof article.noteText === 'string' ? capNoteText(article.noteText) : article.noteText
  }))
  return {...props, reading: {...reading, articles}}
}
