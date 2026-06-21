// parchi shared types — canonical copy. Mirrors CONTRACT.md "Types" section.
// Backend (/worker) and renderer (/renderer) both import/copy from here.

export type CommentStatus = "open" | "resolved" | "deleted";

export interface Anchor {
  quote: string; // exact selected text
  prefix: string; // ~32 chars before
  suffix: string; // ~32 chars after
  blockIndex: number; // nth rendered block (accelerator)
  headingPath: string[]; // section path
  startOffset: number; // raw-source hint
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
  turnstile_token?: string; // required from browser; agents may use X-Agent-Key instead
}

// POST /api/comments response
export interface CreateCommentRes {
  comment: Comment;
  edit_token: string;
}
