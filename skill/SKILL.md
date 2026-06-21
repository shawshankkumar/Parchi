---
name: parchi
description: >-
  Publish a written plan or handoff document as a secret GitHub gist and share
  reviewable links with inline, anchored comments — on the user's OWN
  self-hosted stack (their Cloudflare Worker + GitHub Pages). Use whenever the
  user asks to create a "plan", "handoff doc", "design doc", "RFC", "spec", or
  "share this for review/comments", or asks to update such a doc. On first use,
  set up their deployment. Requires the `parchi` CLI and `gh`.
---

# Parchi — publish a plan for review (self-hosted)

This skill turns a plan/handoff doc into a **secret GitHub gist** and gives the
user two links: the raw gist and a **renderer** where reviewers leave inline,
anchored comments. The real work is done by the portable `parchi` CLI; this
skill drives it.

**Parchi is self-hosted — there is no shared backend.** Each user runs their own
Cloudflare Worker + D1 (comments API) and their own GitHub Pages renderer. The
first time you use Parchi for a user, you set that up for them (see **First-time
setup** below). After that, publishing and comments all run against *their* infra.

## When to use

Trigger when the user wants to write and share something reviewable: a plan,
handoff doc, design doc, RFC, spec, runbook, or "share this so people can
comment." Also trigger when they want to **update** a doc you previously
published.

## Prerequisites (check once)

- **The `parchi` CLI ships inside this skill folder** (the `parchi` file next to
  this `SKILL.md`) — no separate install or npm needed. Invoke it as:
  - `parchi …` if it's on PATH, else
  - `node "<this-skill-dir>/parchi" …` (e.g. `~/.claude/skills/parchi/parchi`).
  - Convenience: symlink it onto PATH once —
    `ln -sf ~/.claude/skills/parchi/parchi ~/.local/bin/parchi`.
  Verify with `parchi --help` (or the `node <path>` form).
- `gh` is installed and authenticated (`gh auth status`). Publishing needs it.

## First-time setup (onboarding)

Always start a Parchi session by checking whether the user is set up:

```bash
parchi doctor
```

`doctor` reports whether `gh`, `wrangler`, Cloudflare credentials, and the local
config (api / renderer / agent_key) are present.

**If `config: api` / `config: renderer` show "run `parchi setup`"**, the user has
no deployment yet. Offer to set it up, then **follow `SETUP.md`** (in the repo
root) — it is the authoritative playbook. In short:

1. Confirm prerequisites with the user:
   - `gh auth status` is green (else: `gh auth login`).
   - **Cloudflare**: they need a Cloudflare account with Wrangler authenticated.
     Simplest is to have them run `bunx wrangler login` (interactive). For an
     unattended / fully Claude-driven run, instead have them export
     `CLOUDFLARE_API_TOKEN` (dashboard → My Profile → API Tokens → "Edit
     Cloudflare Workers"). `CLOUDFLARE_ACCOUNT_ID` is only needed if their login
     spans multiple Cloudflare accounts. **Never** write these into the repo —
     they live only in the shell env.
   - Bun installed (https://bun.sh) — the toolchain.
2. Make sure they've cloned this template repo (the one with `worker/` and
   `renderer/`) and you're in its directory.
3. Run the one command that does everything:
   ```bash
   parchi setup
   ```
   It creates/uses their GitHub repo, deploys the Worker + D1 to Cloudflare,
   generates an agent key, enables GitHub Pages, wires the build-time variables,
   pushes, and writes `~/.config/parchi/config.json` (chmod 600). It prints the
   Worker URL and renderer URL when done.
4. Tell the user the renderer goes live once the **"Deploy renderer to GitHub
   Pages"** GitHub Action finishes (first build takes a couple of minutes).

`setup` is idempotent — safe to re-run if a step failed. Optional Turnstile
(browser/human comments) can be added later by exporting `TURNSTILE_SECRET` +
`VITE_TURNSTILE_SITEKEY` and re-running `parchi setup`; agent/CLI comments work
without it.

**Never print the full `agent_key`** back to the user — it is a secret. You may
edit `~/.config/parchi/config.json` directly if the user asks you to update an
entry. Precedence for every value is **env var > config file** (there is no
built-in default — Parchi only talks to the user's own deployment).

## Workflow

1. **Write the plan.** Draft the document content based on the user's request.
   Keep it self-contained — reviewers read it without your chat context.

2. **ASK the format.** Before saving, ask the user exactly:
   **"Markdown or HTML?"**
   - Markdown → save as `plan.md` (default; good for prose, code, checklists).
   - HTML → save as `plan.html` (good for custom layout/styling).
   Do not assume; wait for the answer. (The format is the file extension — the
   renderer infers it from the gist file name.)

3. **Save the file** locally as `plan.md` or `plan.html`.

4. **Publish** with the CLI:
   ```bash
   parchi publish plan.md            # or plan.html
   # force a format regardless of extension:
   parchi publish plan.md --md
   parchi publish doc.txt --html
   # machine-readable output:
   parchi publish plan.md --json     # { gist_id, gist_url, renderer_url }
   ```
   Capture the printed `gist_id` — you need it to update the doc or query
   comments later.

5. **Present the links.** Show the user:
   - **Gist link** (`gist_url`) — the raw secret gist.
   - **Renderer link** (`renderer_url`, `…/<repo>/?g=<id>`) — where reviewers
     read the rendered doc and leave inline comments.
   Explain: reviewers comment inline in the renderer (comments are anchored to
   the exact selected text). Comments are also available programmatically via
   the API — you can list/resolve them with the CLI:
   ```bash
   parchi comments <gistId>                 # open comments (JSON)
   parchi comments <gistId> --state all     # open + resolved
   parchi resolve <commentId> --by "Your Name"
   parchi reopen <commentId>
   parchi discover <gistId>                 # discovery doc: links + counts
   ```

## Reviewing and acting on comments

When the user asks to "check / go through / address / iterate on the comments":

1. **Find the gist id** — the one captured at publish time, or extract it from a
   renderer link's `?g=<gistId>` param if that's what the user gives you.
2. **Pull the comments** (the CLI already knows their API endpoint — don't ask
   the user for it):
   ```bash
   parchi comments <gistId> --state open
   ```
   Each comment has `id`, `author`, `body`, and `anchor.quote` (the exact text it
   refers to) so you can locate it in the doc.
3. **Address each comment** by editing the local `plan.md`/`plan.html`, then push
   via the update step below.
4. **Then offer to resolve.** Summarize what you changed per comment and **ask
   the user to confirm before resolving**. On confirmation:
   ```bash
   parchi resolve <commentId> --by "<you/agent>"
   ```
   Only resolve comments you actually addressed. `parchi reopen <commentId>`
   brings one back.

## Updating an existing doc

Editing keeps the **same gist id** (and its revision history), so existing
links and comment anchors keep working:

```bash
parchi publish plan.md --update <gistId>
```

Re-save the edited `plan.md`/`plan.html`, then run the command with the gist id
you captured at publish time. Re-share the same renderer link.

## Notes

- One content file per gist: `plan.md` **or** `plan.html`. Don't mix.
- Gists are **secret** (unlisted), readable by anyone with the id — fine for
  sharing a link, not a substitute for real access control.
- Posting comments as an agent needs the `agent_key` (set by `parchi setup`). If
  `parchi comments`/`resolve` fail with "isn't set up", run `parchi doctor`.
- If `publish` complains about `gh`, tell the user to run `gh auth login`.
