// The article URL shapes the design system links (`safeHttpsUrl`: any URL that parses as https) and
// the Worker's allowlist refuses (src/lib/composed/fragment-policy.ts articleHrefAllowed). The
// composer must render each as text, never fail (src/lib/composed/reading-links.ts).
import {MAX_ARTICLE_HREF} from '../../src/lib/composed/fragment-policy'

export const REFUSED_ARTICLE_URLS: readonly [string, string][] = [
  ['a port other than 443', 'https://news.example.com:8443/a'],
  ['userinfo', 'https://user:pass@news.example.com/a'],
  ['an IPv4 host', 'https://203.0.113.7/a'],
  ['a single-label host', 'https://intranet/a'],
  ['a backslash', 'https://news.example.com\\a'],
  ['a tab', 'https://news.example.com/a\tb'],
  ['more than 2,048 characters', `https://news.example.com/${'a'.repeat(MAX_ARTICLE_HREF)}`],
  ['the site', 'https://jonathanlloyd.me/privacy'],
  ['the data plane', 'https://d1pfm520aduift.cloudfront.net/articles.json']
]
