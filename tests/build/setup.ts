import {execSync} from 'child_process'

export async function setup() {
  execSync('pnpm run build', {stdio: 'inherit', cwd: process.cwd()})
}
