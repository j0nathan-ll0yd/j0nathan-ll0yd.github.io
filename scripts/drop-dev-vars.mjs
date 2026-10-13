#!/usr/bin/env node
/* Deletes dist/server/.dev.vars after `astro build` (atlas decision 0160, PR A).
 *
 * The Cloudflare Vite plugin copies local secrets (.dev.vars, .env, .env.local) into
 * dist/server/.dev.vars for `astro preview`. Deploys never read that file: the assets come from
 * dist/client/ and the upload takes only the .js and .mjs modules. The site's Worker reads no
 * environment variable at all, so the file holds only a developer's unrelated local secrets, and a
 * build directory that someone archives or uploads must not carry them. */
import {rmSync} from 'node:fs'
import path from 'node:path'
import {serverDir} from './lib/build-paths.mjs'

const devVars = path.join(serverDir(), '.dev.vars')
rmSync(devVars, {force: true})
console.log(`[drop-dev-vars] removed ${path.relative(process.cwd(), devVars)} if present`)
