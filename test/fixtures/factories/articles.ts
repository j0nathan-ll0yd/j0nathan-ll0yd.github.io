import type { ArticlesExport } from '../../../src/types/exports';
import { isoDate, isoTimestamp, placeholderText } from './helpers';

export function createArticle(
  overrides?: Partial<ArticlesExport['articles'][number]>
): ArticlesExport['articles'][number] {
  return {
    articleUrl: 'https://example.com/article-placeholder',
    articleTitle: placeholderText(8),
    articleAuthor: null,
    articleContent: null,
    articleFirstImageUrl: null,
    articlePublishedAt: isoDate(),
    articleBoards: null,
    articleCategories: null,
    sourceTitle: 'Example Source',
    sourceUrl: 'https://example.com',
    sourceFeedUrl: null,
    articleEngagement: null,
    articleEngagementRate: null,
    articleFirstHighlight: null,
    articleFirstComment: null,
    savedAt: isoTimestamp(),
    notes: [],
    ...overrides,
  };
}

export function createArticlesFixture(
  overrides?: Partial<ArticlesExport>
): ArticlesExport {
  return {
    generatedAt: isoTimestamp(),
    articles: [
      createArticle({
        articleUrl: 'https://news.ycombinator.com/item?id=placeholder1',
        articleTitle: 'Ask HN: How do you manage technical debt at scale',
        sourceTitle: 'Hacker News',
        sourceUrl: 'https://news.ycombinator.com',
        articlePublishedAt: isoDate(),
      }),
      createArticle({
        articleUrl: 'https://gizmodo.com/placeholder-article-title',
        articleTitle: 'The Future of Wearable Health Monitoring Devices',
        sourceTitle: 'Gizmodo',
        sourceUrl: 'https://gizmodo.com',
        articlePublishedAt: isoDate(),
      }),
      createArticle({
        articleUrl: 'https://techcrunch.com/placeholder-startup-funding',
        articleTitle: 'Developer Tools Startup Raises Series B Round',
        sourceTitle: 'TechCrunch',
        sourceUrl: 'https://techcrunch.com',
        articlePublishedAt: isoDate(),
        notes: [
          {
            comment: 'Interesting approach to the problem space',
            savedBy: null,
            createdAt: isoTimestamp(),
          },
        ],
      }),
      createArticle({
        articleUrl: 'https://www.theverge.com/placeholder-review',
        articleTitle: 'Review: The Latest Advances in Open Source AI Tools',
        sourceTitle: 'The Verge',
        sourceUrl: 'https://www.theverge.com',
        articlePublishedAt: isoDate(),
      }),
      createArticle({
        articleUrl: 'https://arstechnica.com/placeholder-deep-dive',
        articleTitle: 'Deep Dive: How Modern Compilers Optimize Code',
        sourceTitle: 'Ars Technica',
        sourceUrl: 'https://arstechnica.com',
        articlePublishedAt: isoDate(),
      }),
    ],
    ...overrides,
  };
}
