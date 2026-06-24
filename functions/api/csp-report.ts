// Pages Function: CSP violation report collector.
// Accepts reports from the browser Reporting API (application/reports+json)
// and the legacy report-uri mechanism (application/csp-report). Always returns
// 204 so the browser does not retry. Logs a single structured line per invocation
// visible in `wrangler pages deployment tail`.

// Minimal Cloudflare Pages Function context -- only the fields this handler reads.
interface PagesContext {
  request: Request;
}

const ACCEPTED_CONTENT_TYPES = [
  'application/csp-report',
  'application/reports+json',
];

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { request } = context;

  const contentType = request.headers.get('Content-Type') ?? '';
  const accepted = ACCEPTED_CONTENT_TYPES.some((t) => contentType.includes(t));
  if (!accepted) {
    return new Response(null, { status: 415 });
  }

  const userAgent = request.headers.get('User-Agent') ?? '';

  try {
    const body = await request.text();
    // Parse permissively -- both report types are JSON; swallow errors so a
    // malformed body never causes a retry storm.
    let report: unknown;
    try {
      report = JSON.parse(body);
    } catch {
      report = { raw: body };
    }

    console.log(
      JSON.stringify({
        event: 'csp-report',
        userAgent,
        report,
      })
    );
  } catch {
    // Body read failure -- still return 204 to suppress retries.
  }

  return new Response(null, { status: 204 });
}
