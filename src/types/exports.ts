/**
 * Generated from backend JSON Schema files.
 * Do not edit manually — regenerate with: npm run generate:types
 *
 * Source: mantle-Lifegames-Portal/schemas/*.schema.json
 */

export interface ArticlesExport {
  generatedAt: string;
  articles: {
    articleUrl: string;
    articleTitle: string;
    articleAuthor: string | null;
    articleContent: string | null;
    articleFirstImageUrl: string | null;
    articlePublishedAt: string | null;
    articleBoards: string | null;
    articleCategories: string | null;
    sourceTitle: string | null;
    sourceUrl: string | null;
    sourceFeedUrl: string | null;
    articleEngagement: string | null;
    articleEngagementRate: string | null;
    articleFirstHighlight: string | null;
    articleFirstComment: string | null;
    savedAt: string;
    notes: {
      comment: string;
      savedBy: string | null;
      createdAt: string;
    }[];
  }[];
}

export interface BooksExport {
  generatedAt: string;
  books: {
    asin: string;
    title: string;
    author: string;
    series: string | null;
    seriesNumber: number | null;
    seriesTotal: number | null;
    description: string | null;
    publicationDate: string | null;
    publishedYear: number | null;
    isbn10: string | null;
    isbn13: string | null;
    pageCount: number | null;
    mainImage: string | null;
    images: string | null;
    averageRating: string | null;
    category: string | null;
    status: string | null;
    currentPage: number | null;
    totalPages: number | null;
    rating: number | null;
    notes: string | null;
  }[];
}

export interface GithubEventsExport {
  generatedAt: string;
  events: {
    type: string;
    repo: string;
    title: string;
    date: string;
    number?: number;
    hash?: string;
    additions?: number;
    deletions?: number;
  }[];
}

export interface GithubStarredReposExport {
  generatedAt: string;
  repos: {
    name: string;
    ownerLogin: string;
    ownerHtmlUrl: string;
    htmlUrl: string;
    description: string | null;
    forksCount: number;
    stargazersCount: number;
    watchersCount: number;
    openIssuesCount: number;
    topics: string[];
    size: number;
    licenseKey: string | null;
    licenseName: string | null;
    licenseSpdxId: string | null;
    starredAt: string;
    languages: {
      language: string;
      lines: number;
    }[];
  }[];
}

export interface HealthExport {
  date: string;
  generatedAt: string;
  quantities: {
    [k: string]: {
      value: number;
      unit: string;
    };
  };
}

export interface SleepExport {
  date: string;
  generatedAt: string;
  [k: string]:
    | string
    | {
        seconds: number;
      };
}

export interface WorkoutsExport {
  date: string;
  generatedAt: string;
  workouts: {
    activityType: string;
    duration: number | null;
    energyBurned: number | null;
    distance: number | null;
    source: string;
  }[];
}

export interface LocationExport {
  generatedAt: string;
  totalVisits: number;
  totalPlaces: number;
  totalDurationHours: number;
  citiesVisited: number;
  currentCity: string | null;
  lastSeen: string | null;
  last90Days: {
    date: string;
    count: number;
    uniquePlaces: number;
    totalDurationMinutes: number;
  }[];
  topPlaces: {
    name: string;
    category: string | null;
    visitCount: number;
    totalDurationMinutes: number;
    lastVisitAt: string | null;
  }[];
  cityBreakdown: {
    city: string;
    visitCount: number;
  }[];
  categoryBreakdown: {
    category: string;
    visitCount: number;
    totalMinutes: number;
  }[];
  streaks: {
    currentStreak: number;
    longestStreak: number;
    totalActiveDays: number;
  };
  explorationStats: {
    totalNeighborhoods: number;
    totalCities: number;
    totalStates: number;
  };
}

