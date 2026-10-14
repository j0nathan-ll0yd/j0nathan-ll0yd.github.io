// The build output layout (atlas decision 0160, PR A; plan Step 3.4). With the Cloudflare adapter,
// `astro build` writes the static files, the ones the Workers static-asset plane serves, to
// dist/client/, and the Worker bundle with its generated wrangler.json to dist/server/. Every
// script and build test that reads the built site resolves its paths from here.
import path from 'node:path'

/** The static-asset directory, relative to the repository root. */
export const CLIENT_DIR = path.join('dist', 'client')

/** The Worker bundle directory, relative to the repository root. */
export const SERVER_DIR = path.join('dist', 'server')

/** The static-asset directory, absolute, for the current working directory. */
export const clientDir = (cwd = process.cwd()) => path.resolve(cwd, CLIENT_DIR)

/** The Worker bundle directory, absolute, for the current working directory. */
export const serverDir = (cwd = process.cwd()) => path.resolve(cwd, SERVER_DIR)
