export const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6', JavaScript: '#f1e05a', Python: '#3572A5',
  Java: '#b07219', 'C#': '#178600', 'C++': '#f34b7d', C: '#555555',
  Go: '#00ADD8', Rust: '#dea584', Swift: '#F05138', Kotlin: '#A97BFF',
  Ruby: '#701516', PHP: '#4F5D95', Dart: '#00B4AB', Scala: '#c22d40',
  Shell: '#89e051', Lua: '#000080', Perl: '#0298c3', Haskell: '#5e5086',
  R: '#198CE7', Julia: '#a270ba', Elixir: '#6e4a7e', Clojure: '#db5855',
  Erlang: '#B83998', OCaml: '#ef7a08', 'F#': '#b845fc', Zig: '#ec915c',
  Nim: '#ffc200', V: '#4f87c4', Crystal: '#000100', 'Objective-C': '#438eff',
  HTML: '#e34c26', CSS: '#563d7c', SCSS: '#c6538c', Vue: '#41b883',
  Svelte: '#ff3e00', Astro: '#bc52ee', HCL: '#844FBA', Terraform: '#5c4ee5',
  Dockerfile: '#384d54', Makefile: '#427819', CMake: '#DA3434',
  PowerShell: '#012456', 'Vim Script': '#199f4b', 'Emacs Lisp': '#c065db',
  Nix: '#7e7eff', YAML: '#cb171e', TOML: '#9c4221', Markdown: '#083fa1',
  TeX: '#3D6117',
};

export const HYDRATION = {
  waterMax: 140,        // oz scale max
  caffeineMax: 500,     // mg scale max (visual headroom above FDA 400)
  waterRangeLo: 74,     // oz
  waterRangeHi: 125,    // oz
  caffeineRangeLo: 200, // mg
  caffeineRangeHi: 400, // mg FDA daily max
} as const;

export const STATUS_LABELS: Record<string, string> = {
  next: 'Up Next',
  in_progress: 'Reading',
  completed: 'Finished',
  finished: 'Finished',
} as const;

export const ACTIVITY_TYPE_MAP: Record<string, { label: string; url?: string }> = {
  'Other': { label: "Barry's Bootcamp", url: 'https://share.barrys.com/jsvsl' },
};

export const CLOUDFRONT_BASE = 'https://d3axfz0e3hiiuu.cloudfront.net';

export const WEBSOCKET_URL = 'wss://n7f7kuasbj.execute-api.us-west-2.amazonaws.com/live';

export const ENDPOINTS = {
  health: '/health.json',
  sleep: '/sleep.json',
  workouts: '/workouts.json',
  books: '/books.json',
  starredRepos: '/github-starred-repos.json',
  githubEvents: '/github-events.json',
  articles: '/articles.json',
  location: '/location.json',
  focus: '/focus.json',
  theatreReviews: '/theatre-reviews.json',
} as const;
