// Points the local `astro preview` Worker at the fixture data plane (plan Step 6.2).
// `astro build` copies local secrets into dist/server/.dev.vars and postbuild deletes the file, so
// this runs after the build, in the preview command. SSR_FAULT_INJECTION lets a test send
// `X-SSR-Fault` to the loopback preview (src/lib/data-plane/faults.ts).
import {mkdirSync, writeFileSync} from 'node:fs'
import path from 'node:path'
import {serverDir} from '../../scripts/lib/build-paths.mjs'

const port = process.env.DATA_PLANE_PORT ?? '4399'
mkdirSync(serverDir(), {recursive: true})
writeFileSync(path.join(serverDir(), '.dev.vars'), `DATA_PLANE_BASE=http://127.0.0.1:${port}\nSSR_FAULT_INJECTION=1\n`)
console.log(`[write-dev-vars] DATA_PLANE_BASE=http://127.0.0.1:${port}`)
