import type { ArticlesExport } from '../../../src/types/exports';
import { createArticlesFixture, createArticle } from '../factories/articles';
import { isoDate, isoTimestamp } from '../factories/helpers';

export const articlesVariations: Record<string, ArticlesExport> = {
  baseline: createArticlesFixture(),

  empty: createArticlesFixture({ articles: [] }),

  withNotes: createArticlesFixture({
    articles: [
      createArticle({
        articleUrl: 'https://news.ycombinator.com/item?id=notes1',
        articleTitle: 'How to Build Resilient Distributed Systems',
        sourceTitle: 'Hacker News',
        notes: [
          { comment: 'Great point about consensus algorithms', savedBy: null, createdAt: isoTimestamp() },
          { comment: 'Follow up on the Raft paper', savedBy: null, createdAt: isoTimestamp() },
        ],
      }),
      createArticle({
        articleUrl: 'https://techcrunch.com/notes2-placeholder',
        articleTitle: 'The Economics of Open Source Sustainability',
        sourceTitle: 'TechCrunch',
        notes: [
          { comment: 'Relevant to mantle licensing decisions', savedBy: null, createdAt: isoTimestamp() },
        ],
      }),
      createArticle({
        articleUrl: 'https://arstechnica.com/notes3-placeholder',
        articleTitle: 'Aurora DSQL: A Deep Dive into Serverless Postgres',
        sourceTitle: 'Ars Technica',
        notes: [
          { comment: 'Compare with our current DSQL usage', savedBy: null, createdAt: isoTimestamp() },
          { comment: 'Check the async index creation section', savedBy: null, createdAt: isoTimestamp() },
        ],
      }),
    ],
  }),

  overThirty: createArticlesFixture({
    articles: Array.from({ length: 40 }, (_, i) =>
      createArticle({
        articleUrl: `https://example.com/article-${i + 1}`,
        articleTitle: `Article title number ${i + 1} in large dataset`,
        sourceTitle: ['Hacker News', 'TechCrunch', 'The Verge', 'Ars Technica', 'Gizmodo'][i % 5],
        articlePublishedAt: isoDate(),
        savedAt: isoTimestamp(),
      })
    ),
    generatedAt: isoTimestamp(),
  }),

  pagination: createArticlesFixture({
    articles: Array.from({ length: 25 }, (_, i) =>
      createArticle({
        articleUrl: `https://example.com/page-article-${i + 1}`,
        articleTitle: `Paginated article ${i + 1} of twenty-five`,
        sourceTitle: ['Hacker News', 'TechCrunch', 'The Verge'][i % 3],
        articlePublishedAt: isoDate(),
        savedAt: isoTimestamp(),
      })
    ),
    generatedAt: isoTimestamp(),
  }),
};
