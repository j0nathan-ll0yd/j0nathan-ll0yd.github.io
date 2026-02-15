/**
 * app.js — Data fetching and Handlebars template rendering
 * Replaces htmx-ext-client-side-templates approach with direct fetch + render.
 */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const [profile, health, github, reading, books, system] = await Promise.all([
      fetch('../../data/profile.json').then(r => r.json()),
      fetch('../../data/health.json').then(r => r.json()),
      fetch('../../data/github.json').then(r => r.json()),
      fetch('../../data/reading.json').then(r => r.json()),
      fetch('../../data/books.json').then(r => r.json()),
      fetch('../../data/system.json').then(r => r.json()),
    ]);

    // Compile all Handlebars templates
    const tpl = {};
    document.querySelectorAll('script[type="text/x-handlebars-template"]').forEach(el => {
      tpl[el.id] = Handlebars.compile(el.innerHTML);
    });

    // Render each widget
    document.getElementById('identityCard').innerHTML = tpl.tplIdentity(profile);
    document.getElementById('terminalBody').innerHTML = tpl.tplTerminal(profile);
    document.getElementById('systemStatus').innerHTML = tpl.tplSystem(system);
    document.querySelector('#cardHR .widget-body').innerHTML = tpl.tplHeartRate(health);
    document.querySelector('#cardSteps .widget-body').innerHTML = tpl.tplActivity(health);
    document.getElementById('workoutsBody').innerHTML = tpl.tplWorkoutsInit(health);
    document.querySelector('#cardSleep .widget-body').innerHTML = tpl.tplSleep(health);
    document.querySelector('#cardGithub .widget-body').innerHTML = tpl.tplGithub(github);
    document.querySelector('#cardCommits .widget-body').innerHTML = tpl.tplCommits(github);
    document.querySelector('#cardReading .widget-body').innerHTML = tpl.tplReading(reading);
    var statusOrder = { next: 0, in_progress: 1, completed: 2 };
    var sortedBooks = books.books.slice().sort(function(a, b) {
      return (statusOrder[a.status] || 0) - (statusOrder[b.status] || 0);
    });
    document.querySelector('#cardBooks .widget-body').innerHTML = tpl.tplBooks({
      books: sortedBooks.slice(0, 5),
      statusLabels: books.statusLabels,
      bookMeta: books.bookMeta
    });
    document.querySelector('#cardLocation .widget-body').innerHTML = tpl.tplLocation(profile);

    // Store data for init.js
    window.__healthData = health;
    window.__profileData = profile;
    window.__booksData = books;
    window.__hydrationData = health.hydration;

    // Signal ready for init.js
    document.dispatchEvent(new Event('dataReady'));
  } catch (err) {
    console.error('Failed to load data:', err);
  }
});
