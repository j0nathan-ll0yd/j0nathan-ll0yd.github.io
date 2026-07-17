#!/usr/bin/env node
// scripts/audit/validate-llms-txt.mjs -- B2. Hand-rolled llmstxt.org structural
// validator (no official validator exists -- verified against llmstxt.org
// directly, 2026-07-16 session). Also checks llms-full.txt / index.md
// (CloudFront-only artifacts with no formal spec of their own) for
// existence, non-emptiness, and freshness.
//
// llmstxt.org spec, verbatim structure (in order):
//   1. An optional byte-order mark (BOM)
//   2. An H1 with the project/site name -- the ONLY required section
//   3. A blockquote with a short summary
//   4. Zero or more non-heading markdown sections (paragraphs, lists, etc)
//   5. Zero or more H2-delimited "file list" sections, each a markdown list
//      of `[name](url)` or `[name](url): notes` items
// Once the first H2 appears, every subsequent H2 section is a file list --
// free-form prose sections are only valid BEFORE the first H2 (stage 4).
// "Optional" is a recognized section name (its links are skippable), not a
// different structural rule.
//
// This validator checks stage 2/3 (H1 + blockquote) as REQUIRED, matching
// universal real-world practice and this repo's own llms.txt, even though the
// spec technically marks the H1 alone as required -- see inline note.

import { CLOUDFRONT_BASE, SITE_URL } from '@lifegames/portal-contract/constants';
import { fetchStable, isMain, report } from './lib/http.mjs';

const LLMS_TXT_URL = `${SITE_URL}/llms.txt`;
const LLMS_FULL_URL = `${CLOUDFRONT_BASE}/llms-full.txt`;
const INDEX_MD_URL = `${CLOUDFRONT_BASE}/index.md`;

const LINK_ITEM_RE = /^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(:\s*.*)?$/;
const LIST_ITEM_RE = /^[-*]\s+/;

/**
 * Validate llms.txt structure against the llmstxt.org convention.
 * Pure function (string in, findings out) so it's testable without network.
 */
export function validateLlmsTxt(rawText) {
  const findings = [];
  let text = rawText;

  // 1. Optional BOM.
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const lines = text.split(/\r\n|\r|\n/);
  let i = 0;
  const nextNonBlank = () => {
    while (i < lines.length && lines[i].trim() === '') i++;
    return i < lines.length ? lines[i] : null;
  };

  // 2. First non-blank line MUST be an H1.
  const h1Line = nextNonBlank();
  if (h1Line === null || !/^#\s+\S/.test(h1Line)) {
    findings.push({
      severity: 'fail',
      id: 'llms-txt-h1',
      message: `first non-blank line must be "# <title>"; got ${JSON.stringify(h1Line)}`,
    });
    return findings; // structure is unrecoverable past this point
  }
  i++;

  // 3. Next non-blank line MUST be a blockquote (required by this validator;
  // the spec's own prose marks only the H1 as strictly required, but every
  // real-world llms.txt -- including this site's -- includes it, and the
  // team's validator contract treats it as required).
  const bqLine = nextNonBlank();
  if (bqLine === null || !/^>\s+\S/.test(bqLine)) {
    findings.push({
      severity: 'fail',
      id: 'llms-txt-blockquote',
      message: `expected a "> summary" blockquote immediately after the H1; got ${JSON.stringify(bqLine)}`,
    });
  } else {
    i++;
  }

  // 4/5. Walk remaining lines. Before the first H2: anything except another
  // H1 is fine (free-form body). From the first H2 onward: every H2 section's
  // list items must be markdown links.
  let sawH2 = false;
  let currentSection = null; // { name, hasListItem, isOptional }
  const sectionFindings = [];

  const closeSection = () => {
    if (currentSection && !currentSection.hasListItem) {
      sectionFindings.push({
        severity: 'warn',
        id: 'llms-txt-h2-no-file-list',
        message: `H2 section "${currentSection.name}" has no [name](url) file-list items`
          + ' (llmstxt.org: H2 sections are "file lists" of links)',
      });
    }
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const h2Match = /^##\s+(.+?)\s*$/.exec(line);
    if (h2Match) {
      closeSection();
      sawH2 = true;
      currentSection = { name: h2Match[1], hasListItem: false, isOptional: h2Match[1].trim() === 'Optional' };
      continue;
    }
    if (/^#\s+\S/.test(line)) {
      sectionFindings.push({
        severity: 'fail',
        id: 'llms-txt-second-h1',
        message: `unexpected second H1 at "${line}" -- only one H1 is allowed`,
      });
      continue;
    }
    if (!sawH2) {
      continue; // free-form pre-H2 body: anything but headings is spec-legal
    }
    if (LIST_ITEM_RE.test(line) && currentSection) {
      currentSection.hasListItem = true;
      if (!LINK_ITEM_RE.test(line)) {
        sectionFindings.push({
          severity: 'fail',
          id: 'llms-txt-non-link-list-item',
          message: `H2 section "${currentSection.name}" has a list item that is not a `
            + `"[name](url)" or "[name](url): notes" markdown link: ${JSON.stringify(line.trim())}`,
        });
      }
    }
  }
  closeSection();

  return [...findings, ...sectionFindings];
}

