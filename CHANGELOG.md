# @xsynaptic/astro-comments

## 0.3.0

### Minor Changes

- The handler answers in JSON only; `formAge` becomes `fillTimeMs`; the CLI adds `--help`, `pending --json`, `approve`, `reject` and `spam` by id, and `delete --yes`

### Patch Changes

- `buildThreadRegistry` refuses a key claimed with two closing times; `createAssetsThreadResolver` keeps one registry per path

## 0.2.0

### Minor Changes

- Add `buildThreadRegistry`, `gatherComments`, `createAssetsThreadResolver`, a `publishEmailHash` option on the D1 store and config, `ignoredOrphans` in the config and `maxAgeSeconds` on `createThreadResolver`; the form's `renderedAt` timestamp becomes `formAge`, the milliseconds the element measured

## 0.1.0

### Minor Changes

- Initial release
