## Summary

<!-- What does this PR change and why? -->

## CSP / Inline-JS checklist

- [ ] If I added a `<script>` tag: it has a `src=` attribute (no inline body), OR it is a bundled module `<script>` (no `is:inline`).
- [ ] If I added a DOM event handler: it's attached in `public/js/*.js`, not as an `on*=` attribute.

## Comment discipline

- [ ] Added markup comments encode a non-obvious WHY (per agent-enforcement W16)
- [ ] In `.astro`, WHY notes use `{/* */}` (not `<!-- -->`, which ships to the DOM)

## Test plan

<!-- How was this verified? -->
