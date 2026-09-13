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

// The freshness/skew thresholds that lived here are gone (atlas decision 0119 D2):
// audits/lib/llms-coherence.ts derives them from the packaged
// @j0nathan-ll0yd/estate-contracts LLM_FRESHNESS_CONFIG. They are audit-layer
// policy, and this module stays runtime-bundle-safe (no package import).
