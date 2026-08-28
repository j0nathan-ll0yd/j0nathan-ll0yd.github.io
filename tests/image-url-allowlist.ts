import {CLOUDFRONT_BASE, SITE_URL} from '@j0nathan-ll0yd/portal-contract/constants'

const SITE_ORIGIN = new URL(SITE_URL).origin
const CLOUDFRONT_ORIGIN = new URL(CLOUDFRONT_BASE).origin

export function srcsetCandidates(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed === '') {
    return []
  }
  if (trimmed.startsWith('data:')) {
    return [trimmed]
  }
  return trimmed.split(',').map((candidate) => candidate.trim().split(/\s+/)[0]).filter(Boolean)
}

export function isAllowedImageUrl(value: string, baseUrl = SITE_URL): boolean {
  if (value.startsWith('data:')) {
    return true
  }

  let url: URL
  try {
    url = new URL(value, baseUrl)
  } catch {
    return false
  }

  return url.origin === SITE_ORIGIN || url.origin === CLOUDFRONT_ORIGIN || /^[a-z0-9-]+\.basemaps\.cartocdn\.com$/i.test(url.hostname)
}
