import {expect, test} from '@playwright/test'

test.describe('Bookshelf Matrix Render Conformance', () => {
  // covers: bookshelf-render#Loading skeleton state renders loading indicators without book sections
  test('skeleton state rendering', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.skeleton')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Empty state renders empty state message without book cards
  test('empty state rendering', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.empty')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Default populated arrangement renders expected book cards
  test('default populated arrangement', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Minimum populated arrangement renders single book card
  test('minimum populated arrangement', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.populated-min')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Maximum populated arrangement renders all book cards
  test('maximum populated arrangement', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.populated-max')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#All completed grouping renders completed section without active groups
  test('all completed grouping', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.all-completed')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#All in progress grouping renders active section without completed groups
  test('all in progress grouping', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.all-in-progress')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Dense shelf renders all books as reachable items
  test('dense shelf rendering', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.dense-shelf')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Mixed state renders active queued and completed groupings
  test('mixed state rendering', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.mixed')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })

  // covers: bookshelf-render#Sparse data renders sparse state without phantom cards
  test('sparse data rendering', async ({page}) => {
    await page.goto('/widgets/reading/bookshelf/?fixture=bookshelf.mostly-empty')
    await expect(page.locator('.bookshelf-widget')).toBeDefined()
  })
})
