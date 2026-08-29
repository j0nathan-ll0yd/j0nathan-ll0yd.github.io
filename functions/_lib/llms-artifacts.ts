import {CLOUDFRONT_BASE, DATASET_DISTRIBUTIONS, LLM_CONTENT_PATHS, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const discoveryIndex = DATASET_DISTRIBUTIONS.find(({name}) => name === 'LLM discovery index')

if (!discoveryIndex) {
  throw new Error('portal-contract DATASET_DISTRIBUTIONS is missing the LLM discovery index')
}

/** The discovery path comes from the portal contract's generated distribution registry. */
export const LLMS_TXT_PATH = new URL(discoveryIndex.contentUrl).pathname

export const LLMS_ARTIFACTS = [
  {
    id: 'llms.txt',
    path: LLMS_TXT_PATH,
    originUrl: `${CLOUDFRONT_BASE}${LLMS_TXT_PATH}`,
    siteUrl: `${SITE_URL}${LLMS_TXT_PATH}`,
    originContentType: 'text/markdown',
    siteContentType: 'text/plain'
  },
  {
    id: 'llms-full.txt',
    path: LLM_CONTENT_PATHS.llmsFull,
    originUrl: `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.llmsFull}`,
    siteUrl: `${SITE_URL}${LLM_CONTENT_PATHS.llmsFull}`,
    originContentType: 'text/markdown',
    siteContentType: 'text/markdown'
  },
  {
    id: 'index.md',
    path: LLM_CONTENT_PATHS.indexMarkdown,
    originUrl: `${CLOUDFRONT_BASE}${LLM_CONTENT_PATHS.indexMarkdown}`,
    siteUrl: `${SITE_URL}${LLM_CONTENT_PATHS.indexMarkdown}`,
    originContentType: 'text/markdown',
    siteContentType: 'text/markdown'
  }
] as const

export type LlmsArtifact = (typeof LLMS_ARTIFACTS)[number]
export type LlmsArtifactId = LlmsArtifact['id']

/** Composer freshness contract from openspec/specs/llms-txt/spec.md. */
export const LLMS_MAX_COMPOSITION_AGE_MS = 4 * 60 * 60 * 1000

/**
 * CloudFront advertises a five-minute origin TTL. Two intervals tolerate a
 * cross-key or cross-PoP refresh boundary while still detecting a longer hold.
 */
export const LLMS_MAX_COMPOSITION_SKEW_MS = 10 * 60 * 1000

/** Small clock-drift allowance; a composition time further ahead is invalid. */
export const LLMS_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000
