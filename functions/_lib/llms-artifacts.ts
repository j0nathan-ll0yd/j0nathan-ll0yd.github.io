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
// audits/checks/b2-llms.mjs derives them from the packaged
// @j0nathan-ll0yd/estate-contracts LLM_FRESHNESS_CONFIG. They are audit-layer
// policy, and this module stays free of any estate-contracts import so the Pages
// Functions runtime bundle never pulls the package in. (It DOES import
// @j0nathan-ll0yd/portal-contract above -- that one is the served-path contract and
// belongs in the bundle. This comment said "no package import", which read as
// forbidding both.)
//
// Corrected by atlas decision 0142 phase 7: the pointer named audits/lib/llms-coherence.ts,
// a file PR #302 deleted when it folded the coherence libs into their single caller.
// An engineer following the dead path could have re-derived freshness policy in the
// wrong layer.
