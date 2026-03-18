import { execSync } from 'child_process';

export async function setup() {
  execSync('npm run build', { stdio: 'inherit', cwd: process.cwd() });
}
