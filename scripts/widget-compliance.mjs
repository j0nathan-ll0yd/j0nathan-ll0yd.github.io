#!/usr/bin/env node
/**
 * Widget Compliance Matrix Generator
 *
 * Scans the codebase to produce an up-to-date compliance report for
 * all production widgets. See docs/wiki/Widget-Specification.md Section 9.
 *
 * Usage: node scripts/widget-compliance.mjs
 *        npm run compliance
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

// --- Production widget registry (source of truth: index.astro imports) ---
const PRODUCTION_WIDGETS = [
  { name: 'IdentityCard', file: 'IdentityCard.astro', id: 'identityCard', status: 'shipped' },
  { name: 'BioTerminal', file: 'BioTerminal.astro', id: 'cardBio', status: 'shipped' },
  { name: 'SystemStatus', file: 'SystemStatus.astro', id: 'cardSystem', status: 'shipped' },
  { name: 'HeartRate', file: 'HeartRate.astro', id: 'cardHR', status: 'shipped' },
  { name: 'DailyActivity', file: 'DailyActivity.astro', id: 'cardSteps', status: 'shipped' },
  { name: 'Workouts', file: 'Workouts.astro', id: 'cardWorkouts', status: 'shipped' },
  { name: 'Hydration', file: 'Hydration.astro', id: 'cardHydration', status: 'shipped' },
  { name: 'NightSummary', file: 'NightSummary.astro', id: 'cardSleep', status: 'shipped' },
  { name: 'DevActivityLog', file: 'github/DevActivityLog.astro', id: 'cardDevLog', status: 'shipped' },
  { name: 'ReadingFeed', file: 'ReadingFeed.astro', id: 'cardReading', status: 'shipped' },
  { name: 'StarredRepoList', file: 'github/StarredRepoList.astro', id: null, status: 'shipped' },
  { name: 'Bookshelf', file: 'Bookshelf.astro', id: 'cardBooks', status: 'shipped' },
  { name: 'TheatreReviews', file: 'TheatreReviews.astro', id: 'cardTheatreReviews', status: 'shipped' },
  { name: 'PlaceLeaderboardV3', file: 'location/PlaceLeaderboardV3.astro', id: 'cardPlaceLeaderboardV3', status: 'dev-only' },
  { name: 'ExplorationOdometerV3', file: 'location/ExplorationOdometerV3.astro', id: 'cardExplorationOdometerV3', status: 'dev-only' },
];

// Non-widget components tracked separately
const NON_WIDGETS = [
  { name: 'FocusOverlay', file: 'FocusOverlay.astro', type: 'overlay' },
  { name: 'DndOverlay', file: 'DndOverlay.astro', type: 'overlay' },
  { name: 'BookModal', file: 'BookModal.astro', type: 'modal' },
  { name: 'ComingSoon', file: 'ComingSoon.astro', type: 'utility' },
  { name: 'OGImage', file: 'OGImage.astro', type: 'utility' },
];

function readFile(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf-8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function dirEntries(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) return [];
  return fs.readdirSync(fullPath);
}

// --- Check 1: Component file exists ---
function checkComponentExists(widget) {
  return fileExists(`src/components/${widget.file}`);
}

// --- Check 2: Has widget ID ---
function checkHasId(widget) {
  return widget.id !== null;
}

// --- Check 3: In showcase ---
function checkInShowcase(widget, showcaseFiles) {
  const componentName = widget.name;
  const widgetId = widget.id;
  // Derive space-separated name from PascalCase (e.g., "TheatreReviews" → "Theatre Reviews")
  const spacedName = componentName.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Check for component import, widget ID, or spaced name in showcase HTML
  return showcaseFiles.some(content =>
    content.includes(componentName) ||
    (widgetId && content.includes(widgetId)) ||
    content.includes(spacedName)
  );
}

// --- Check 4: Has screenshot test ---
function checkHasScreenshotTest(widget, widgetsSpecContent, helpersContent) {
  if (!widget.id) return false;
  // Find the WIDGET_SELECTORS key that maps to this widget's ID
  const selectorPattern = new RegExp(`(\\w+):\\s*'#${widget.id}'`);
  const selectorMatch = helpersContent.match(selectorPattern);
  if (!selectorMatch) return false;
  const selectorKey = selectorMatch[1];
  // Check if this selector key is used in widgets.spec.ts
  return widgetsSpecContent.includes(`WIDGET_SELECTORS.${selectorKey}`);
}

// --- Check 5: Has variation tests ---
function checkHasVariationTests(widget, fixturesContent) {
  // Look for scenario names that reference this widget
  const widgetKey = Object.entries({
    cardHR: ['hr-'],
    cardHydration: ['hydration-'],
    cardSleep: ['sleep-'],
    cardBooks: ['books-'],
    cardDevLog: ['github-commits', 'github-prs'],
    cardWorkouts: ['workouts-'],
    cardTheatreReviews: ['theatre-'],
  }).find(([id]) => id === widget.id);

  if (!widgetKey) return { has: false, count: 0, names: [] };

  const prefixes = widgetKey[1];
  const scenarioPattern = /['"]([a-z][\w-]*)[']\s*:/g;
  const scenarios = [];
  let match;
  while ((match = scenarioPattern.exec(fixturesContent)) !== null) {
    const name = match[1];
    if (prefixes.some(p => name.startsWith(p))) {
      scenarios.push(name);
    }
  }

  return { has: scenarios.length > 0, count: scenarios.length, names: scenarios };
}

// --- Check 6: Has unit tests ---
function checkHasUnitTests(widget, testFiles) {
  const name = widget.name;
  // Map widget names to likely test identifiers
  const searchTerms = [name, name.replace(/V\d+$/, '')];

  // Check if adapter/updater for this widget is tested
  const adapterMap = {
    HeartRate: ['adaptHealth', 'updateHeartRate', 'classifyHeartRate'],
    DailyActivity: ['adaptHealth', 'updateDailyActivity'],
    Workouts: ['adaptWorkouts', 'updateWorkouts'],
    Hydration: ['adaptHealth', 'updateHydration'],
    NightSummary: ['adaptSleep', 'updateNightSummary', 'computeTotalSleep', 'formatDuration'],
    DevActivityLog: ['adaptGithubEvents', 'updateDevActivityLog'],
    ReadingFeed: ['adaptArticles', 'updateReadingFeed'],
    Bookshelf: ['adaptBooks', 'updateBookshelf'],
    TheatreReviews: ['updateTheatreReviews'],
    SystemStatus: ['updateSystemStatus'],
    PlaceLeaderboardV3: ['updatePlaceLeaderboard'],
    ExplorationOdometerV3: ['updateExplorationOdometer'],
  };

  const terms = adapterMap[name] || searchTerms;
  const allTestContent = testFiles.join('\n');

  return terms.some(term => allTestContent.includes(term));
}

// --- Check 7: Has fixture data ---
function checkHasFixtures(widget) {
  // Map widgets to their data type directories
  const fixtureMap = {
    HeartRate: 'health',
    DailyActivity: 'health',
    Hydration: 'health',
    NightSummary: 'sleep',
    Workouts: 'workouts',
    Bookshelf: 'books',
    DevActivityLog: 'github-events',
    ReadingFeed: 'articles',
    StarredRepoList: 'github-starred-repos',
    TheatreReviews: 'theatre-reviews',
    PlaceLeaderboardV3: 'location',
    ExplorationOdometerV3: 'location',
  };

  const dataType = fixtureMap[widget.name];
  if (!dataType) return { has: false, count: 0 };

  const dir = `test/fixtures/generated/${dataType}`;
  const entries = dirEntries(dir).filter(f => f.endsWith('.json'));
  return { has: entries.length > 0, count: entries.length };
}

// --- Main ---
function main() {
  console.log('Widget Compliance Matrix Generator');
  console.log('==================================\n');

  // Load source files
  const showcaseDir = 'src/showcase';
  const showcaseFiles = dirEntries(showcaseDir)
    .filter(f => f.endsWith('.astro'))
    .map(f => readFile(`${showcaseDir}/${f}`));

  const widgetsSpec = readFile('tests/visual/widgets.spec.ts');
  const helpers = readFile('tests/visual/helpers.ts');
  const fixtures = readFile('tests/visual/fixtures.ts');

  const testLibDir = 'tests/lib';
  const testFiles = dirEntries(testLibDir)
    .filter(f => f.endsWith('.test.ts'))
    .map(f => readFile(`${testLibDir}/${f}`));

  // Add build tests
  const testBuildDir = 'tests/build';
  if (fs.existsSync(path.join(ROOT, testBuildDir))) {
    dirEntries(testBuildDir)
      .filter(f => f.endsWith('.test.ts'))
      .forEach(f => testFiles.push(readFile(`${testBuildDir}/${f}`)));
  }

  // --- Generate compliance data ---
  const results = PRODUCTION_WIDGETS.map(widget => {
    const componentExists = checkComponentExists(widget);
    const hasId = checkHasId(widget);
    const inShowcase = checkInShowcase(widget, showcaseFiles);
    const hasScreenshot = checkHasScreenshotTest(widget, widgetsSpec, helpers);
    const variations = checkHasVariationTests(widget, fixtures);
    const hasUnitTests = checkHasUnitTests(widget, testFiles);
    const fixtureData = checkHasFixtures(widget);

    return {
      widget,
      componentExists,
      hasId,
      inShowcase,
      hasScreenshot,
      variations,
      hasUnitTests,
      fixtureData,
    };
  });

  // --- Print results ---
  console.log('Production Widget Compliance');
  console.log('----------------------------\n');

  // Header
  const cols = ['Widget', 'Status', 'File', 'ID', 'Showcase', 'Screenshot', 'Variations', 'Unit Tests', 'Fixtures'];
  const widths = [25, 9, 6, 5, 10, 12, 12, 12, 10];

  console.log(cols.map((c, i) => c.padEnd(widths[i])).join(' '));
  console.log(cols.map((_, i) => '-'.repeat(widths[i])).join(' '));

  let totalPass = 0;
  let totalChecks = 0;

  results.forEach(r => {
    const checks = [
      r.componentExists,
      r.hasId,
      r.inShowcase,
      r.hasScreenshot,
      r.hasUnitTests,
    ];
    const passed = checks.filter(Boolean).length;
    totalPass += passed;
    totalChecks += checks.length;

    const varText = r.variations.has ? `${r.variations.count} vars` : 'none';
    const fixText = r.fixtureData.has ? `${r.fixtureData.count} files` : 'none';

    console.log([
      r.widget.name.padEnd(widths[0]),
      r.widget.status.padEnd(widths[1]),
      (r.componentExists ? 'YES' : 'NO').padEnd(widths[2]),
      (r.hasId ? 'YES' : 'NO').padEnd(widths[3]),
      (r.inShowcase ? 'YES' : 'NO').padEnd(widths[4]),
      (r.hasScreenshot ? 'YES' : 'NO').padEnd(widths[5]),
      varText.padEnd(widths[6]),
      (r.hasUnitTests ? 'YES' : 'NO').padEnd(widths[7]),
      fixText.padEnd(widths[8]),
    ].join(' '));
  });

  console.log('\n');

  // --- Summary ---
  const withId = results.filter(r => r.hasId).length;
  const inShowcase = results.filter(r => r.inShowcase).length;
  const withScreenshot = results.filter(r => r.hasScreenshot).length;
  const withVariations = results.filter(r => r.variations.has).length;
  const withUnitTests = results.filter(r => r.hasUnitTests).length;
  const withFixtures = results.filter(r => r.fixtureData.has).length;
  const total = results.length;

  console.log('Summary');
  console.log('-------');
  console.log(`Component exists:     ${total}/${total}`);
  console.log(`Has widget ID:        ${withId}/${total}${withId < total ? ' (GAPS: ' + results.filter(r => !r.hasId).map(r => r.widget.name).join(', ') + ')' : ''}`);
  console.log(`In showcase:          ${inShowcase}/${total}${inShowcase < total ? ' (GAPS: ' + results.filter(r => !r.inShowcase).map(r => r.widget.name).join(', ') + ')' : ''}`);
  console.log(`Screenshot tests:     ${withScreenshot}/${total}${withScreenshot < total ? ' (GAPS: ' + results.filter(r => !r.hasScreenshot).map(r => r.widget.name).join(', ') + ')' : ''}`);
  console.log(`Variation tests:      ${withVariations}/${total}`);
  console.log(`Unit tests:           ${withUnitTests}/${total}${withUnitTests < total ? ' (GAPS: ' + results.filter(r => !r.hasUnitTests).map(r => r.widget.name).join(', ') + ')' : ''}`);
  console.log(`Fixture data:         ${withFixtures}/${total}`);

  console.log('\n');

  // --- Non-widget components ---
  console.log('Non-Widget Components');
  console.log('---------------------\n');

  // Map non-widget names to alternative showcase search terms
  const nonWidgetAltNames = {
    FocusOverlay: 'focusOverlay',
    DndOverlay: 'dndOverlay',
  };

  NON_WIDGETS.forEach(nw => {
    const exists = fileExists(`src/components/${nw.file}`);
    const altName = nonWidgetAltNames[nw.name];
    const inShow = showcaseFiles.some(c =>
      c.includes(nw.name) || (altName && c.includes(altName))
    );
    console.log(`${nw.name.padEnd(20)} ${nw.type.padEnd(10)} File: ${exists ? 'YES' : 'NO'}  Showcase: ${inShow ? 'YES' : 'NO'}`);
  });

  console.log('\n');

  // --- Sandbox widget count ---
  const githubComponents = dirEntries('src/components/github')
    .filter(f => f.endsWith('.astro'))
    .map(f => f.replace('.astro', ''));
  const locationComponents = dirEntries('src/components/location')
    .filter(f => f.endsWith('.astro'))
    .map(f => f.replace('.astro', ''));

  const prodGithub = PRODUCTION_WIDGETS.filter(w => w.file.startsWith('github/')).map(w => w.name);
  const prodLocation = PRODUCTION_WIDGETS.filter(w => w.file.startsWith('location/')).map(w => w.name);

  const sandboxGithub = githubComponents.filter(c => !prodGithub.includes(c));
  const sandboxLocation = locationComponents.filter(c => !prodLocation.includes(c));

  console.log('Sandbox Widgets');
  console.log('---------------');
  console.log(`GitHub showcase:   ${sandboxGithub.length} components`);
  console.log(`Location showcase: ${sandboxLocation.length} components`);
  console.log(`Total sandbox:     ${sandboxGithub.length + sandboxLocation.length} components`);

  // Exit with non-zero if there are critical gaps
  const criticalGaps = results.filter(r =>
    r.widget.status === 'shipped' && (!r.hasId || !r.inShowcase)
  );
  if (criticalGaps.length > 0) {
    console.log('\n\x1b[31mCRITICAL: Shipped widgets missing ID or showcase entry!\x1b[0m');
    criticalGaps.forEach(r => {
      const issues = [];
      if (!r.hasId) issues.push('missing ID');
      if (!r.inShowcase) issues.push('not in showcase');
      console.log(`  ${r.widget.name}: ${issues.join(', ')}`);
    });
    process.exit(1);
  }

  console.log('\n\x1b[32mCompliance check complete.\x1b[0m');
}

main();
