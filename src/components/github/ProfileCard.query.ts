export const meta = {
  name: 'Profile Card',
  description: 'GitHub profile summary with avatar, name, bio, follower/following, member since, and public repos',
  api: 'graphql' as const,
};

export const query = `
  query($login: String!) {
    user(login: $login) {
      avatarUrl
      name
      bio
      followers {
        totalCount
      }
      following {
        totalCount
      }
      createdAt
      repositories(ownerAffiliations: OWNER, privacy: PUBLIC) {
        totalCount
      }
    }
  }
`;

export const variables = { login: 'j0nathan-ll0yd' };

export const sampleData = {
  avatarUrl: '/assets/avatar.svg',
  name: 'Jonathan Lloyd',
  bio: 'Senior Software Engineer building at the intersection of systems and interfaces',
  followers: 342,
  following: 89,
  createdAt: 'Member since Jan 2013',
  publicRepos: 42,
};

export const emptyData: typeof sampleData = {
  avatarUrl: "",
  name: "",
  bio: "",
  followers: 0,
  following: 0,
  createdAt: "",
  publicRepos: 0,
};

export function transform(response: any): typeof sampleData {
  const user = response.data.user;
  const date = new Date(user.createdAt);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const createdAt = `Member since ${months[date.getMonth()]} ${date.getFullYear()}`;

  return {
    avatarUrl: user.avatarUrl,
    name: user.name || user.login,
    bio: user.bio || '',
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    createdAt,
    publicRepos: user.repositories.totalCount,
  };
}
