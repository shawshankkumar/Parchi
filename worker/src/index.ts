// parchi Worker — comments API + discovery doc, backed by Cloudflare D1.
// Implements every endpoint in CONTRACT.md. No framework: a tiny hand-rolled router.

import { newId } from "./id";
import type {
  Anchor,
  Comment,
  CommentStatus,
  CreateCommentReq,
  CreateCommentRes,
} from "../../contract/types";

export interface Env {
  DB: D1Database;
  // [vars] — public-ish config
  AGENT_KEY: string; // trusted-agent bypass secret (default "" = disabled)
  ALLOWED_ORIGIN?: string; // Pages origin allowed for browser writes (optional)
  RENDERER_BASE?: string; // your Pages renderer URL (set by `parchi setup`)
  // secrets
  TURNSTILE_SECRET?: string; // Turnstile siteverify secret
}

// ---- constants -------------------------------------------------------------

const MAX_BODY_BYTES = 10 * 1024; // 10 KB
const MAX_AUTHOR_CHARS = 80;
const RATE_LIMIT_BROWSER = 10; // writes/min/IP for browser callers
const RATE_LIMIT_AGENT = 120; // writes/min/IP for trusted agents
const RATE_WINDOW_MS = 60_000;

// ---- DB row shape ----------------------------------------------------------

interface CommentRow {
  id: string;
  gist_id: string;
  author: string;
  body: string;
  anchor: string; // JSON
  gist_revision: string;
  status: CommentStatus;
  edit_token_hash: string;
  created_at: string;
  edited_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
}

function rowToComment(row: CommentRow): Comment {
  return {
    id: row.id,
    gist_id: row.gist_id,
    author: row.author,
    body: row.body,
    anchor: JSON.parse(row.anchor) as Anchor,
    gist_revision: row.gist_revision,
    status: row.status,
    created_at: row.created_at,
    edited_at: row.edited_at,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
  };
}

// ---- CORS ------------------------------------------------------------------

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  // GET is allowed from anywhere ("*"). Writes are gated by Turnstile/Agent-Key,
  // so we can safely reflect the requesting origin (or the configured Pages
  // origin) to let credentialed-less fetches through the browser.
  const allowOrigin =
    env.ALLOWED_ORIGIN && origin === env.ALLOWED_ORIGIN
      ? env.ALLOWED_ORIGIN
      : origin ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "X-Edit-Token, X-Agent-Key, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(
  data: unknown,
  status: number,
  env: Env,
  origin: string | null,
): Response {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(env, origin),
      "Content-Type": "application/json",
    },
  });
}

function errorRes(
  message: string,
  status: number,
  env: Env,
  origin: string | null,
): Response {
  return json({ error: message }, status, env, origin);
}

// ---- crypto helpers --------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time-ish string compare for hashes. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- auth ------------------------------------------------------------------

function hasValidAgentKey(req: Request, env: Env): boolean {
  const key = req.headers.get("X-Agent-Key");
  return !!env.AGENT_KEY && !!key && safeEqual(key, env.AGENT_KEY);
}

async function verifyTurnstile(
  token: string | undefined,
  ip: string | null,
  env: Env,
): Promise<boolean> {
  // The TURNSTILE_SECRET-unset case is handled upstream in authorizeWrite
  // (open browser writes); by the time we get here a secret is configured.
  if (!env.TURNSTILE_SECRET) return false;
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    );
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

/**
 * Authorize a "write" action that accepts Turnstile OR X-Agent-Key.
 * Returns { ok, agent } — agent=true when authorized via X-Agent-Key.
 */
async function authorizeWrite(
  req: Request,
  env: Env,
  ip: string | null,
  turnstileToken: string | undefined,
): Promise<{ ok: boolean; agent: boolean }> {
  if (hasValidAgentKey(req, env)) return { ok: true, agent: true };
  // Turnstile is OPTIONAL. When TURNSTILE_SECRET is unset, browser writes are
  // allowed (gated only by the per-IP rate limit) — anyone with the renderer
  // link can comment. Set TURNSTILE_SECRET to require human verification and
  // cut bot/spam writes.
  if (!env.TURNSTILE_SECRET) return { ok: true, agent: false };
  const ok = await verifyTurnstile(turnstileToken, ip, env);
  return { ok, agent: false };
}

// ---- rate limit (D1-backed, simple fixed window) ---------------------------

async function rateLimitOk(
  env: Env,
  ip: string,
  limit: number,
): Promise<boolean> {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  // Best-effort cleanup of old rows for this ip, then count + insert.
  await env.DB.prepare("DELETE FROM rate_limit WHERE ts < ?1")
    .bind(windowStart)
    .run();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS c FROM rate_limit WHERE ip = ?1 AND ts >= ?2",
  )
    .bind(ip, windowStart)
    .first<{ c: number }>();
  const count = row?.c ?? 0;
  if (count >= limit) return false;
  await env.DB.prepare("INSERT INTO rate_limit (ip, ts) VALUES (?1, ?2)")
    .bind(ip, now)
    .run();
  return true;
}

