import type { BooksExport } from '../../../src/types/exports';
import { createBooksFixture, createBook } from '../factories/books';
import { placeholderText } from '../factories/helpers';

/** Baseline: default 5-book fixture */
export const baseline: BooksExport = createBooksFixture();

/** Empty: no books */
export const empty: BooksExport = createBooksFixture({ books: [] });

/** allReading: 3 books all in reading status */
export const allReading: BooksExport = createBooksFixture({
  books: [
    createBook({ asin: 'B001', title: 'Reading Book One', status: 'reading', currentPage: 50, totalPages: 300, rating: null }),
    createBook({ asin: 'B002', title: 'Reading Book Two', status: 'reading', currentPage: 120, totalPages: 400, rating: null }),
    createBook({ asin: 'B003', title: 'Reading Book Three', status: 'reading', currentPage: 200, totalPages: 500, rating: null }),
  ],
});

/** allCompleted: 5 books all completed with ratings 1–5 */
export const allCompleted: BooksExport = createBooksFixture({
  books: [
    createBook({ asin: 'C001', title: 'Completed Book One', status: 'completed', rating: 1, currentPage: null }),
    createBook({ asin: 'C002', title: 'Completed Book Two', status: 'completed', rating: 2, currentPage: null }),
    createBook({ asin: 'C003', title: 'Completed Book Three', status: 'completed', rating: 3, currentPage: null }),
    createBook({ asin: 'C004', title: 'Completed Book Four', status: 'completed', rating: 4, currentPage: null }),
    createBook({ asin: 'C005', title: 'Completed Book Five', status: 'completed', rating: 5, currentPage: null }),
  ],
});

/** mixedStatus: completed, reading, upNext, and null status */
export const mixedStatus: BooksExport = createBooksFixture({
  books: [
    createBook({ asin: 'M001', title: 'Mixed Completed', status: 'completed', rating: 4, currentPage: null }),
    createBook({ asin: 'M002', title: 'Mixed Reading', status: 'reading', currentPage: 80, totalPages: 320, rating: null }),
    createBook({ asin: 'M003', title: 'Mixed Up Next', status: 'upNext', currentPage: null, rating: null }),
    createBook({ asin: 'M004', title: 'Mixed No Status', status: null, currentPage: null, rating: null }),
  ],
});

/** withProgress: books at various reading progress percentages */
export const withProgress: BooksExport = createBooksFixture({
  books: [
    createBook({ asin: 'P001', title: 'Just Started', status: 'reading', currentPage: 10, totalPages: 400, rating: null }),
    createBook({ asin: 'P002', title: 'Quarter Done', status: 'reading', currentPage: 100, totalPages: 400, rating: null }),
    createBook({ asin: 'P003', title: 'Halfway', status: 'reading', currentPage: 200, totalPages: 400, rating: null }),
    createBook({ asin: 'P004', title: 'Three Quarters', status: 'reading', currentPage: 300, totalPages: 400, rating: null }),
    createBook({ asin: 'P005', title: 'Almost Done', status: 'reading', currentPage: 390, totalPages: 400, rating: null }),
  ],
});

/** noCovers: all books with null image fields */
export const noCovers: BooksExport = createBooksFixture({
  books: createBooksFixture().books.map((b) => ({
    ...b,
    mainImage: null,
    mainImageThumb: null,
    images: null,
  })),
});

/** seriesBooks: all books with series info populated */
export const seriesBooks: BooksExport = createBooksFixture({
  books: [
    createBook({ asin: 'S001', title: 'Series Alpha 1', series: 'Alpha Chronicles', seriesNumber: 1, seriesTotal: 4, status: 'completed', rating: 5 }),
    createBook({ asin: 'S002', title: 'Series Alpha 2', series: 'Alpha Chronicles', seriesNumber: 2, seriesTotal: 4, status: 'completed', rating: 4 }),
    createBook({ asin: 'S003', title: 'Series Alpha 3', series: 'Alpha Chronicles', seriesNumber: 3, seriesTotal: 4, status: 'reading', currentPage: 100, totalPages: 350, rating: null }),
    createBook({ asin: 'S004', title: 'Series Alpha 4', series: 'Alpha Chronicles', seriesNumber: 4, seriesTotal: 4, status: 'upNext', rating: null }),
    createBook({ asin: 'S005', title: 'Series Beta 1', series: 'Beta Saga', seriesNumber: 1, seriesTotal: 2, status: 'completed', rating: 3 }),
  ],
});

/** sixBooks: 6 books — tests the 5-book display cap */
export const sixBooks: BooksExport = createBooksFixture({
  books: [
    ...createBooksFixture().books,
    createBook({
      asin: 'X006',
      title: 'Sixth Book',
      author: 'Extra Author',
      series: null,
      seriesNumber: null,
      seriesTotal: null,
      status: 'completed',
      rating: 3,
      currentPage: null,
    }),
  ],
});

/** allFields: single book with every optional field populated */
export const allFields: BooksExport = createBooksFixture({
  books: [
    createBook({
      asin: 'F001',
      title: 'All Fields Book',
      author: 'Full Author',
      series: 'Complete Series',
      seriesNumber: 1,
      seriesTotal: 5,
      description: placeholderText(200),
      publicationDate: '2023-06-15',
      publishedYear: 2023,
      isbn10: '0123456789',
      isbn13: '9780123456789',
      pageCount: 350,
      mainImage: 'https://m.media-amazon.com/images/I/example-all-fields.jpg',
      mainImageThumb: 'https://m.media-amazon.com/images/I/example-all-fields-thumb.jpg',
      images: 'https://m.media-amazon.com/images/I/example-extra.jpg',
      averageRating: '4.8',
      category: 'Fiction',
      status: 'completed',
      currentPage: null,
      totalPages: 350,
      rating: 5,
      notes: 'Highly recommended to a friend',
    }),
  ],
});

export const booksVariations = {
  baseline,
  empty,
  allReading,
  allCompleted,
  mixedStatus,
  withProgress,
  noCovers,
  seriesBooks,
  sixBooks,
  allFields,
};
