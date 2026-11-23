# AGENTS.md

Add to this file only what an agent can't infer from the code and config.

## Builds read `dist`

- The playground and the end-to-end specs read the build, not `src`. `pnpm test:e2e` builds first; anything else run against the playground needs `pnpm build` (or `pnpm dev`) after an edit
- The bin and `migrations/` resolve through the package's own name, so they work from `src`, `dist` and a consumer's `node_modules` alike; keep new runtime file lookups on that pattern rather than a path relative to the source file
- Imports use the `#*` subpath map with an explicit `.ts` extension (`#cli/schema.ts`), sibling files included

## Checks

- Lefthook is the gate and there is no CI: `pnpm check` reports, `pnpm fix` autofixes then rechecks
- `pnpm test:e2e` runs on demand, outside the gate; run it after changing anything under `src/element/` or `src/submission.ts`
- Every browser entry has a brotli budget in `.size-limit.json`, measured from `src`; `pnpm size --why` shows a treemap
- The budgets match the shipped bytes because tsdown here is rolldown with minify off; recheck that if `tsdown.config.ts` gains a `define` or a plugin
- Browser globals are allowed only under `src/element/`; ESLint rejects them elsewhere, since the server entries run in Workers and Node

## Schema

- Until 1.0, `migrations/0000-initial.sql` is the table's one definition and changes in place; the package keeps no record of the table settling
- From 1.0, files under `migrations/` freeze, since sites copy them into their own history; a table change then ships as a new numbered file, expand then contract
- `astro-comments schema` heads what it writes with `-- @xsynaptic/astro-comments <migration>`, so a later version can tell which package migrations a site already holds; the writer for steps after `0000-initial` arrives with the first one

## Published custom elements

- A `define…()` function registers the element and takes its options. The class extends a stand-in where `HTMLElement` is undefined, so the entry imports cleanly in server code
- `sideEffects` stays `false` only while no module calls `customElements.define` at load; given `false`, tsdown drops such an import, the element never upgrades, and the build stays green
- An element reports through a bubbling `<owner>:<action>` event, its typed detail declared in `GlobalEventHandlersEventMap`, and never sends analytics itself; what to send is the site's call
- The element renders nothing of its own: it works on the light DOM the site's template renders, and the package ships no CSS

## Releases

- Pre-1.0: break APIs freely, with no compatibility shims, migration notes or staged releases
- Every package change takes a minimal changeset, except a change confined to the README, which ships with the next release, or to `verify/`, `playground/` or `scripts/`, which never ship
- The operator commits the version bump and publishes, through `pnpm release`