function clientIp(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    "unknown"
  );
}

// ---- gist sanity check (metadata only — never stores content) --------------

async function gistExists(gistId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "GET",
      headers: {
        "User-Agent": "parchi-worker",
        Accept: "application/vnd.github+json",
      },
    });
    // Only a definitive 404 means "does not exist". For 403 (unauthenticated
    // GitHub rate limit on the shared Worker egress IP), 5xx, etc., FAIL OPEN —
    // the client already rendered this gist, so don't block a real comment just
    // because GitHub is throttling us.
    return res.status !== 404;
  } catch {
    return true; // network error => fail open
  }
}

// ---- validation ------------------------------------------------------------

function validAnchor(a: unknown): a is Anchor {
  if (!a || typeof a !== "object") return false;
  const o = a as Record<string, unknown>;
  return (
    typeof o.quote === "string" &&
    typeof o.prefix === "string" &&
    typeof o.suffix === "string" &&
    typeof o.blockIndex === "number" &&
    Array.isArray(o.headingPath) &&
    o.headingPath.every((s) => typeof s === "string") &&
    typeof o.startOffset === "number" &&
    typeof o.endOffset === "number"
  );
}

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ---- discovery -------------------------------------------------------------

async function buildDiscovery(env: Env, gistId: string, baseUrl: string) {
  const counts = { open: 0, resolved: 0, deleted: 0 };
  const rows = await env.DB.prepare(
    "SELECT status, COUNT(*) AS c FROM comments WHERE gist_id = ?1 GROUP BY status",
  )
    .bind(gistId)
    .all<{ status: CommentStatus; c: number }>();
  for (const r of rows.results ?? []) {
    if (r.status in counts) counts[r.status] = r.c;
  }
  // Configured per-deployment via the RENDERER_BASE [vars] entry (set by
  // `parchi setup`). When unset, renderer_url is simply omitted below.
  const rendererBase = (env.RENDERER_BASE || "").replace(/\/+$/, "");
  return {
    gist_id: gistId,
    gist_url: `https://gist.github.com/${gistId}`,
    gist_api_url: `https://api.github.com/gists/${gistId}`,
    renderer_url: rendererBase ? `${rendererBase}/?g=${gistId}` : "",
    comments: {
      open: counts.open,
      resolved: counts.resolved,
      deleted: counts.deleted,
      list_url: `${baseUrl}/api/comments?gist=${gistId}`,
      create_url: `${baseUrl}/api/comments`,
      item_url: `${baseUrl}/api/comments/{comment_id}`,
      resolve_url: `${baseUrl}/api/comments/{comment_id}/resolve`,
    },
  };
}

// ---- handlers --------------------------------------------------------------

async function listComments(
  env: Env,
  url: URL,
  origin: string | null,
): Promise<Response> {
  const gist = url.searchParams.get("gist");
  if (!gist) return errorRes("missing ?gist", 400, env, origin);
  const state = (url.searchParams.get("state") || "open").toLowerCase();

  let statuses: CommentStatus[];
  switch (state) {
    case "open":
      statuses = ["open"];
      break;
    case "resolved":
      statuses = ["resolved"];
      break;
    case "deleted":
      statuses = ["deleted"];
      break;
    case "all":
      statuses = ["open", "resolved"]; // all = open + resolved (deleted opt-in)
      break;
    default:
      return errorRes("invalid state", 400, env, origin);
  }

  const placeholders = statuses.map((_, i) => `?${i + 2}`).join(",");
  const stmt = env.DB.prepare(
    `SELECT * FROM comments WHERE gist_id = ?1 AND status IN (${placeholders}) ORDER BY id`,
  ).bind(gist, ...statuses);
  const res = await stmt.all<CommentRow>();
  const comments = (res.results ?? []).map(rowToComment);
  return json(comments, 200, env, origin);
}

