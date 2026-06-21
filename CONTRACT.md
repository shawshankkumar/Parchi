# Parchi — Build Contract (shared interface)

This is the **single source of truth** for the interface boundaries between the three
workstreams. Build against this; do not change it without updating it here.

- **Repo:** `<you>/Parchi`
- **Default renderer (GitHub Pages):** `https://<you>.github.io/<repo>/`
- **Default API (Cloudflare Worker):** `https://parchi-api.<account>.workers.dev` (set at deploy)

> **Toolchain — [Bun](https://bun.sh).** Bun is the package manager and script
> runner across the repo: use `bun install` (creates `bun.lock`) and `bun run <script>`
> in `/worker` and `/renderer`, and `bunx <tool>` for `wrangler`, `tsc`, and `vite`.
> Two runtime caveats: (1) the Worker executes on Cloudflare's **workerd** runtime
> via **Wrangler** — Bun manages deps and drives `bunx wrangler …`, it does **not**
> run the Worker; (2) the `cli/parchi` CLI is intentionally dependency-free and
> runs under **both Node 18+ and Bun** (`bun cli/parchi` or `node cli/parchi`) so
> the published CLI stays portable. CI (GitHub Pages) builds the renderer with
> `oven-sh/setup-bun` + `bun install` + `bun run build`.

## Components & directory ownership
| Dir | Workstream | Owns |
|---|---|---|
| `/worker` | **Backend** | Cloudflare Worker (TypeScript) + D1: all `/api/*` and `/g/:id.json`, schema/migrations, `wrangler.toml`, Turnstile verify, CORS, ID gen. |
| `/renderer` | **Hosting** | Vite + React + TS SPA on GitHub Pages: gist fetch, MD/HTML render, anchoring, comments UI, Pages Actions workflow. |
| `/skill` + `/cli` | **Skill** | Claude Code skill (`SKILL.md`) + `parchi` CLI (gh wrapper): MD/HTML prompt, publish secret gist, print links. |

Each workstream stays inside its own dirs. Shared types live in `/contract` (TS types
mirroring this doc) — backend and renderer both import/copy from there.

---

## ID scheme (opencode-style, TypeScript)
`cmt_` + 12 hex chars (6 bytes = `Date.now() * 0x1000 + counter`) + 14 base62 random = 26 chars.
Monotonic within a ms, so `ORDER BY id` = chronological. Port of
https://github.com/anomalyco/opencode/blob/dev/packages/app/src/utils/id.ts with prefix `cmt`.

## D1 schema (`/worker/migrations/0001_init.sql`)
```sql
CREATE TABLE comments (
  id              TEXT PRIMARY KEY,             -- cmt_… 26 chars
  gist_id         TEXT NOT NULL,
  author          TEXT NOT NULL,                -- free-text display name
  body            TEXT NOT NULL,
  anchor          TEXT NOT NULL,                -- JSON (Anchor type below)
  gist_revision   TEXT NOT NULL,                -- gist version SHA at comment time
  status          TEXT NOT NULL DEFAULT 'open', -- open | resolved | deleted
  edit_token_hash TEXT NOT NULL,                -- sha256(edit_token)
  created_at      TEXT NOT NULL,                -- ISO8601
  edited_at       TEXT,
  resolved_at     TEXT,
  resolved_by     TEXT
);
CREATE INDEX idx_comments_gist ON comments(gist_id, status);
```
No row exists for a gist until its first comment (lazy create).

## Types (`/contract/types.ts`)
```ts
export type CommentStatus = "open" | "resolved" | "deleted";

export interface Anchor {
  quote: string;          // exact selected text
  prefix: string;         // ~32 chars before
  suffix: string;         // ~32 chars after
  blockIndex: number;     // nth rendered block (accelerator)
  headingPath: string[];  // section path
  startOffset: number;    // raw-source hint
  endOffset: number;
}

export interface Comment {
  id: string;
  gist_id: string;
  author: string;
  body: string;
  anchor: Anchor;
  gist_revision: string;
  status: CommentStatus;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

// POST /api/comments request
export interface CreateCommentReq {
  gist_id: string;
  author: string;
  body: string;
  anchor: Anchor;
  gist_revision: string;
  turnstile_token?: string;   // required from browser; agents may use X-Agent-Key instead
}
// POST /api/comments response
export interface CreateCommentRes { comment: Comment; edit_token: string; }
```

---

## HTTP API (Worker)
Base: `PARCHI_API`. All JSON. CORS: allow the Pages origin + `*` for GET; allow
`X-Edit-Token, X-Agent-Key, Content-Type` headers; handle `OPTIONS` preflight.

| Method | Path | Auth | Body / Query | Returns |
|---|---|---|---|---|
| `GET`    | `/g/:id.json` | none | — | Discovery doc (below) |
| `GET`    | `/api/comments` | none | `?gist=<id>&state=open\|resolved\|deleted\|all` (default `open`; `all`=open+resolved) | `Comment[]` (ORDER BY id) |
| `POST`   | `/api/comments` | Turnstile **or** `X-Agent-Key` | `CreateCommentReq` | `201 CreateCommentRes` |
| `GET`    | `/api/comments/:cid` | none | — | `Comment` |
| `PATCH`  | `/api/comments/:cid` | `X-Edit-Token` | `{ body?, anchor? }` | `Comment` (sets `edited_at`) |
| `DELETE` | `/api/comments/:cid` | `X-Edit-Token` | — | `204`; sets `status='deleted'` (soft) |
| `POST`   | `/api/comments/:cid/resolve` | Turnstile **or** `X-Agent-Key` | `{ resolved_by }` | `Comment` (`status='resolved'`) |
| `POST`   | `/api/comments/:cid/reopen`  | Turnstile **or** `X-Agent-Key` | — | `Comment` (`status='open'`) |

**Discovery doc — `GET /g/:id.json`:**
```json
{
  "gist_id": "…",
  "gist_url": "https://gist.github.com/…",
  "gist_api_url": "https://api.github.com/gists/…",
  "renderer_url": "https://<you>.github.io/<repo>/?g=…",
  "comments": {
    "open": 3, "resolved": 1, "deleted": 0,
    "list_url":    "<PARCHI_API>/api/comments?gist=…",
    "create_url":  "<PARCHI_API>/api/comments",
    "item_url":    "<PARCHI_API>/api/comments/{comment_id}",
    "resolve_url": "<PARCHI_API>/api/comments/{comment_id}/resolve"
  }
}
```
Counts come from D1. Worker may read gist **metadata** to validate the id but **never
stores doc content**.

### Auth mechanics
- `edit_token`: returned by POST; client stores in `localStorage`. Worker stores only
  `sha256(edit_token)`. PATCH/DELETE compare hashes.
- Turnstile: Worker verifies `turnstile_token` server-side via Cloudflare siteverify.
- `X-Agent-Key`: shared secret (`AGENT_KEY` env); when present & valid, bypasses Turnstile
  and uses higher rate limits.
- Limits: body ≤ 10 KB, author ≤ 80 chars, N writes/min/IP.

---

## Gist conventions (Skill/CLI ↔ Renderer)
- Docs are **secret gists** created via `gh gist create --secret`.
- One content file named `plan.md` (markdown) or `plan.html` (HTML). **Format = file
  extension.** No format stored in D1.
- Update = `gh gist edit <id> plan.md` (same id → new revision; history preserved).
- Renderer reads `GET https://api.github.com/gists/:id` client-side (no token; secret
  gists are readable by id) for content + `history` (revisions).
- Renderer link format printed by CLI: `https://<you>.github.io/<repo>/?g=<id>`.

## Anchoring (Renderer-owned; backend stores opaque)
Text-quote selector (W3C Web Annotation). Libs: `dom-anchor-text-quote` + `diff-match-patch`.
Computed in browser, matched against current rendered `textContent`. On load, re-resolve
each comment's anchor; no match ⇒ "orphaned / text changed since revision X".

## Env vars
| Var | Used by | Meaning |
|---|---|---|
| `PARCHI_RENDERER` | CLI/skill | Pages URL to print (default `…github.io/parchi/`) |
| `PARCHI_API` | renderer build | Worker base URL |
| `TURNSTILE_SECRET` | worker | Turnstile siteverify secret |
| `TURNSTILE_SITEKEY` | renderer build | Turnstile widget key (public) |
| `AGENT_KEY` | worker (+ trusted agents) | trusted-agent bypass secret |
