export const meta = {
  name: 'Activity Feed',
  description: 'Mixed event feed showing recent pushes, PRs, issues, and stars',
  api: 'rest' as const,
};

export const query = `GET /users/{username}/events/public?per_page=15`;

export const variables = { username: 'j0nathan-ll0yd' };

export const sampleData = {
  events: [
    { type: 'pushed', repo: 'lifegames/api', title: 'Update auth middleware', date: '2h ago', detail: '3 commits' },
    { type: 'opened PR', repo: 'lifegames/ios', title: 'Add biometric login flow', date: '5h ago', detail: '#142' },
    { type: 'starred', repo: 'astro-community/docs', title: 'astro-community/docs', date: '8h ago', detail: '' },
    { type: 'opened issue', repo: 'lifegames/api', title: 'Rate limiter drops WebSocket frames', date: '1d ago', detail: '#89' },
    { type: 'pushed', repo: 'j0nathan-ll0yd.github.io', title: 'Update profile components', date: '1d ago', detail: '1 commit' },
    { type: 'created', repo: 'lifegames/api', title: 'branch feature/auth', date: '2d ago', detail: '' },
    { type: 'opened PR', repo: 'j0nathan-ll0yd.github.io', title: 'Add GitHub widget system', date: '3d ago', detail: '#7' },
    { type: 'pushed', repo: 'lifegames/infrastructure', title: 'Terraform module updates', date: '4d ago', detail: '5 commits' },
  ],
};

export const emptyData: typeof sampleData = {
  events: [],
};

interface EventData {
  type: string;
  repo: string;
  title: string;
  date: string;
  detail: string;
}

function relativeDate(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

function mapEventType(event: any): string {
  switch (event.type) {
    case 'PushEvent': return 'pushed';
    case 'PullRequestEvent': return 'opened PR';
    case 'IssuesEvent': return 'opened issue';
    case 'WatchEvent': return 'starred';
    case 'CreateEvent': return 'created';
    default: return event.type.replace('Event', '').toLowerCase();
  }
}

function mapEventTitle(event: any): string {
  switch (event.type) {
    case 'PushEvent': {
      const commits = event.payload.commits || [];
      return commits.length > 0 ? commits[0].message.split('\n')[0] : 'Push';
    }
    case 'PullRequestEvent':
      return event.payload.pull_request?.title || 'Pull request';
    case 'IssuesEvent':
      return event.payload.issue?.title || 'Issue';
    case 'WatchEvent':
      return event.repo.name;
    case 'CreateEvent':
      return (event.payload.ref_type || '') + ' ' + (event.payload.ref || event.repo.name);
    default:
      return event.repo.name;
  }
}

function mapEventDetail(event: any): string {
  switch (event.type) {
    case 'PushEvent': {
      const count = (event.payload.commits || []).length;
      return count + ' commit' + (count !== 1 ? 's' : '');
    }
    case 'PullRequestEvent':
      return '#' + (event.payload.pull_request?.number || '');
    case 'IssuesEvent':
      return '#' + (event.payload.issue?.number || '');
    default:
      return '';
  }
}

export function transform(response: any): typeof sampleData {
  const rawEvents: any[] = Array.isArray(response) ? response : [];
  const events: EventData[] = rawEvents.slice(0, 8).map((event: any) => ({
    type: mapEventType(event),
    repo: event.repo?.name?.replace(/^[^/]+\//, '') || '',
    title: mapEventTitle(event),
    date: relativeDate(event.created_at),
    detail: mapEventDetail(event),
  }));

  return { events };
}
