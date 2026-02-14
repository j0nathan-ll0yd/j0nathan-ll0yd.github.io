// Shared mock data for all design variations
// Reflects real API data shapes from HealthKit, GitHub API, and Feedbin API

// Generate a realistic contribution grid (52 weeks x 7 days)
function generateContributionGrid() {
  const grid = [];
  for (let week = 0; week < 52; week++) {
    const weekData = [];
    for (let day = 0; day < 7; day++) {
      const rand = Math.random();
      let value;
      if (rand < 0.3) value = 0;
      else if (rand < 0.6) value = 1;
      else if (rand < 0.8) value = 2;
      else if (rand < 0.95) value = 3;
      else value = 4;
      if (day === 0 || day === 6) value = Math.max(0, value - 1);
      weekData.push(value);
    }
    grid.push(weekData);
  }
  return grid;
}

// Generate hourly step data (24 values)
function generateHourlySteps() {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    let base = 0;
    if (h >= 7 && h <= 9) base = 600 + Math.random() * 400;    // morning commute
    else if (h >= 12 && h <= 13) base = 800 + Math.random() * 600; // lunch walk
    else if (h >= 17 && h <= 19) base = 500 + Math.random() * 800; // evening
    else if (h >= 10 && h <= 16) base = 100 + Math.random() * 300; // work hours
    else base = Math.random() * 50;                               // sleep/quiet
    hours.push(Math.round(base));
  }
  return hours;
}

// Generate hourly heart rate data (24 values)
function generateHourlyHR() {
  const hours = [];
  for (let h = 0; h < 24; h++) {
    let base;
    if (h >= 0 && h <= 6) base = 55 + Math.random() * 8;        // sleeping
    else if (h >= 7 && h <= 9) base = 68 + Math.random() * 15;   // morning
    else if (h >= 12 && h <= 13) base = 75 + Math.random() * 20;  // lunch activity
    else if (h >= 17 && h <= 19) base = 80 + Math.random() * 25;  // exercise
    else base = 62 + Math.random() * 12;                         // work/rest
    hours.push({ avg: Math.round(base), min: Math.round(base - 5 - Math.random() * 5), max: Math.round(base + 5 + Math.random() * 10) });
  }
  return hours;
}

// Generate sleep hypnogram (timeline of sleep stages through the night)
function generateHypnogram() {
  const stages = ['awake', 'rem', 'light', 'deep'];
  const timeline = [];
  let time = 22.5; // 10:30 PM
  const patterns = [
    { stage: 'awake', dur: 0.25 },
    { stage: 'light', dur: 0.5 }, { stage: 'deep', dur: 1.0 },
    { stage: 'light', dur: 0.5 }, { stage: 'rem', dur: 0.4 },
    { stage: 'light', dur: 0.3 }, { stage: 'deep', dur: 0.8 },
    { stage: 'light', dur: 0.5 }, { stage: 'rem', dur: 0.6 },
    { stage: 'awake', dur: 0.1 },
    { stage: 'light', dur: 0.4 }, { stage: 'deep', dur: 0.5 },
    { stage: 'light', dur: 0.3 }, { stage: 'rem', dur: 0.7 },
    { stage: 'light', dur: 0.4 }, { stage: 'rem', dur: 0.5 },
    { stage: 'awake', dur: 0.15 }
  ];
  patterns.forEach(function(p) {
    const start = time;
    time += p.dur;
    timeline.push({ stage: p.stage, start: start, end: time });
  });
  return timeline;
}

