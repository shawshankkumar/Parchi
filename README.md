# Parchi

## Demo

[View Demo Video](https://drive.google.com/file/d/1wAZXwCnSy6kotsbMiCtMSbUtoXCE346r/view?usp=sharing)

**Publish a plan/handoff doc as a secret GitHub gist, render it with inline,
anchored comments — on infrastructure you own.**

Parchi is a **template repo**. Clone it (or click **Use this template**), then ask
Claude Code to set it up: it deploys your own Cloudflare Worker + D1 (the comments
API) and your own GitHub Pages site (the renderer), wires everything together, and
hands you a working `parchi` CLI. **There is no shared backend — every instance is
self-hosted.** Your docs live in your gists; your comments live in your D1.

```
 ┌────────────┐   publish    ┌──────────────┐    read     ┌────────────────────┐
 │  parchi CLI│ ───────────▶ │ secret gist  │ ──────────▶ │ renderer (Pages)   │
 │  + skill   │   (gh)       │ (plan.md/html)│            │ reads gist + shows │
 └────────────┘              └──────────────┘             │ anchored comments  │
        │                                                  └─────────┬──────────┘
        │ list / resolve comments                                    │ comment
        ▼                                                            ▼
 ┌──────────────────────────────  your Cloudflare  ──────────────────────────┐
 │  Worker (comments API)  ◀────────────────────────────────▶  D1 database    │
 └────────────────────────────────────────────────────────────────────────────┘
```

## Quick start (Claude Code does it for you)

1. **Use this template** / clone this repo, and open it in Claude Code.
2. Make sure you have:
   - `gh` installed and authenticated (`gh auth login`),
   - [Bun](https://bun.sh) installed,
   - a Cloudflare account, with Wrangler authenticated — either `bunx wrangler
     login` (simplest) **or** an exported `CLOUDFLARE_API_TOKEN` for unattended
     runs (see [`.env.example`](.env.example) and [`SETUP.md`](SETUP.md)).
3. Just say: **"set up Parchi."** Claude follows [`SETUP.md`](SETUP.md) and runs
   `parchi setup`, which provisions Cloudflare + GitHub Pages, wires env vars, and
   writes your local config.
4. When the "Deploy renderer to GitHub Pages" Action goes green, publish a doc:
   **"publish this as a Parchi doc."**

> [!NOTE]
> **The repo must be public for GitHub Pages to work on the free tier.** GitHub
> Pages only serves **private** repos on paid plans (Pro/Team/Enterprise). If
> you're a free-tier user, keep your Parchi repo public (or upgrade) — otherwise
> the renderer won't be served. The worker and your gists are unaffected; only
> the Pages-hosted renderer needs this.

Prefer to drive it yourself? It's one command from the repo root:

```bash
node ./cli/parchi setup     # or `parchi setup` if it's on PATH
```

## What gets created

- **Cloudflare Worker** `parchi-api` + **D1** database `parchi` — comments API.
- **GitHub Pages** site from `renderer/` at `https://<you>.github.io/<repo>/`.
- A generated **agent key** (lets the CLI post/resolve comments) stored as a
  Cloudflare secret and in `~/.config/parchi/config.json` (chmod 600).
- Local CLI config so `parchi publish` / `comments` target *your* deployment.

Nothing sensitive is committed — see the secrets table in [`SETUP.md`](SETUP.md).

## Repository layout

| Dir | What |
|---|---|
| `worker/` | Cloudflare Worker (TypeScript) + D1: the `/api/*` comments API and `/g/:id.json` discovery doc, schema/migrations, `wrangler.toml`. |
| `renderer/` | Vite + React + TS single-page app on GitHub Pages: fetches the gist, renders MD/HTML, anchors and shows comments. |
| `cli/parchi` | The portable, dependency-free `parchi` CLI (`setup`, `doctor`, `publish`, `comments`, …). Runs on Node 18+ or Bun. |
| `skill/` | The Claude Code skill (`SKILL.md`) with the `parchi` CLI bundled — copy `skill/` into `~/.claude/skills/parchi/`. |
| `contract/` + `CONTRACT.md` | The shared interface between worker, renderer, and CLI. |

## Using the skill

Copy the `skill/` folder to `~/.claude/skills/parchi/` (it already bundles the
CLI). Then any plan/handoff/RFC request triggers it: Claude checks `parchi doctor`,
runs setup on first use, and publishes. See [`skill/SKILL.md`](skill/SKILL.md).

## The CLI

```
parchi setup                         # first-run provision (Cloudflare + Pages + config)
parchi doctor                        # check prerequisites & config
parchi publish <file> [--md|--html] [--update <gistId>] [--json]
parchi comments <gistId> [--state open|resolved|deleted|all]
parchi resolve <commentId> [--by <name>]
parchi reopen <commentId>
parchi discover <gistId>
parchi config <show|set-key|set-api|set-renderer>
```

Config precedence per value: **env var > `~/.config/parchi/config.json`**. There is
no built-in default — Parchi only ever talks to your own deployment.

## Toolchain

[Bun](https://bun.sh) manages deps and drives `bunx wrangler` / `vite`. The Worker
runs on Cloudflare's workerd via Wrangler. The CLI is dependency-free and portable
(Node 18+ or Bun). See [`CONTRACT.md`](CONTRACT.md) for the full interface.
