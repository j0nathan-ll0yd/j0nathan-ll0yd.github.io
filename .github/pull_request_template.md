> **WARNING: merging this PR deploys production.** A push to `main` runs `.github/workflows/deploy.yml`, which publishes straight to the `human-datastream` Cloudflare Pages project serving <https://jonathanlloyd.me>. There is no staging gate and no approval step.

- [ ] I verified this change on the pull-request preview deployment, and I accept that merging ships it to production.

## Summary

<!-- What does this PR change and why? -->

## CSP / Inline-JS checklist

- [ ] If I added a `<script>` tag: it has a `src=` attribute (no inline body), OR it is a bundled module `<script>` (no `is:inline`).
- [ ] If I added a DOM event handler: it's attached in `public/js/*.js`, not as an `on*=` attribute.

## Comment discipline

- [ ] Added markup comments encode a non-obvious WHY (per agent-enforcement W16)
- [ ] In `.astro`, WHY notes use `{/* */}` (not `<!-- -->`, which ships to the DOM)

## Fixtures (Invariant I2)

- [ ] No consumer-side fixtures added (`data/`, `test/fixtures/`, `src/**/fixtures/`); fixtures are DS-owned in `@j0nathan-ll0yd/fixtures` (`pnpm run audit:fixtures` passes).
- [ ] No production module imports `@j0nathan-ll0yd/fixtures`, directly or transitively (devDependency for tests only; the `forbid-fixtures` Vite plugin fails `pnpm build`).

## Test plan

<!-- How was this verified? -->
