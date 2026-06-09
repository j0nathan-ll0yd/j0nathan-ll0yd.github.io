#!/usr/bin/env bash
set -euo pipefail

node -e "process.stdout.write(require('./package-lock.json').packages['node_modules/@playwright/test'].version)"
