import type { TheatreReviewsExport } from '../../../src/types/exports';
import { createTheatreReviewsFixture, createReview } from '../factories/theatre-reviews';
import { isoDate } from '../factories/helpers';

export const theatreReviewsVariations: Record<string, TheatreReviewsExport> = {
  baseline: createTheatreReviewsFixture(),

  empty: createTheatreReviewsFixture({
    reviews: [],
    totalReviews: 0,
  }),

  allGrades: (() => {
    const reviews = [
      createReview({ title: 'A Midsummer Night\'s Dream', slug: 'a-midsummer-nights-dream', rating: 'A+', ratingNumeric: 4.3, excerpt: 'A transcendent production that redefines the genre entirely.', publishedAt: isoDate() }),
      createReview({ title: 'Hamlet', slug: 'hamlet', rating: 'A', ratingNumeric: 4.0, excerpt: 'A commanding performance anchors this thoughtful modern staging.', publishedAt: isoDate() }),
      createReview({ title: 'Macbeth', slug: 'macbeth', rating: 'A-', ratingNumeric: 3.7, excerpt: 'Visually stunning with occasional pacing issues in Act III.', publishedAt: isoDate() }),
      createReview({ title: 'Romeo and Juliet', slug: 'romeo-and-juliet', rating: 'B+', ratingNumeric: 3.3, excerpt: 'Fresh choreography elevates familiar material.', publishedAt: isoDate() }),
      createReview({ title: 'Othello', slug: 'othello', rating: 'B', ratingNumeric: 3.0, excerpt: 'Solid ensemble work, but the leads lack chemistry.', publishedAt: isoDate() }),
      createReview({ title: 'The Tempest', slug: 'the-tempest', rating: 'C', ratingNumeric: 2.0, excerpt: 'Ambitious staging undermined by muddled direction.', publishedAt: isoDate() }),
      createReview({ title: 'Titus Andronicus', slug: 'titus-andronicus', rating: 'D', ratingNumeric: 1.0, excerpt: 'Gratuitous staging adds nothing to the text.', publishedAt: isoDate() }),
      createReview({ title: 'The Comedy of Errors', slug: 'the-comedy-of-errors', rating: 'F', ratingNumeric: 0.0, excerpt: 'A complete misfire on every level.', publishedAt: isoDate() }),
    ];
    return createTheatreReviewsFixture({ reviews, totalReviews: reviews.length });
  })(),

  noImages: (() => {
    const reviews = [
      createReview({ title: 'Long Day\'s Journey Into Night', slug: 'long-days-journey', rating: 'A', ratingNumeric: 4.0, imageUrl: null, imageWidth: null, imageHeight: null, publishedAt: isoDate() }),
      createReview({ title: 'Who\'s Afraid of Virginia Woolf?', slug: 'whos-afraid-of-virginia-woolf', rating: 'B+', ratingNumeric: 3.3, imageUrl: null, imageWidth: null, imageHeight: null, publishedAt: isoDate() }),
      createReview({ title: 'A Streetcar Named Desire', slug: 'a-streetcar-named-desire', rating: 'B', ratingNumeric: 3.0, imageUrl: null, imageWidth: null, imageHeight: null, publishedAt: isoDate() }),
    ];
    return createTheatreReviewsFixture({ reviews, totalReviews: reviews.length });
  })(),

  maxReviews: (() => {
    const titles = [
      'The Cherry Orchard', 'Uncle Vanya', 'Three Sisters', 'The Seagull',
      'Pygmalion', 'Arms and the Man', 'Heartbreak House', 'Major Barbara',
    ];
    const ratings = ['A+', 'A', 'A-', 'B+', 'B+', 'B', 'B-', 'C+'];
    const numerics = [4.3, 4.0, 3.7, 3.3, 3.3, 3.0, 2.7, 2.3];
    const reviews = titles.map((title, i) =>
      createReview({
        title,
        slug: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        rating: ratings[i],
        ratingNumeric: numerics[i],
        excerpt: `A compelling production of ${title} that rewards patient audiences.`,
        publishedAt: isoDate(),
      })
    );
    return createTheatreReviewsFixture({ reviews, totalReviews: reviews.length });
  })(),
};
