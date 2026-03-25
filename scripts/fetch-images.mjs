#!/usr/bin/env node
/**
 * Downloads optimized images from CloudFront to public/images/.
 * Images are committed to git and served as same-origin static assets.
 *
 * Usage:
 *   node scripts/fetch-images.mjs              # Download new images locally
 *   node scripts/fetch-images.mjs --check-only  # CI mode: detect new images, exit 1 if found
 *
 * No npm dependencies required (uses Node built-ins).
 */

import { mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const CLOUDFRONT_BASE = 'https://d3axfz0e3hiiuu.cloudfront.net';
const CONCURRENCY = 5;
const CHECK_ONLY = process.argv.includes('--check-only');

async function fetchJson(endpoint) {
  const res = await fetch(`${CLOUDFRONT_BASE}/${endpoint}`);
  if (!res.ok) throw new Error(`Failed to fetch ${endpoint}: ${res.status}`);
  return res.json();
}

function extractImageUrls(booksData, theatreData) {
  const urls = [];

  if (booksData?.books) {
    for (const book of booksData.books) {
      if (book.mainImage?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(book.mainImage);
      }
      if (book.mainImageThumb?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(book.mainImageThumb);
      }
      if (book.mainImageCard?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(book.mainImageCard);
      }
    }
  }

  if (theatreData?.reviews) {
    for (const review of theatreData.reviews) {
      if (review.imageUrl?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(review.imageUrl);
      }
      if (review.imageUrlCard?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(review.imageUrlCard);
      }
    }
  }

  return [...new Set(urls)];
}

function urlToLocalPath(url) {
  const path = url.slice(CLOUDFRONT_BASE.length);
  return join(PUBLIC_DIR, path);
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadImage(url) {
  const localPath = urlToLocalPath(url);

  if (await fileExists(localPath)) {
    return 'skipped';
  }

  if (CHECK_ONLY) {
    return 'missing';
  }

  await mkdir(dirname(localPath), { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`  ✗ ${url} (${res.status})`);
    return 'failed';
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  await writeFile(localPath, buffer);
  return 'downloaded';
}

async function runWithConcurrency(items, fn, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log('Fetching image manifests from CloudFront...');

  const [booksData, theatreData] = await Promise.allSettled([
    fetchJson('books.json'),
    fetchJson('theatre-reviews.json')
  ]);

  const books = booksData.status === 'fulfilled' ? booksData.value : null;
  const theatre = theatreData.status === 'fulfilled' ? theatreData.value : null;

  if (!books && !theatre) {
    console.log('No JSON data available. Skipping image check.');
    return;
  }

  const urls = extractImageUrls(books, theatre);
  console.log(`Found ${urls.length} images in CloudFront manifests.`);

  if (urls.length === 0) return;

  const results = await runWithConcurrency(urls, downloadImage, CONCURRENCY);

  const missing = results.filter(r => r === 'missing');
  const downloaded = results.filter(r => r === 'downloaded').length;
  const skipped = results.filter(r => r === 'skipped').length;
  const failed = results.filter(r => r === 'failed').length;

  if (CHECK_ONLY) {
    if (missing.length > 0) {
      const missingUrls = urls.filter((_, i) => results[i] === 'missing');
      console.log(`\n${missing.length} new image(s) detected:`);
      missingUrls.forEach(u => console.log(`  ${u}`));
      // Write missing URLs to file for CI to read
      const outputFile = join(__dirname, '..', 'missing-images.txt');
      await writeFile(outputFile, missingUrls.join('\n'));
      process.exit(1);
    } else {
      console.log('All images are up to date.');
    }
  } else {
    console.log(`Done: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`);
  }
}

main().catch(err => {
  console.error('Image check failed:', err.message);
  // Exit 0 in download mode (graceful degradation)
  // Exit 1 in check mode (surface the error)
  if (CHECK_ONLY) process.exit(1);
});
