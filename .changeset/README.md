# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

1. Run `pnpm changeset` and describe the change, picking a semver bump.
2. Commit the changeset alongside the work.
3. To publish, run `pnpm version-packages`, commit the result, then run `pnpm release`.

`access: public` in `config.json` publishes the scoped package publicly.
