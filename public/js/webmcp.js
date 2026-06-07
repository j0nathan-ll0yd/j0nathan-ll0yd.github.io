(function() {
  if (typeof navigator !== 'undefined' && navigator.modelContext && navigator.modelContext.provideContext) {
    var profile = {
      name: 'Jonathan Lloyd',
      title: 'Engineering Director',
      location: 'San Francisco, CA',
      experience: '24+ years in software engineering',
      site: 'https://jonathanlloyd.me',
      github: 'https://github.com/j0nathan-ll0yd',
      linkedin: 'https://www.linkedin.com/in/lifegames/',
      bio: 'Engineering director and backend engineer. Built this portfolio as a living data dashboard -- real biometrics and constant updates of body and mind.',
      expertise: [
        'Backend Engineering', 'Software Engineering', 'Engineering Leadership',
        'Cloud Infrastructure', 'Data Visualization', 'Serverless Architecture',
        'TypeScript', 'Go', 'AWS'
      ],
      interests: ['programming', 'pc gaming', 'musical theatre', 'edm', 'conversation']
    };

    var dataSources = [
      { name: 'Health biometrics', url: 'https://d1pfm520aduift.cloudfront.net/health.json', description: 'Heart rate, HRV, activity, workouts (7-day aggregates)' },
      { name: 'Sleep data', url: 'https://d1pfm520aduift.cloudfront.net/sleep.json', description: 'Sleep phases, duration, efficiency' },
      { name: 'Focus state', url: 'https://d1pfm520aduift.cloudfront.net/focus.json', description: 'Do Not Disturb and focus mode status' },
      { name: 'GitHub activity', url: 'https://d1pfm520aduift.cloudfront.net/github-events.json', description: 'Dev activity, languages, contributions, commits' },
      { name: 'Starred repos', url: 'https://d1pfm520aduift.cloudfront.net/github-starred-repos.json', description: 'GitHub starred repositories' },
      { name: 'Bookshelf', url: 'https://d1pfm520aduift.cloudfront.net/books.json', description: 'Books with status, ratings, progress' },
      { name: 'Reading feed', url: 'https://d1pfm520aduift.cloudfront.net/articles.json', description: 'Starred articles and RSS feed items' },
      { name: 'Theatre reviews', url: 'https://d1pfm520aduift.cloudfront.net/theatre-reviews.json', description: 'Theatre show reviews with ratings' },
      { name: 'Workouts', url: 'https://d1pfm520aduift.cloudfront.net/workouts.json', description: 'Workout sessions, type, duration, calories' },
      { name: 'Location', url: 'https://d1pfm520aduift.cloudfront.net/location.json', description: 'Aggregated place summaries' }
    ];

    navigator.modelContext.provideContext({
      tools: [
        {
          name: 'get_profile',
          description: 'Returns professional profile: name, title, location, experience, expertise, and social links for Jonathan Lloyd.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(profile) }] };
          }
        },
        {
          name: 'get_data_sources',
          description: 'Returns a list of all live JSON data endpoints on CloudFront with descriptions. Fetch these URLs for real-time data.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return { content: [{ type: 'text', text: JSON.stringify(dataSources) }] };
          }
        },
        {
          name: 'get_current_reading',
          description: 'Fetches the current bookshelf from the live API and returns books being read, up next, and recently finished.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            return fetch('https://d1pfm520aduift.cloudfront.net/books.json')
              .then(function(res) { return res.json(); })
              .then(function(data) {
                var books = data.books || [];
                var reading = books.filter(function(b) { return b.status === 'reading'; });
                var upNext = books.filter(function(b) { return b.status === 'up-next'; });
                var finished = books.filter(function(b) { return b.status === 'finished'; }).slice(0, 5);
                return { content: [{ type: 'text', text: JSON.stringify({ reading: reading, upNext: upNext, recentlyFinished: finished }) }] };
              });
          }
        },
        {
          name: 'get_tech_stack',
          description: 'Returns the technology stack and architecture details of this portfolio site.',
          inputSchema: { type: 'object', properties: {}, required: [] },
          execute: function() {
            var stack = {
              framework: 'Astro 6.x (static site generation, 0 KB JS by default)',
              hosting: 'Cloudflare Pages via GitHub Actions',
              liveData: 'CloudFront-backed JSON API polled at runtime',
              design: 'Glass-morphism dark theme, fluid clamp() responsive tokens, CSS container queries',
              font: 'Space Grotesk (self-hosted, variable woff2)',
              llmContent: {
                discoveryIndex: 'https://jonathanlloyd.me/llms.txt',
                snapshot: 'https://d1pfm520aduift.cloudfront.net/llms-small.txt',
                complete: 'https://d1pfm520aduift.cloudfront.net/llms-full.txt'
              }
            };
            return { content: [{ type: 'text', text: JSON.stringify(stack) }] };
          }
        }
      ]
    });
  }
})();
