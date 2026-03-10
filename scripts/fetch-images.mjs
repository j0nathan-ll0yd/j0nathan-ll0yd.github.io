#!/usr/bin/env node
/**
 * Downloads optimized images from CloudFront to public/images/ at build time.
 * Images are then served as same-origin static assets, enabling Cloudflare CDN caching.
 *
 * Usage: node scripts/fetch-images.mjs
 * No npm dependencies required (uses Node built-ins).
 */

import { mkdir, access, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const CLOUDFRONT_BASE = 'https://d2nfgi9u0n3jr6.cloudfront.net';
const CONCURRENCY = 5;

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
    }
  }

  if (theatreData?.reviews) {
    for (const review of theatreData.reviews) {
      if (review.imageUrl?.startsWith(`${CLOUDFRONT_BASE}/images/`)) {
        urls.push(review.imageUrl);
      }
    }
  }

  return [...new Set(urls)];
}

function urlToLocalPath(url) {
  const path = url.slice(CLOUDFRONT_BASE.length); // e.g. /images/books/B08N5WRWNW.webp
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
    console.log('No JSON data available. Skipping image fetch.');
    return;
  }

  const urls = extractImageUrls(books, theatre);
  console.log(`Found ${urls.length} images to fetch.`);

  if (urls.length === 0) return;

  const results = await runWithConcurrency(urls, downloadImage, CONCURRENCY);

  const downloaded = results.filter(r => r === 'downloaded').length;
  const skipped = results.filter(r => r === 'skipped').length;
  const failed = results.filter(r => r === 'failed').length;

  console.log(`Done: ${downloaded} downloaded, ${skipped} skipped, ${failed} failed.`);
}

main().catch(err => {
  console.error('Image fetch failed:', err.message);
  // Exit 0 — graceful degradation, onerror fallback handles missing images
});
