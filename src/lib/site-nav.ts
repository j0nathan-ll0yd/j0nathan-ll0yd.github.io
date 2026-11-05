import {identity, llm} from '@j0nathan-ll0yd/copy'
import type {SiteFooterNavLink} from '@j0nathan-ll0yd/web/components'
import {AGENT_PATHS} from './edge/agent-paths.mjs'
import {SITE_PAGE_PATHS} from './edge/site-paths'

/**
 * The site navigation that `SiteFooterNav` renders on the homepage and in each text page's footer
 * (atlas decision 0158): About, Contact, Developers and Privacy, in that order. Paths come from
 * `SITE_PAGE_PATHS` and `AGENT_PATHS`, labels from `@j0nathan-ll0yd/copy`. The link whose path is
 * `pagePath` carries `current`; on `/` no link does.
 */
export function siteNavLinks(pagePath: string): SiteFooterNavLink[] {
  return [
    {href: SITE_PAGE_PATHS.about, label: identity.about.title},
    {href: SITE_PAGE_PATHS.contact, label: identity.contact.title},
    {href: AGENT_PATHS.developers, label: llm.developers.title},
    {href: SITE_PAGE_PATHS.privacy, label: identity.privacy.title}
  ].map((link) => ({...link, current: link.href === pagePath}))
}
