import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const distDir = path.resolve(process.cwd(), 'dist');
const webfingerPath = path.join(distDir, '.well-known', 'webfinger');

interface JrdLink {
  rel: string;
  type?: string;
  href?: string;
  template?: string;
}
interface Jrd {
  subject: string;
  aliases?: string[];
  links: JrdLink[];
}

let jrd: Jrd;

beforeAll(() => {
  jrd = JSON.parse(readFileSync(webfingerPath, 'utf-8')) as Jrd;
});

describe('webfinger build output', () => {
  it('dist/.well-known/webfinger exists', () => {
    expect(existsSync(webfingerPath)).toBe(true);
  });

  it('subject is the custom-domain alias handle', () => {
    expect(jrd.subject).toBe('acct:jonathan@jonathanlloyd.me');
  });

  it('exposes a self link to the ActivityPub actor', () => {
    const self = jrd.links.find((l) => l.rel === 'self');
    expect(self, 'missing rel=self link').toBeDefined();
    expect(self?.type).toBe('application/activity+json');
    expect(self?.href).toBe('https://mastodon.social/ap/users/116794886250734590');
  });

  it('exposes an html profile-page link to the real account', () => {
    const profile = jrd.links.find(
      (l) => l.rel === 'http://webfinger.net/rel/profile-page',
    );
    expect(profile?.type).toBe('text/html');
    expect(profile?.href).toBe('https://mastodon.social/@j0nathan');
  });
});
