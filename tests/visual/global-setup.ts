import type { FullConfig } from '@playwright/test';

/**
 * Guard against reusing an unrelated dev server on the configured port.
 *
 * Playwright's `reuseExistingServer: !isCI` will silently latch onto any
 * process already listening on the webServer URL. When another Astro project
 * (e.g. the design system docs) squats the port, tests run against the wrong
 * site and every snapshot drifts. Fail fast with a clear message instead.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const url = config.webServer && !Array.isArray(config.webServer)
    ? config.webServer.url
    : undefined;
  if (!url) return;

  let html: string;
  try {
    const res = await fetch(url);
    html = await res.text();
  } catch {
    return;
  }

  const markers = ['id="cardHR"', 'Human Datastream'];
  const missing = markers.filter((m) => !html.includes(m));
  if (missing.length > 0) {
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const wrongTitle = titleMatch ? titleMatch[1] : '(no <title>)';
    throw new Error(
      `[playwright] ${url} is serving the wrong site. ` +
        `Expected portfolio markers: ${markers.join(', ')}. Missing: ${missing.join(', ')}. ` +
        `Got <title>: "${wrongTitle}". ` +
        `Another process is likely squatting the port — stop it and re-run.`,
    );
  }
}