const MOCK_DATA = {
  profile: {
    name: "Jonathan Lloyd",
    title: "Senior Software Engineer",
    location: "San Francisco, CA",
    coordinates: [37.7749, -122.4194],
    linkedin: "https://www.linkedin.com/in/lifegames/",
    github: "https://github.com/j0nathan-ll0yd",
    bio: "Building things that matter. Passionate about elegant code, distributed systems, and the intersection of technology and human experience.",
    avatar: "assets/avatar.svg"
  },

  // ===== HEALTHKIT DATA =====
  health: {
    heartRate: {
      current: 72,
      resting: 58,
      walking: 82,
      hrv: 45,                // SDNN in ms (HKQuantityTypeIdentifier.heartRateVariabilitySDNN)
      vo2max: 42.5,           // mL/(kg·min) (HKQuantityTypeIdentifier.vo2Max)
      recovery: 22,           // BPM drop after 1 min (heartRateRecoveryOneMinute)
      todayMin: 52,
      todayMax: 128,
      todayAvg: 68,
      zones: { rest: 55, fatBurn: 104, cardio: 131, peak: 157 }, // HR zone thresholds
      data: [65, 68, 72, 70, 74, 71, 69, 72, 75, 68, 66, 70, 73, 71, 69, 67, 72, 74, 70, 68, 71, 73, 72, 70],
      hourly: generateHourlyHR(),
      weeklyResting: [59, 58, 60, 57, 58, 56, 58],  // 7-day resting HR trend
      weeklyHRV: [42, 44, 38, 47, 45, 50, 45]        // 7-day HRV trend
    },
    steps: {
      today: 8432,
      goal: 10000,
      distance: 6.2,         // km (distanceWalkingRunning)
      flights: 12,            // flights climbed
      walkingSpeed: 1.38,     // m/s (walkingSpeed)
      stepLength: 0.76,       // meters (walkingStepLength)
      asymmetry: 4.2,         // % (walkingAsymmetryPercentage)
      doubleSupport: 27.8,    // % (walkingDoubleSupportPercentage)
      weekly: [7200, 9100, 8400, 6800, 10200, 8900, 8432],
      weeklyDistance: [5.3, 6.7, 6.1, 5.0, 7.5, 6.5, 6.2],
      hourly: generateHourlySteps()
    },
    sleep: {
      lastNight: 7.4,         // total hours asleep
      timeInBed: 8.1,         // total hours in bed
      quality: 82,            // sleep quality score
      efficiency: 91,         // % (time asleep / time in bed)
      bedTime: "22:30",       // sleep onset
      wakeTime: "06:36",      // wake time
      onsetLatency: 15,       // minutes to fall asleep
      awakenings: 2,          // times woken
      respiratoryRate: 14.5,  // breaths/min during sleep
      spo2: 96,               // blood oxygen % during sleep
      phases: { deep: 1.8, rem: 2.1, light: 3.5 },
      hypnogram: generateHypnogram(),
      weeklySleep: [7.2, 6.8, 7.5, 7.1, 7.8, 6.9, 7.4],
      weeklyBedTimes: ["22:45", "23:15", "22:30", "22:50", "22:15", "23:30", "22:30"],
      weeklyWakeTimes: ["06:30", "06:45", "06:15", "06:20", "06:30", "06:45", "06:36"]
    }
  },

  // ===== GITHUB API DATA =====
  github: {
    contributions: generateContributionGrid(),
    totalContributions: 1847,
    // Contribution type breakdown (from GraphQL contributionsCollection)
    contributionTypes: {
      commits: 1203,
      pullRequests: 289,
      issues: 142,
      reviews: 198,
      repositories: 15
    },
    streak: { current: 12, longest: 47 },
    // Languages across all repos (from GET /repos/{owner}/{repo}/languages)
    languages: {
      JavaScript: 432500,
      TypeScript: 298620,
      Python: 145300,
      Swift: 87432,
      Go: 54200,
      CSS: 38100,
      HTML: 22400,
      Shell: 8900
    },
    recentCommits: [
      { hash: "a1b2c3d", message: "Fix auth token refresh", repo: "myapp", date: "2h ago", additions: 24, deletions: 8 },
      { hash: "e4f5g6h", message: "Add rate limiting middleware", repo: "api-gateway", date: "1d ago", additions: 156, deletions: 12 },
      { hash: "i7j8k9l", message: "Update dependencies", repo: "myapp", date: "2d ago", additions: 48, deletions: 52 },
      { hash: "m0n1o2p", message: "Implement WebSocket handlers", repo: "realtime-service", date: "3d ago", additions: 312, deletions: 45 },
      { hash: "q3r4s5t", message: "Refactor database queries", repo: "api-gateway", date: "5d ago", additions: 89, deletions: 134 }
    ],
    // Commit time distribution (commits per hour of day)
    commitHours: [2, 0, 0, 0, 0, 1, 3, 5, 12, 18, 22, 15, 8, 14, 20, 19, 16, 10, 6, 4, 5, 8, 6, 3],
    // Weekly commit activity (from /stats/commit_activity)
    weeklyCommits: [15, 22, 18, 31, 12, 25, 19, 28, 14, 23, 17, 20],
    stats: { repos: 42, stars: 128, contributions: 1847 },
    topRepos: [
      { name: "myapp", stars: 45, language: "TypeScript", description: "Personal app" },
      { name: "api-gateway", stars: 32, language: "Go", description: "API gateway service" },
      { name: "realtime-service", stars: 28, language: "JavaScript", description: "WebSocket service" },
      { name: "ml-pipeline", stars: 15, language: "Python", description: "ML data pipeline" },
      { name: "ios-app", stars: 8, language: "Swift", description: "iOS companion app" }
    ]
  },

  // ===== FEEDBIN API DATA =====
  reading: [
    { title: "Why SQLite Is So Great for the Edge", source: "fly.io/blog", date: "Today", category: "Tech", starred: true },
    { title: "The End of Localhost", source: "dx.tips", date: "Yesterday", category: "Tech", starred: false },
    { title: "Building AI Agents That Actually Work", source: "anthropic.com", date: "2 days ago", category: "AI", starred: true },
    { title: "CSS Container Queries Are Here", source: "web.dev", date: "3 days ago", category: "Web", starred: false },
    { title: "Rust for JavaScript Developers", source: "rustforjs.dev", date: "4 days ago", category: "Languages", starred: false },
    { title: "The Architecture of a Modern Startup", source: "danluu.com", date: "5 days ago", category: "Tech", starred: true },
    { title: "Why We Chose Turso Over PlanetScale", source: "chiselstrike.com", date: "6 days ago", category: "Databases", starred: false },
    { title: "Understanding V8 Internals", source: "mrale.ph", date: "1 week ago", category: "Web", starred: false }
  ],
  readingStats: {
    totalSubscriptions: 47,
    unreadCount: 128,
    articlesThisWeek: 23,
    articlesLastWeek: 19,
    weeklyVolume: [18, 22, 15, 28, 20, 19, 23], // articles read per day this week
    topSources: [
      { name: "fly.io/blog", count: 12 },
      { name: "anthropic.com", count: 8 },
      { name: "web.dev", count: 7 },
      { name: "danluu.com", count: 6 },
      { name: "dx.tips", count: 5 }
    ],
    categories: [
      { name: "Tech", feeds: 15, unread: 42 },
      { name: "AI", feeds: 8, unread: 31 },
      { name: "Web", feeds: 10, unread: 28 },
      { name: "Languages", feeds: 6, unread: 15 },
      { name: "Databases", feeds: 4, unread: 8 },
      { name: "Design", feeds: 4, unread: 4 }
    ],
    starredCount: 34
  },

  // ===== BOOKS DATA =====
  books: [
    { title: "Foundryside", author: "Robert Jackson Bennett",
      isbn: "9780525573844", asin: "0525573844", link: "https://amzn.to/3Mr9KEO",
      status: "in_progress", rating: null, progress: 42 },
    { title: "The Tainted Cup", author: "Robert Jackson Bennett",
      isbn: "9781984820710", asin: "1984820710", link: "https://amzn.to/3ZR4VrD",
      status: "completed", rating: 5, progress: 100 },
    { title: "A Drop of Corruption", author: "Robert Jackson Bennett",
      isbn: "9780593723848", asin: "0593723848", link: "https://amzn.to/4ae9LoP",
      status: "completed", rating: 4, progress: 100 },
    { title: "A Deadly Education", author: "Naomi Novik",
      isbn: "9780593128508", asin: "0593128508", link: "https://amzn.to/461xW7g",
      status: "completed", rating: 4, progress: 100 },
    { title: "Crafting Engineering Strategy", author: "Will Larson",
      isbn: "B0FBRJY116", asin: "B0FBRJY116", link: "https://amzn.to/3ZR52n3",
      status: "next", rating: null, progress: 0 }
  ],
  bookStats: { totalRead: 3, currentlyReading: 1, upNext: 1, avgRating: 4.3, booksThisYear: 4 }
};

// Make available globally when loaded via script tag
if (typeof window !== 'undefined') {
  window.MOCK_DATA = MOCK_DATA;
}
