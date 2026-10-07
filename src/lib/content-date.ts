// A static page's sitemap lastmod is the date its copy last changed, carried by the
// copy package as an ISO `lastModified` key (identity.privacy, identity.about,
// identity.contact, llm.developers). The check is strict: anything other than a real
// calendar date throws at build, so a copy edit cannot turn a lastmod into the build
// time or into a date that does not exist.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** "2026-06-24" -> "2026-06-24T00:00:00.000Z", the start of that day in UTC. */
export function contentLastModified(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate)
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (!match || !date || date.toISOString().slice(0, 10) !== isoDate) {
    throw new Error(`copy lastModified "${isoDate}" is not a YYYY-MM-DD calendar date`)
  }
  return date.toISOString()
}
