#!/usr/bin/env node

import {probeSuppression, suppressionDisposition, writeGithubOutputs} from './lib/suppression.mjs'
import {getOptionalEnv} from './lib/env.mjs'

const result = await probeSuppression()
const disposition = suppressionDisposition(result, 'focus-gated audit checks')

if (process.argv.includes('--github-output')) {
  await writeGithubOutputs(result, getOptionalEnv('GITHUB_OUTPUT'))
}

if (disposition === 'fail') {
  process.exitCode = 1
}
