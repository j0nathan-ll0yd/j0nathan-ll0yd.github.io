import {execSync} from 'child_process'

export async function setup() {
  // Vitest runs with NODE_ENV=test, and Vite derives import.meta.env.DEV from NODE_ENV, so an
  // inherited value built a dev-flavoured client bundle (live-data read `/api/live`, the dev
  // proxy). The build-output tests must inspect the bundle that deploys.
  execSync('pnpm run build', {stdio: 'inherit', cwd: process.cwd(), env: {...process.env, NODE_ENV: 'production'}})
}