async function createComment(
  req: Request,
  env: Env,
  origin: string | null,
): Promise<Response> {
  let payload: CreateCommentReq;
  try {
    payload = (await req.json()) as CreateCommentReq;
  } catch {
    return errorRes("invalid JSON", 400, env, origin);
  }

  // shape validation
  if (
    !payload ||
    typeof payload.gist_id !== "string" ||
    typeof payload.author !== "string" ||
    typeof payload.body !== "string" ||
    typeof payload.gist_revision !== "string" ||
    !validAnchor(payload.anchor)
  ) {
    return errorRes("invalid request body", 400, env, origin);
  }

  // input caps
  if (byteLength(payload.body) > MAX_BODY_BYTES)
    return errorRes("body too large (max 10KB)", 413, env, origin);
  if (payload.author.length > MAX_AUTHOR_CHARS)
    return errorRes("author too long (max 80 chars)", 400, env, origin);
  if (payload.author.trim().length === 0)
    return errorRes("author required", 400, env, origin);
  if (payload.body.trim().length === 0)
    return errorRes("body required", 400, env, origin);

  const ip = clientIp(req);

  // auth
  const auth = await authorizeWrite(req, env, ip, payload.turnstile_token);
  if (!auth.ok) return errorRes("unauthorized write", 401, env, origin);

  // rate limit
  const limit = auth.agent ? RATE_LIMIT_AGENT : RATE_LIMIT_BROWSER;
  if (!(await rateLimitOk(env, ip, limit)))
    return errorRes("rate limit exceeded", 429, env, origin);

  // gist sanity check — only for the FIRST comment on a gist (lazy create).
  // Once a gist has comments we skip the GitHub call entirely, which also
  // avoids burning the unauthenticated 60/hr GitHub rate limit on every write.
  const existing = await env.DB.prepare(
    "SELECT 1 AS x FROM comments WHERE gist_id = ?1 LIMIT 1",
  )
    .bind(payload.gist_id)
    .first();
  if (!existing && !(await gistExists(payload.gist_id)))
    return errorRes("gist not found or not readable", 400, env, origin);

  const id = newId();
  const editToken = randomToken();
  const editTokenHash = await sha256Hex(editToken);
  const createdAt = new Date().toISOString();
  const anchorJson = JSON.stringify(payload.anchor);

  await env.DB.prepare(
    `INSERT INTO comments
      (id, gist_id, author, body, anchor, gist_revision, status, edit_token_hash, created_at, edited_at, resolved_at, resolved_by)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8, NULL, NULL, NULL)`,
  )
    .bind(
      id,
      payload.gist_id,
      payload.author,
      payload.body,
      anchorJson,
      payload.gist_revision,
      editTokenHash,
      createdAt,
    )
    .run();

  const comment: Comment = {
    id,
    gist_id: payload.gist_id,
    author: payload.author,
    body: payload.body,
    anchor: payload.anchor,
    gist_revision: payload.gist_revision,
    status: "open",
    created_at: createdAt,
    edited_at: null,
    resolved_at: null,
    resolved_by: null,
  };
  const body: CreateCommentRes = { comment, edit_token: editToken };
  return json(body, 201, env, origin);
}

async function getComment(
  env: Env,
  cid: string,
  origin: string | null,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  if (!row) return errorRes("not found", 404, env, origin);
  return json(rowToComment(row), 200, env, origin);
}

async function patchComment(
  req: Request,
  env: Env,
  cid: string,
  origin: string | null,
): Promise<Response> {
  const editToken = req.headers.get("X-Edit-Token");
  if (!editToken) return errorRes("missing X-Edit-Token", 401, env, origin);

  const row = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  if (!row) return errorRes("not found", 404, env, origin);
  if (row.status === "deleted")
    return errorRes("comment deleted", 410, env, origin);

  const providedHash = await sha256Hex(editToken);
  if (!safeEqual(providedHash, row.edit_token_hash))
    return errorRes("invalid edit token", 403, env, origin);

  let patch: { body?: unknown; anchor?: unknown };
  try {
    patch = (await req.json()) as { body?: unknown; anchor?: unknown };
  } catch {
    return errorRes("invalid JSON", 400, env, origin);
  }

  let newBody = row.body;
  let newAnchor = row.anchor;

  if (patch.body !== undefined) {
    if (typeof patch.body !== "string")
      return errorRes("body must be a string", 400, env, origin);
    if (byteLength(patch.body) > MAX_BODY_BYTES)
      return errorRes("body too large (max 10KB)", 413, env, origin);
    if (patch.body.trim().length === 0)
      return errorRes("body required", 400, env, origin);
    newBody = patch.body;
  }
  if (patch.anchor !== undefined) {
    if (!validAnchor(patch.anchor))
      return errorRes("invalid anchor", 400, env, origin);
    newAnchor = JSON.stringify(patch.anchor);
  }
  if (patch.body === undefined && patch.anchor === undefined)
    return errorRes("nothing to update", 400, env, origin);

  const editedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE comments SET body = ?1, anchor = ?2, edited_at = ?3 WHERE id = ?4",
  )
    .bind(newBody, newAnchor, editedAt, cid)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  return json(rowToComment(updated as CommentRow), 200, env, origin);
}

