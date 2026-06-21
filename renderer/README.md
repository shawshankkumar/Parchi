# Parchi — Renderer (GitHub Pages)

Static **Vite + React + TypeScript** SPA that renders a GitHub gist (`plan.md` /
`plan.html`) and layers anchored comments on top. Hosted on GitHub Pages at
`https://<you>.github.io/<repo>/`.

The renderer fetches gist content **directly from GitHub in the browser** (no
token, no server hop). Comments are read/written against the Parchi Worker API
(`PARCHI_API`). See `../CONTRACT.md` for the authoritative interface.

## How it works

- **Doc selection:** `?g=<gistId>` query param.
- **Fetch:** `GET https://api.github.com/gists/:id` client-side. Picks the single
  content file (`plan.md` / `plan.markdown` / `plan.html`) and reads `history`.
- **Format = file extension** (`.md`/`.markdown` → Markdown, `.html`/`.htm` → HTML).
  - Markdown: `react-markdown` + `rehype-sanitize`.
  - HTML: rendered inside a **sandboxed `<iframe srcdoc>`** with sandbox
    `allow-same-origin` and **no `allow-scripts`** (gist scripts cannot run; the
    same-origin grant only lets us read `textContent` for anchoring).
- **Comments:** text-quote anchoring via `dom-anchor-text-quote` + `diff-match-patch`.
  Anchors are re-resolved on load; non-matching anchors are shown as
  *orphaned / text changed since revision X*. Edit/Delete appear only for comments
  whose `edit_token` is in `localStorage`. Turnstile token is attached to writes.
- **Degrades gracefully:** if `PARCHI_API` is unset/unreachable the doc still renders
  read-only (the rail shows an "API unreachable" notice and the comment form is
  disabled).

> **Toolchain:** [Bun](https://bun.sh) is the package manager and script runner
> (`bun install`, `bun run …`). Vite/TypeScript are driven via `bunx`.

## Run locally

```bash
cd renderer
bun install
VITE_PARCHI_API="https://parchi-api.<account>.workers.dev" bun run dev
```

Then open the dev URL with a gist id, e.g.
`http://localhost:5173/parchi/?g=<gistId>`.

You can instead copy `.env.example` to `.env` and set the vars there:

```bash
cp .env.example .env
# edit VITE_PARCHI_API and (optionally) VITE_TURNSTILE_SITEKEY
bun run dev
```

Build / preview:

```bash
bun run build     # tsc + vite build -> dist/
bun run preview
```

## Build vars

| Var | Required | Meaning |
|---|---|---|
| `VITE_PARCHI_API` | yes (prod) | Worker base URL, no trailing slash. If empty, the app renders docs read-only. |
| `VITE_TURNSTILE_SITEKEY` | optional | Cloudflare Turnstile **public** sitekey (anti-spam). If empty, the comment form still works and submits an empty token; the Worker accepts it (open, rate-limited) unless `TURNSTILE_SECRET` is set, in which case it requires a valid token. |

Both are **build-time** (Vite inlines `VITE_*` at build), so changing them requires
a rebuild/redeploy.

## Enable GitHub Pages + set the vars (what YOU must do)

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Secrets and variables → Actions → Variables tab → New repository variable:**
   - `VITE_PARCHI_API` = your Worker URL (e.g. `https://parchi-api.<account>.workers.dev`)
   - `VITE_TURNSTILE_SITEKEY` = your Turnstile sitekey (public; a Variable is fine)
3. Run the **Deploy renderer to GitHub Pages** workflow (`gh workflow run
   pages.yml`, or Actions tab → Run workflow). It is **deploy-on-demand** (no
   push trigger), so the source/template repo never auto-deploys; it builds
   `renderer/` and deploys `renderer/dist` only when triggered. `parchi setup`
   triggers it for you.

> The sitekey is public, so a repo **Variable** is appropriate. If you prefer to
> keep it in **Secrets**, change `vars.VITE_TURNSTILE_SITEKEY` to
> `secrets.VITE_TURNSTILE_SITEKEY` in the workflow.

## Deep links / SPA fallback

`public/404.html` redirects unknown Pages paths back to `/parchi/` preserving the
query string and hash, so `?g=<id>` deep links survive a hard navigation.
