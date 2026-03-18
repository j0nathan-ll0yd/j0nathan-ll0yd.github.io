// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { updateTheatreReviews } from '../../src/lib/updaters-theatre';
import type { TheatreReviewsExport } from '../../src/types/exports';

function makeExport(reviews: TheatreReviewsExport['reviews'] = []): TheatreReviewsExport {
  return {
    generatedAt: '2026-01-01T00:00:00Z',
    source: 'test',
    totalReviews: reviews.length,
    reviews,
  };
}

function setup() {
  document.body.innerHTML = `
    <div id="cardTheatreReviews" class="is-loading">
      <span id="theatreCount"></span>
      <div id="theatreRow"></div>
    </div>
  `;
}

describe('updateTheatreReviews', () => {
  beforeEach(setup);

  it('does not throw when card is missing', () => {
    document.body.innerHTML = '';
    expect(() => updateTheatreReviews(makeExport())).not.toThrow();
  });

  it('sets review count text', () => {
    updateTheatreReviews(makeExport([]));
    expect(document.getElementById('theatreCount')!.textContent).toBe('0 reviews');
  });

  it('removes is-loading when reviews is empty', () => {
    updateTheatreReviews(makeExport([]));
    expect(document.getElementById('cardTheatreReviews')!.classList.contains('is-loading')).toBe(false);
  });

  it('renders theatre cards with titles', () => {
    const reviews = [
      { title: 'Hamilton', slug: 'hamilton', url: 'https://example.com/hamilton', author: 'Jonathan', publishedAt: '2026-01-01', rating: 'A', ratingNumeric: 4, excerpt: 'Great show', imageUrl: null, imageWidth: null, imageHeight: null },
    ];
    updateTheatreReviews(makeExport(reviews));
    expect(document.getElementById('theatreRow')!.innerHTML).toContain('Hamilton');
  });

  it('renders grade badge for rated review', () => {
    const reviews = [
      { title: 'Wicked', slug: 'wicked', url: 'https://example.com/wicked', author: 'Jonathan', publishedAt: '2026-01-01', rating: 'B+', ratingNumeric: 3, excerpt: 'Fun', imageUrl: null, imageWidth: null, imageHeight: null },
    ];
    updateTheatreReviews(makeExport(reviews));
    expect(document.getElementById('theatreRow')!.innerHTML).toContain('theatre-grade');
    expect(document.getElementById('theatreRow')!.innerHTML).toContain('B+');
  });

  it('does not render grade badge when rating is null', () => {
    const reviews = [
      { title: 'No Grade', slug: 'no-grade', url: 'https://example.com/ng', author: 'Jonathan', publishedAt: '2026-01-01', rating: null, ratingNumeric: null, excerpt: 'Hmm', imageUrl: null, imageWidth: null, imageHeight: null },
    ];
    updateTheatreReviews(makeExport(reviews));
    expect(document.getElementById('theatreRow')!.innerHTML).not.toContain('theatre-grade');
  });

  it('renders localized image URL when imageUrl is a CloudFront URL', () => {
    const reviews = [
      { title: 'CF Show', slug: 'cf-show', url: 'https://example.com/cf', author: 'Jonathan', publishedAt: '2026-01-01', rating: 'A', ratingNumeric: 4, excerpt: 'Good', imageUrl: 'https://d2nfgi9u0n3jr6.cloudfront.net/images/theatre/cf-show.webp', imageWidth: 95, imageHeight: 143 },
    ];
    updateTheatreReviews(makeExport(reviews));
    const img = document.querySelector('#theatreRow img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain('/images/theatre/cf-show.webp');
  });

  it('removes is-loading after rendering reviews', () => {
    const reviews = [
      { title: 'Test Show', slug: 'test', url: 'https://example.com/test', author: 'Jonathan', publishedAt: '2026-01-01', rating: 'A-', ratingNumeric: 4, excerpt: 'Nice', imageUrl: null, imageWidth: null, imageHeight: null },
    ];
    updateTheatreReviews(makeExport(reviews));
    expect(document.getElementById('cardTheatreReviews')!.classList.contains('is-loading')).toBe(false);
  });
});
