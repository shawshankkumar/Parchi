# Parchi — first-time setup playbook

This is the authoritative, step-by-step playbook for standing up a **self-hosted
Parchi** instance. `parchi setup` automates all of it; this document is what the
agent (Claude Code) follows to drive that command and to recover if a step fails.

Parchi has **no shared backend**. Setup provisions, on the user's *own* accounts:

- a **Cloudflare Worker + D1** database — the comments API, and
- a **GitHub Pages** site (this repo's `renderer/`) — the reading/commenting UI,

then writes a local CLI config so `parchi publish` / `comments` talk to them.

---

## What the user needs (prerequisites)

| Need | Check | Fix |
|---|---|---|
| **GitHub CLI**, authenticated | `gh auth status` | install https://cli.github.com/ then `gh auth login` |
| **Bun** (toolchain) | `bun --version` | install https://bun.sh |
| **Cloudflare account** | — | free tier is fine (Workers + D1) |
| **Cloudflare auth** | `bunx wrangler whoami` | `bunx wrangler login` — *or* export `CLOUDFLARE_API_TOKEN` |

### Cloudflare auth — two ways (pick one)

Parchi never writes Cloudflare creds into the repo. Authenticate Wrangler either way:

**A. Interactive login (simplest for manual setup):**

```bash
bunx wrangler login        # opens a browser once; setup reuses the session
```

**B. API token (for unattended / Claude-driven setup, no browser):**

```bash
export CLOUDFLARE_API_TOKEN="…"     # dashboard → My Profile → API Tokens →
                                    #   Create Token → "Edit Cloudflare Workers"
# Account ID is only needed if your login has MULTIPLE Cloudflare accounts:
export CLOUDFLARE_ACCOUNT_ID="…"    # dashboard → Workers & Pages → Account ID
```

> **Account ID** is *not* generally required — Wrangler infers it from your login.
> Set `CLOUDFLARE_ACCOUNT_ID` only to disambiguate when the login/token spans more
> than one account (Wrangler will otherwise error "more than one account").

Either way, the **agent key is generated for you** by `parchi setup` — there's no
manual token to create for that.

Optional — **spam protection** for browser comments via Cloudflare Turnstile (can
be added later). Without it, browser comments still work but are open to anyone
with the link (rate-limited per IP); set it to require human verification:

```bash
export TURNSTILE_SECRET="…"          # Turnstile widget secret key
export VITE_TURNSTILE_SITEKEY="…"    # Turnstile widget public sitekey
```

> Copy `.env.example` → `.env` and fill it in if you like; `.env` is gitignored.
> Remember env vars only live in the current shell — `source .env` before setup,
> or export them inline.

---

## The one command

From inside the cloned repo:

```bash
parchi setup
```

(or `node ./cli/parchi setup`, or the bundled skill copy.) It is **idempotent** —
re-running skips work already done, so it's safe after a partial failure.

### What `parchi setup` does, in order

1. **Locate the repo** (must contain `worker/` and `renderer/`).
2. **Resolve the GitHub repo**: uses the existing `origin`, or runs
   `gh repo create <dir-name> --public --source=. --remote=origin --push`.
   Pages on the free tier needs a **public** repo; pass `--private` only if the
   account has Pages for private repos.
3. **Set the renderer base path** to `/<repo>/` in `renderer/vite.config.ts` and
   `renderer/public/404.html` (GitHub Pages serves project sites under that path).
4. **Install worker deps** (`bun install` in `worker/`).
5. **Create the D1 database** `parchi` (`wrangler d1 create parchi`) and write the
   returned `database_id` into `worker/wrangler.toml`.
6. **Set `RENDERER_BASE`** in `wrangler.toml [vars]` to
   `https://<owner>.github.io/<repo>/`.
7. **Apply migrations** to remote D1 (`wrangler d1 migrations apply parchi --remote`).
8. **Deploy** the Worker (`wrangler deploy`) and capture the
   `https://parchi-api.<acct>.workers.dev` URL.
9. **Set secrets _after_ deploy** (avoids the clobber gotcha): a generated
   `AGENT_KEY`, and `TURNSTILE_SECRET` if provided.
10. **Set repo Actions Variables**: `VITE_PARCHI_API` = Worker URL (and
    `VITE_TURNSTILE_SITEKEY` if provided) — these feed the Pages build.
11. **Enable GitHub Pages** with the **GitHub Actions** source.
12. **Commit & push** the templated config, then **trigger the Pages build**
    (`gh workflow run pages.yml` — the workflow is deploy-on-demand, not
    push-triggered, so the source/template repo never auto-deploys).
13. **Write `~/.config/parchi/config.json`** (`{api, renderer, agent_key}`, chmod
    600) — this is what makes the CLI live.
14. **Print a summary** with the Worker URL, renderer URL, and next steps.

---

## After setup

- Watch the **"Deploy renderer to GitHub Pages"** Action in the repo. When green,
  the renderer is live at `https://<owner>.github.io/<repo>/`.
- Verify the CLI: `parchi doctor` should show api/renderer/agent_key set.
- Publish a first doc: `parchi publish plan.md`.

## Recovery / re-running

- **A step failed?** Fix the cause (e.g. token scope) and run `parchi setup` again
  — completed steps are detected and skipped.
- **Wrong Worker/renderer URL in config?** `parchi config set-api <url>` /
  `parchi config set-renderer <url>`.
- **Pages build red?** Confirm Settings → Pages → Source = "GitHub Actions" and
  that `VITE_PARCHI_API` exists under Settings → Secrets and variables → Actions →
  **Variables**.
- **Add spam protection later:** browser comments already work (open, rate-limited);
  to require human verification, export `TURNSTILE_SECRET` + `VITE_TURNSTILE_SITEKEY`
  and re-run `parchi setup`.

## What is and isn't a secret

| Value | Where it lives | Committed? |
|---|---|---|
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | shell env (`.env`, gitignored) | **No** |
| `AGENT_KEY` | `wrangler secret` + `~/.config/parchi/config.json` (chmod 600) | **No** |
| `TURNSTILE_SECRET` | `wrangler secret` | **No** |
| `database_id`, `RENDERER_BASE` | `worker/wrangler.toml` | Yes — opaque, not sensitive |
| `VITE_PARCHI_API`, `VITE_TURNSTILE_SITEKEY` | GitHub Actions **Variables** (public) | n/a |
