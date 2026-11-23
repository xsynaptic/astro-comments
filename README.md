# @xsynaptic/astro-comments

Static, moderated comments for Astro sites. A visitor posts to an endpoint, the comment waits as `pending`, a moderator approves it, and the next build renders it into the page. The package is headless: it ships data, behaviour and a markup contract, and the site owns every template and style. The handler takes any `CommentStore` and `CommentChallenge`; `./cloudflare` ships D1 and Turnstile ones.

```sh
pnpm add @xsynaptic/astro-comments
```

## Entry points

| Export | Holds | Runs on |
| --- | --- | --- |
| `.` | Handler, schemas, messages, store interfaces | Server |
| `./cloudflare` | D1 store, Turnstile siteverify | Server |
| `./cloudflare/node` | D1 over HTTP, wrangler's local D1 | Node |
| `./snapshot`, `./cli`, `./config` | Snapshot read and write, commands, `defineCommentsConfig` | Node |
| `./render` | `buildThread`, `renderCommentBody`, `toAuthorHref` | Build |
| `./import` | WordPress body and row conversion | Node |
| `./migrations/*` | The table's SQL, for a test database | Node |
| `./element`, `./cloudflare/widget` | `<comments-section>`, `TurnstileWidget` | Browser |

`./render` stays separate so a server bundle never pulls in markdown-it.

## Usage

The [playground](playground/) is the reference implementation: an endpoint mounting the handler, a template rendering the markup the element expects, and the element registered with a challenge widget. Run `astro-comments` for the CLI's commands.
