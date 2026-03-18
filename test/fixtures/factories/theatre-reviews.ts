import type { TheatreReviewsExport, TheatreReviewEntry } from '../../../src/types/exports';
import { isoDate, isoTimestamp } from './helpers';

export function createReview(
  overrides?: Partial<TheatreReviewEntry>
): TheatreReviewEntry {
  return {
    title: 'The Glass Menagerie',
    slug: 'the-glass-menagerie',
    url: 'https://coasttocoastreviews.com/reviews/the-glass-menagerie',
    author: 'Staff Reviewer',
    publishedAt: isoDate(),
    rating: 'A',
    ratingNumeric: 4.0,
    excerpt: 'A luminous revival that honors the original while finding fresh emotional resonance.',
    imageUrl: 'https://coasttocoastreviews.com/images/the-glass-menagerie.jpg',
    imageWidth: 800,
    imageHeight: 450,
    ...overrides,
  };
}

export function createTheatreReviewsFixture(
  overrides?: Partial<TheatreReviewsExport>
): TheatreReviewsExport {
  const reviews: TheatreReviewEntry[] = [
    createReview({
      title: 'The Glass Menagerie',
      slug: 'the-glass-menagerie',
      url: 'https://coasttocoastreviews.com/reviews/the-glass-menagerie',
      rating: 'A',
      ratingNumeric: 4.0,
      excerpt: 'A luminous revival that honors the original while finding fresh emotional resonance.',
      publishedAt: isoDate(),
    }),
    createReview({
      title: 'Death of a Salesman',
      slug: 'death-of-a-salesman',
      url: 'https://coasttocoastreviews.com/reviews/death-of-a-salesman',
      rating: 'B+',
      ratingNumeric: 3.3,
      excerpt: 'A gripping production with a towering central performance, though the pacing lags in Act II.',
      imageUrl: 'https://coasttocoastreviews.com/images/death-of-a-salesman.jpg',
      publishedAt: isoDate(),
    }),
    createReview({
      title: 'Waiting for Godot',
      slug: 'waiting-for-godot',
      url: 'https://coasttocoastreviews.com/reviews/waiting-for-godot',
      rating: 'C',
      ratingNumeric: 2.0,
      excerpt: 'The existential dread is palpable, but this staging fails to unlock Beckett\'s dark humor.',
      imageUrl: 'https://coasttocoastreviews.com/images/waiting-for-godot.jpg',
      publishedAt: isoDate(),
    }),
  ];

  return {
    generatedAt: isoTimestamp(),
    source: 'coasttocoastreviews.com',
    totalReviews: reviews.length,
    reviews,
    ...overrides,
  };
}
