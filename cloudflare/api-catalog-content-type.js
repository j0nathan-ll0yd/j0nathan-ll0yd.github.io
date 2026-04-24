// Cloudflare Worker: Markdown Negotiation + API Catalog Content-Type
// 1. Markdown Negotiation: Serve pre-composed markdown from CloudFront
//    when agents send Accept: text/markdown (passes isitagentready.com check)
// 2. API Catalog: Override Content-Type for RFC 9727 compliance
//
// Deploy: cd cloudflare && wrangler deploy

export default {
  async fetch(request) {
    var url = new URL(request.url);
    var accept = request.headers.get('Accept') || '';

    // Markdown Negotiation: Serve pre-composed markdown from CloudFront
    if (accept.indexOf('text/markdown') !== -1) {
      return fetch('https://d1pfm520aduift.cloudfront.net/llms-full.txt');
    }

    // API Catalog Content-Type: Override for RFC 9727 compliance
    if (url.pathname === '/.well-known/api-catalog') {
      var response = await fetch(request);
      var newResponse = new Response(response.body, response);
      newResponse.headers.set(
        'Content-Type',
        'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'
      );
      return newResponse;
    }

    return fetch(request);
  }
};
