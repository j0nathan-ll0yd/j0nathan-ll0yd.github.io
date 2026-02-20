export const meta = {
  name: 'Dev Activity Cards',
  description: 'Rich glass card feed of commits, PRs, and issues with colored left borders',
  api: 'webhook' as const,
};

export const query = '';

export const sampleData = {
  events: [
    { type: 'commit' as const, repo: 'lifegames/api', title: 'Fix auth token refresh logic', date: '2h ago', hash: 'a1b2c3d', additions: 24, deletions: 8 },
    { type: 'pr_merged' as const, repo: 'lifegames/ios', title: 'Add biometric login flow', date: '5h ago', number: 142 },
    { type: 'issue_opened' as const, repo: 'lifegames/api', title: 'Rate limiter drops WebSocket frames', date: '8h ago', number: 89 },
    { type: 'commit' as const, repo: 'j0nathan-ll0yd.github.io', title: 'Update profile components', date: '1d ago', hash: 'e4f5g6h', additions: 156, deletions: 12 },
    { type: 'pr_opened' as const, repo: 'lifegames/infrastructure', title: 'Terraform module for edge caching', date: '1d ago', number: 31 },
    { type: 'issue_closed' as const, repo: 'lifegames/api', title: 'Memory leak in event loop', date: '2d ago', number: 74 },
    { type: 'pr_closed' as const, repo: 'j0nathan-ll0yd.github.io', title: 'Experimental dark mode toggle', date: '3d ago', number: 8 },
    { type: 'commit' as const, repo: 'lifegames/infrastructure', title: 'Add CloudFront cache invalidation', date: '4d ago', hash: 'm0n1o2p', additions: 42, deletions: 18 },
  ],
};

export const emptyData: typeof sampleData = {
  events: [],
};

export function transform(response: any): typeof sampleData {
  return response;
}