async function deleteComment(
  req: Request,
  env: Env,
  cid: string,
  origin: string | null,
): Promise<Response> {
  const editToken = req.headers.get("X-Edit-Token");
  if (!editToken) return errorRes("missing X-Edit-Token", 401, env, origin);

  const row = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  if (!row) return errorRes("not found", 404, env, origin);

  const providedHash = await sha256Hex(editToken);
  if (!safeEqual(providedHash, row.edit_token_hash))
    return errorRes("invalid edit token", 403, env, origin);

  // soft delete
  await env.DB.prepare("UPDATE comments SET status = 'deleted' WHERE id = ?1")
    .bind(cid)
    .run();
  return json(null, 204, env, origin);
}

async function resolveComment(
  req: Request,
  env: Env,
  cid: string,
  origin: string | null,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  if (!row) return errorRes("not found", 404, env, origin);
  if (row.status === "deleted")
    return errorRes("comment deleted", 410, env, origin);

  let resolvedBy = "";
  try {
    const b = (await req.json()) as { resolved_by?: unknown };
    if (typeof b.resolved_by === "string") resolvedBy = b.resolved_by;
  } catch {
    // empty/invalid body is tolerated; resolved_by stays ""
  }
  if (resolvedBy.length > MAX_AUTHOR_CHARS)
    return errorRes("resolved_by too long (max 80 chars)", 400, env, origin);

  // Resolve/reopen are open state-toggles (high-trust model): no Turnstile /
  // agent auth required, only per-IP rate limiting. Agents get the higher tier.
  const ip = clientIp(req);
  const limit = hasValidAgentKey(req, env) ? RATE_LIMIT_AGENT : RATE_LIMIT_BROWSER;
  if (!(await rateLimitOk(env, ip, limit)))
    return errorRes("rate limit exceeded", 429, env, origin);

  const resolvedAt = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE comments SET status = 'resolved', resolved_at = ?1, resolved_by = ?2 WHERE id = ?3",
  )
    .bind(resolvedAt, resolvedBy || null, cid)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  return json(rowToComment(updated as CommentRow), 200, env, origin);
}

async function reopenComment(
  req: Request,
  env: Env,
  cid: string,
  origin: string | null,
): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  if (!row) return errorRes("not found", 404, env, origin);
  if (row.status === "deleted")
    return errorRes("comment deleted", 410, env, origin);

  // Open state-toggle (see resolveComment): rate-limited, no write-auth.
  const ip = clientIp(req);
  const limit = hasValidAgentKey(req, env) ? RATE_LIMIT_AGENT : RATE_LIMIT_BROWSER;
  if (!(await rateLimitOk(env, ip, limit)))
    return errorRes("rate limit exceeded", 429, env, origin);

  await env.DB.prepare(
    "UPDATE comments SET status = 'open', resolved_at = NULL, resolved_by = NULL WHERE id = ?1",
  )
    .bind(cid)
    .run();

  const updated = await env.DB.prepare("SELECT * FROM comments WHERE id = ?1")
    .bind(cid)
    .first<CommentRow>();
  return json(rowToComment(updated as CommentRow), 200, env, origin);
}

// ---- router ----------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get("Origin");

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });
    }

    const url = new URL(req.url);
    const path = url.pathname;
    const baseUrl = `${url.protocol}//${url.host}`;

    try {
      // GET /g/:id.json — discovery
      const discoveryMatch = path.match(/^\/g\/([^/]+)\.json$/);
      if (discoveryMatch && req.method === "GET") {
        const gistId = decodeURIComponent(discoveryMatch[1]);
        const doc = await buildDiscovery(env, gistId, baseUrl);
        return json(doc, 200, env, origin);
      }

      // /api/comments
      if (path === "/api/comments") {
        if (req.method === "GET") return await listComments(env, url, origin);
        if (req.method === "POST") return await createComment(req, env, origin);
        return errorRes("method not allowed", 405, env, origin);
      }

      // /api/comments/:cid (+ /resolve, /reopen)
      const itemMatch = path.match(/^\/api\/comments\/([^/]+)(\/resolve|\/reopen)?$/);
      if (itemMatch) {
        const cid = decodeURIComponent(itemMatch[1]);
        const action = itemMatch[2];

        if (action === "/resolve") {
          if (req.method === "POST")
            return await resolveComment(req, env, cid, origin);
          return errorRes("method not allowed", 405, env, origin);
        }
        if (action === "/reopen") {
          if (req.method === "POST")
            return await reopenComment(req, env, cid, origin);
          return errorRes("method not allowed", 405, env, origin);
        }
        // bare item
        if (req.method === "GET") return await getComment(env, cid, origin);
        if (req.method === "PATCH")
          return await patchComment(req, env, cid, origin);
        if (req.method === "DELETE")
          return await deleteComment(req, env, cid, origin);
        return errorRes("method not allowed", 405, env, origin);
      }

      return errorRes("not found", 404, env, origin);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "internal error";
      return errorRes(msg, 500, env, origin);
    }
  },
};
