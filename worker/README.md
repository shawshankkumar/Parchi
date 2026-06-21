# Parchi Worker — comments API + D1

Cloudflare Worker (TypeScript) implementing the Parchi comments API and the
`/g/:id.json` discovery doc, backed by a D1 database. This is the `/worker`
workstream from [`../CONTRACT.md`](../CONTRACT.md) — the authoritative interface
spec. Built with no web framework (a tiny hand-rolled router).

> **Toolchain:** [Bun](https://bun.sh) is the package manager and script runner
> (`bun install`, `bun run …`, `bunx …`). The Worker itself still runs on
> Cloudflare's **workerd** runtime via **Wrangler** — Bun does not run the Worker,
> it only manages deps and drives the `wrangler` CLI (`bunx wrangler …`).

## Endpoints

| Method | Path | Auth | Returns |
|---|---|---|---|
| `GET` | `/g/:id.json` | none | discovery doc (counts + URLs) |
| `GET` | `/api/comments?gist=<id>&state=open\|resolved\|deleted\|all` | none | `Comment[]` (ORDER BY id) |
| `POST` | `/api/comments` | Turnstile **or** `X-Agent-Key` | `201 { comment, edit_token }` |
| `GET` | `/api/comments/:cid` | none | `Comment` |
| `PATCH` | `/api/comments/:cid` | `X-Edit-Token` | `Comment` (sets `edited_at`) |
| `DELETE` | `/api/comments/:cid` | `X-Edit-Token` | `204` (soft delete: `status='deleted'`) |
| `POST` | `/api/comments/:cid/resolve` | Turnstile **or** `X-Agent-Key` | `Comment` (`status='resolved'`) |
| `POST` | `/api/comments/:cid/reopen` | Turnstile **or** `X-Agent-Key` | `Comment` (`status='open'`) |

`state` defaults to `open`. `all` = `open` + `resolved` (deleted is opt-in via
`state=deleted`).

## Auth model

- **Browser writes**: Turnstile is **optional**. If `TURNSTILE_SECRET` is set,
  the client sends `turnstile_token` (in the JSON body for POST/resolve/reopen)
  and the Worker verifies it via Turnstile `siteverify`. If `TURNSTILE_SECRET`
  is **not** set, browser writes are allowed (gated only by the per-IP rate
  limit) — set the secret to require human verification and cut bot/spam writes.
- **Trusted agents** send header `X-Agent-Key: <AGENT_KEY>` and bypass Turnstile,
  with a higher per-IP write rate limit.
- **Edit token**: `POST` returns a one-time `edit_token`. The Worker stores only
  `sha256(edit_token)`. `PATCH`/`DELETE` require header `X-Edit-Token` and the
  hash must match. The client keeps the token in `localStorage`.

## Other behavior

- **Lazy create**: no D1 row exists for a gist until its first comment.
- **Gist sanity check**: before the first insert, the Worker does a GET on
  `https://api.github.com/gists/:id` to validate the id. It reads **metadata
  status only** and never stores gist content.
- **Soft delete**: `DELETE` sets `status='deleted'`; the row is kept.
- **Input caps**: body ≤ 10 KB (bytes), author ≤ 80 chars.
- **Rate limit**: simple D1-backed fixed-window counter, per IP — 10 writes/min
  for browser callers, 120/min for trusted agents (table `rate_limit`, pruned on
  each check). Chosen for portability across isolates (in-memory state isn't
  shared between Worker instances).
- **CORS**: `OPTIONS` preflight handled; GET allowed from anywhere; allowed
  headers `X-Edit-Token, X-Agent-Key, Content-Type`. If `ALLOWED_ORIGIN` is set,
  it is honored for that origin; otherwise the requesting `Origin` is reflected
  (writes remain gated by Turnstile / `X-Agent-Key`).

## ID scheme

`src/id.ts` ports the opencode-style generator: `cmt_` + 12 hex chars
(`Date.now() * 0x1000 + counter`) + 14 base62 random = 26 chars, monotonic
within a millisecond so `ORDER BY id` is chronological. Uses
`crypto.getRandomValues`.

---

## Deploy (what you must do)

You need a **Cloudflare account** with Workers + D1 enabled. There is no
Cloudflare login configured in this repo, so run these yourself:

```bash
cd worker
bun install

# 1. Log in to Cloudflare
bunx wrangler login

# 2. Create the D1 database, then paste the printed database_id into
#    wrangler.toml ([[d1_databases]] -> database_id).
bunx wrangler d1 create parchi

# 3. Apply migrations to the REMOTE (production) D1 — creates the
#    `comments` and `rate_limit` tables. (--remote is required; the default
#    targets the local dev DB.)
bunx wrangler d1 migrations apply parchi --remote

# 4. (Optional) Set the Turnstile secret to gate browser comments against spam.
#    Without it, browser comments are open (rate-limited per IP).
#    Get it from the Cloudflare dashboard -> Turnstile -> your widget.
bunx wrangler secret put TURNSTILE_SECRET

# 5. (Optional) Set a trusted-agent key for the CLI/skill to bypass Turnstile.
bunx wrangler secret put AGENT_KEY

# 6. Deploy
bunx wrangler deploy
```

After step 6 your API base URL is printed, e.g.
`https://parchi-api.<account>.workers.dev`. Use that as `PARCHI_API` for the
renderer build.

### Local testing (no login required)

```bash
# typecheck
bunx tsc --noEmit

# build without deploying (no login needed)
bunx wrangler deploy --dry-run --outdir dist

# create a LOCAL D1 db and apply schema for `wrangler dev`
bunx wrangler d1 execute parchi --local --file=migrations/0001_init.sql
bunx wrangler dev
```

### Deploy to Cloudflare button

You can add a one-click deploy button to the repo README by pointing it at this
subdirectory:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://<you>/Parchi/tree/main/worker)
```

The deploy-button flow still requires the deployer to create the D1 database and
set `TURNSTILE_SECRET` (and optionally `AGENT_KEY`) afterward, as above.
