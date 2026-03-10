const CF_IMAGE_PREFIX = 'https://d2nfgi9u0n3jr6.cloudfront.net/images/';

/**
 * Converts a CloudFront image URL to a local path for same-origin serving.
 * Non-CloudFront URLs (e.g. Amazon, Squarespace) pass through unchanged.
 */
export function localizeImageUrl(url: string | null): string | null {
  if (!url || !url.startsWith(CF_IMAGE_PREFIX)) return url;
  return '/images/' + url.slice(CF_IMAGE_PREFIX.length);
}

/**
 * Returns an onerror handler attribute for graceful fallback to CloudFront.
 * If the local image 404s, swaps src to the original CloudFront URL.
 * onerror=null prevents infinite loops if the fallback also fails.
 */
export function imgFallbackAttrs(localSrc: string | null, originalUrl: string | null): string {
  if (!originalUrl || !localSrc || localSrc === originalUrl) return '';
  return ` data-fallback="${originalUrl}" onerror="this.srcset='';this.src=this.dataset.fallback;this.onerror=null"`;
}
