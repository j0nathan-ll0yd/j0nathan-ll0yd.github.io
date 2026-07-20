# Sources and Acknowledgments

A running log of the external authors, articles, and references that have shaped
how this site is built. When an outside source informs a design or engineering
decision here -- a blog post, a spec, a talk, a reference implementation -- it
gets an entry below so the people who did the thinking get credited.

This is a **log**, not a bibliography: newest entries first, each one recording
what was consulted, what we concluded, and -- most importantly -- **what we
actually did about it**, in plain prose. A source earns a place here even when we
ultimately disagreed with it; the input still mattered.

## How to add an entry

1. Add a new `###` section at the **top** of the log (reverse-chronological).
2. Record the date (`YYYY-MM-DD`), the source title, the author, and a stable URL.
3. Summarize the recommendation and how we validated it (cite corroborating or
   dissenting sources you checked).
4. Write a **"What we did"** paragraph: narrate the concrete action the source
   prompted -- what we reviewed, what we changed, what we chose not to change and
   why, and any bug or follow-up it surfaced. Link the PR / commit. This is the
   part that makes the log worth keeping; do not reduce it to a one-liner.
5. Attribute honestly: name the person, link the original, and note the license
   or usage terms if we adopted any of their code or text verbatim.

---

## Log

### 2026-07-20 -- `font-family` recommendations

- **Source:** [font-family recommendations](https://chrismorgan.info/font-family)
- **Author:** Chris Morgan ([chrismorgan.info](https://chrismorgan.info))
- **Status of source:** Live draft, started 2026-05-09; discussed on
  [Hacker News](https://news.ycombinator.com/item?id=48692310) and
  [Lobsters](https://lobste.rs/s/madoeq/font_family_recommendations).

**What it recommends.** Prefer generic families (`sans-serif`, `serif`,
`monospace`) and stop enumerating long OS-font stacks; always end a stack in a
generic fallback (the `monospace` fallback is the one that most often actually
matters); avoid `system-ui` / `ui-*` for body content because Windows maps
content languages poorly and can substitute an inappropriate CJK font; and keep
the `monospace, monospace` trick to dodge Firefox's separate (smaller) default
monospace size -- with the caveat that Lightning CSS mangles the literal
duplicate, so `monospace, m` is the workaround there.

**How we validated it.** The `system-ui`-for-content warning is corroborated by
current [MDN guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)
and [w3c/csswg-drafts#3658](https://github.com/w3c/csswg-drafts/issues/3658);
Docusaurus and VitePress have both dropped `system-ui` for this reason. The
Firefox monospace-size quirk traces to
[Bugzilla 76191](https://bugzilla.mozilla.org/show_bug.cgi?id=76191) and is still
a cheap, harmless defensive fix. The stricter "never enumerate named fonts"
stance is a legitimate but contested opinion -- the
[Modern Font Stacks](https://github.com/system-fonts/modern-font-stacks) project
and several commenters in his own threads argue curated stacks are "never worse
than generic, usually better." The article does not cover emoji fonts.

**What we did.** We audited every `font-family` declaration and font token that
reaches the site (this repo plus the yalc-linked `@lifegames/tokens` design
system, which is the source of truth for font values) against Morgan's advice.
The good news first: our rendered typography already matches the shape he
endorses -- body and headings resolve to `'Space Grotesk', 'Space Grotesk
Fallback', sans-serif`, i.e. a single intentional brand font, a metric-matched
fallback, and a generic terminator -- so no change to the visible stacks was
warranted. Where the audit paid off was as a forcing function to actually _look_
at the font plumbing, and in doing so it surfaced a genuine, live production bug
that had nothing to do with the stacks themselves: `Dashboard.astro` imported the
design system's `preamble`, `css.layered`, `compat`, `components`, `effects`, and
`reset` stylesheets but **never imported `@lifegames/tokens/fonts`, the file that
holds the `@font-face` rules**. A stale comment even claimed the `@font-face`
rules came from `preamble` (they do not -- `preamble` only declares the cascade
layer order). The result: `@font-face` appeared zero times in the built output,
the preloaded 22 KB `space-grotesk-latin.woff2` was fetched but never claimed by
any rule, and every `'Space Grotesk'` reference silently fell through to the
system `sans-serif`. **The brand font had never been rendering in production.**
We fixed it in this repo by adding the missing `@import '@lifegames/tokens/fonts'`
to the global style block in `Dashboard.astro` and correcting the two misleading
comments (the font-loading claim and a "preloaded but not used" warning that had
been misattributed to a Vite dev-server timing artifact). After the fix a
production build emits the four expected `@font-face` rules and the preload is
consumed. Because the previous visual-regression baselines were minted while the
font was silently falling back to Arial, they must be regenerated in Docker
(`npm run test:visual:update`) as a follow-up so they reflect the real Space
Grotesk glyphs.

We deliberately did **not** touch the visible font stacks, and we recorded two
latent design-system improvements for `design-system-Lifegames` (source of truth
for font tokens) rather than fixing them here, since they are cross-repo and
currently unused in this repo:

1. `--lg-typography-code-font-family` is `'system-ui', sans-serif` -- it uses
   `system-ui` and has **no `monospace` fallback**, both of which Morgan's
   article argues against for code.
2. Confirm the `monospace, monospace` guard is safe in the DS build pipeline (it
   is safe here -- this repo does not use Lightning CSS).
