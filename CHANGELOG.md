# @xsynaptic/astro-comments

## 0.4.0

### Minor Changes

- The config's `ownerEmails` becomes `owners`, mapping an owner id to its emails, and a registry entry's `owners` names the ids that count on its page; the snapshot writes one row per line, ordered by thread, date and id; `astro-comments schema` takes no directory, writing to the D1 binding's `migrations_dir` from the wrangler config and creating it when missing

### Patch Changes

- `--local` keeps wrangler's secrets notice off stdout, so `pending --json --local` prints JSON alone, and never loads the site's `.env` into the local proxy as Worker secrets

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
