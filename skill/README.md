# Parchi skill + CLI

Publish a plan/handoff doc as a **secret GitHub gist** and print a gist link
plus a **renderer link** where reviewers leave inline, anchored comments — all
against the user's **own self-hosted** Worker + GitHub Pages (no shared backend).

- `SKILL.md` — the Claude Code skill (drives setup + the publish workflow).
- `parchi` — the portable CLI, **bundled right here in the skill folder** so
  installing the skill installs the CLI too (no npm). It's a single,
  dependency-free script that runs under both Node 18+ and [Bun](https://bun.sh).
  (Canonical source lives at `../cli/parchi`; this is a copy that ships with the
  skill.)

## Install — one step, no npm

Copy the **whole skill folder** (which includes `parchi`) into a skills
directory Claude Code reads:

```bash
# user-global (all projects)
mkdir -p ~/.claude/skills/parchi
cp skill/SKILL.md skill/README.md skill/parchi ~/.claude/skills/parchi/
chmod +x ~/.claude/skills/parchi/parchi

# OR project-local
mkdir -p .claude/skills/parchi
cp skill/SKILL.md skill/README.md skill/parchi .claude/skills/parchi/
```

That's it — the skill auto-triggers when you ask Claude for a "plan" /
"handoff doc" / "design doc" / "share for review", or to update one, and it
invokes the bundled `parchi`.

**Optional — use `parchi` as a plain command** (convenience; the skill works
without this by calling the bundled path):

```bash
ln -sf ~/.claude/skills/parchi/parchi ~/.local/bin/parchi   # any dir on $PATH
parchi --help
```

`publish`/`setup` shell out to the GitHub CLI, so install and auth `gh`:

```bash
gh auth login
gh auth status       # should report logged in
```

## First run — set up your own instance

Parchi has **no default backend** — it only talks to a deployment you own. The
first time, set that up (the skill does this for you; see `../SETUP.md` for the
full playbook):

```bash
parchi doctor     # shows what's missing (gh, wrangler, Cloudflare creds, config)
parchi setup      # provisions Cloudflare Worker+D1, GitHub Pages, env vars, config
```

`setup` needs `gh` authed, [Bun](https://bun.sh), and Cloudflare creds exported
(`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). It writes
`~/.config/parchi/config.json` (chmod 600) with your Worker URL, renderer URL,
and a generated agent key. Nothing sensitive is committed.

## Configuration

After setup, config is already written. To inspect or adjust it:

```bash
parchi config show                       # effective values + where each came from
parchi config set-key <KEY>              # trusted-agent key (to POST comments)
parchi config set-api <your-worker-url>  # your Worker base URL
parchi config set-renderer <your-url>    # your renderer (Pages) URL
```

Precedence for every value is **env var > config file** (no built-in default).
Env overrides (`PARCHI_API`, `PARCHI_RENDERER`, `PARCHI_AGENT_KEY`) work for
one-offs.

## CLI quick reference

```bash
parchi setup
parchi doctor
parchi publish <file> [--md|--html] [--update <gistId>] [--json]
parchi comments <gistId> [--state open|resolved|deleted|all] [--json]
parchi resolve <commentId> [--by <name>]
parchi reopen  <commentId>
parchi discover <gistId>
```

`publish` prints both a human block and machine JSON
`{ gist_id, gist_url, renderer_url }` (use `--json` for JSON only). Updating
with `--update` keeps the same gist id, so links and comment anchors survive.
