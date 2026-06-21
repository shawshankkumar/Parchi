import type { Anchor, Comment, CreateCommentReq, CreateCommentRes } from "../types";

const API_BASE: string = (import.meta.env.VITE_PARCHI_API ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function apiConfigured(): boolean {
  return API_BASE.length > 0;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiConfigured()) {
    throw new ApiError("PARCHI_API is not configured.", 0);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("Could not reach the parchi API.", 0);
  }
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `API error ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return parsed as T;
}

export type CommentState = "open" | "resolved" | "deleted" | "all";

export function listComments(
  gistId: string,
  state: CommentState = "all",
): Promise<Comment[]> {
  return request<Comment[]>(
    `/api/comments?gist=${encodeURIComponent(gistId)}&state=${state}`,
  );
}

export interface CreateArgs {
  gistId: string;
  author: string;
  body: string;
  anchor: Anchor;
  gistRevision: string;
  turnstileToken?: string;
}

export function createComment(args: CreateArgs): Promise<CreateCommentRes> {
  const reqBody: CreateCommentReq = {
    gist_id: args.gistId,
    author: args.author,
    body: args.body,
    anchor: args.anchor,
    gist_revision: args.gistRevision,
    turnstile_token: args.turnstileToken,
  };
  return request<CreateCommentRes>(`/api/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  });
}

export function patchComment(
  cid: string,
  editToken: string,
  patch: { body?: string; anchor?: Anchor },
): Promise<Comment> {
  return request<Comment>(`/api/comments/${encodeURIComponent(cid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-Edit-Token": editToken },
    body: JSON.stringify(patch),
  });
}

export function deleteComment(cid: string, editToken: string): Promise<void> {
  return request<void>(`/api/comments/${encodeURIComponent(cid)}`, {
    method: "DELETE",
    headers: { "X-Edit-Token": editToken },
  });
}

export function resolveComment(
  cid: string,
  resolvedBy: string,
  turnstileToken?: string,
): Promise<Comment> {
  return request<Comment>(`/api/comments/${encodeURIComponent(cid)}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved_by: resolvedBy, turnstile_token: turnstileToken }),
  });
}

export function reopenComment(
  cid: string,
  turnstileToken?: string,
): Promise<Comment> {
  return request<Comment>(`/api/comments/${encodeURIComponent(cid)}/reopen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstile_token: turnstileToken }),
  });
}