/** Existence/non-emptiness/freshness check for an artifact with no formal spec. */
async function checkPresence(id, url, maxAgeHours) {
  const findings = [];
  let res;
  try {
    res = await fetchStable(url);
  } catch (err) {
    findings.push({ severity: 'fail', id, message: `fetch failed: ${err.message}` });
    return findings;
  }
  if (!res.ok) {
    findings.push({ severity: 'fail', id, message: `HTTP ${res.status} fetching ${url}` });
    return findings;
  }
  const body = await res.text();
  if (body.trim().length === 0) {
    findings.push({ severity: 'fail', id, message: `${url} returned an empty body` });
    return findings;
  }

  // Freshness: prefer an embedded "**Generated:** <ISO date>" marker (present
  // in this composer's output); fall back to the Last-Modified header.
  const generatedMatch = body.match(/\*\*Generated:\*\*\s*([0-9T:.Z-]+)/);
  const generatedAt = generatedMatch ? new Date(generatedMatch[1]) : null;
  const lastModifiedHeader = res.headers.get('last-modified');
  const referenceDate = generatedAt && !Number.isNaN(generatedAt.getTime())
    ? generatedAt
    : (lastModifiedHeader ? new Date(lastModifiedHeader) : null);

  if (!referenceDate || Number.isNaN(referenceDate.getTime())) {
    findings.push({
      severity: 'warn',
      id: `${id}-freshness-unknown`,
      message: `could not determine a generation/modification time for ${url} (no embedded `
        + 'Generated marker and no Last-Modified header) -- freshness unchecked',
    });
  } else {
    const ageHours = (Date.now() - referenceDate.getTime()) / 3_600_000;
    if (ageHours > maxAgeHours) {
      findings.push({
        severity: 'fail',
        id: `${id}-stale`,
        message: `${url} is ${ageHours.toFixed(1)}h old (reference: ${referenceDate.toISOString()}), `
          + `exceeds the ${maxAgeHours}h warn threshold`,
      });
    }
  }

  return findings;
}

async function main() {
  let exit = 0;

  let llmsTxtBody;
  try {
    const res = await fetchStable(LLMS_TXT_URL);
    if (!res.ok) {
      exit = report('validate-llms-txt', [
        { severity: 'fail', id: 'llms-txt-fetch', message: `HTTP ${res.status} fetching ${LLMS_TXT_URL}` },
      ]);
    } else {
      llmsTxtBody = await res.text();
    }
  } catch (err) {
    exit = report('validate-llms-txt', [
      { severity: 'fail', id: 'llms-txt-fetch', message: `fetch failed: ${err.message}` },
    ]);
  }

  if (llmsTxtBody !== undefined) {
    const findings = validateLlmsTxt(llmsTxtBody);
    exit = report('validate-llms-txt (llms.txt structure)', findings) || exit;
  }

  // llms-full.txt / index.md: the composer runs on a 30m EventBridge rate +
  // event trigger (§11.2 of the audit plan); a 3h warn window covers a couple
  // of missed ticks without being noisy.
  const fullFindings = await checkPresence('llms-full-txt', LLMS_FULL_URL, 3);
  const indexMdFindings = await checkPresence('index-md', INDEX_MD_URL, 3);
  exit = report('validate-llms-txt (llms-full.txt + index.md presence)', [...fullFindings, ...indexMdFindings])
    || exit;

  process.exit(exit);
}

if (isMain(import.meta.url)) {
  main();
}
