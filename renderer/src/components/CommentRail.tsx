import { useState } from "react";
import type { Comment } from "../types";

export interface RailComment {
  comment: Comment;
  anchored: boolean; // anchor re-resolved successfully against current doc
  ownable: boolean; // edit_token present in localStorage
}

interface Props {
  comments: RailComment[];
  apiAvailable: boolean;
  busyId: string | null;
  onFocus: (commentId: string) => void;
  onEdit: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
  onResolve: (commentId: string) => void;
  onReopen: (commentId: string) => void;
}

export function CommentRail(props: Props) {
  const { comments } = props;
  const open = comments.filter((c) => c.comment.status === "open" && c.anchored);
  const orphaned = comments.filter(
    (c) => c.comment.status === "open" && !c.anchored,
  );
  const resolved = comments.filter((c) => c.comment.status === "resolved");

  return (
    <aside className="rail">
      <h2 className="rail-title">Comments</h2>
      {!props.apiAvailable && (
        <div className="rail-degraded">
          Comments API unreachable — read-only mode.
        </div>
      )}
      <Group title={`Open (${open.length})`} items={open} {...props} />
      <Group
        title={`Orphaned (${orphaned.length})`}
        items={orphaned}
        orphan
        {...props}
      />
      <Group
        title={`Resolved (${resolved.length})`}
        items={resolved}
        {...props}
      />
      {comments.length === 0 && (
        <p className="rail-empty">No comments yet. Select text to add one.</p>
      )}
    </aside>
  );
}

interface GroupProps extends Props {
  title: string;
  items: RailComment[];
  orphan?: boolean;
}

function Group({ title, items, orphan, ...rest }: GroupProps) {
  if (items.length === 0) return null;
  return (
    <section className="rail-group">
      <h3 className="rail-group-title">{title}</h3>
      {items.map((rc) => (
        <CommentCard key={rc.comment.id} rc={rc} orphan={orphan} {...rest} />
      ))}
    </section>
  );
}

interface CardProps extends Props {
  rc: RailComment;
  orphan?: boolean;
}

function CommentCard({
  rc,
  orphan,
  busyId,
  onFocus,
  onEdit,
  onDelete,
  onResolve,
  onReopen,
}: CardProps) {
  const { comment, ownable } = rc;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const busy = busyId === comment.id;
  const resolved = comment.status === "resolved";

  return (
    <div
      className={`comment-card${orphan ? " orphaned" : ""}${resolved ? " resolved" : ""}`}
      onClick={() => !orphan && onFocus(comment.id)}
    >
      <div className="comment-head">
        <span className="comment-author">{comment.author}</span>
        <span className="comment-time">{fmt(comment.created_at)}</span>
      </div>
      {orphan && (
        <div className="comment-orphan-note">
          Orphaned — text changed since revision {short(comment.gist_revision)}.
        </div>
      )}
      {editing ? (
        <>
          <textarea
            value={draft}
            rows={3}
            maxLength={10000}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="comment-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(comment.id, draft.trim());
                setEditing(false);
              }}
              disabled={busy || !draft.trim()}
            >
              Save
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDraft(comment.body);
                setEditing(false);
              }}
              disabled={busy}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="comment-body">{comment.body}</div>
      )}
      {comment.edited_at && !editing && (
        <div className="comment-edited">edited</div>
      )}
      {!editing && (
        <div className="comment-actions" onClick={(e) => e.stopPropagation()}>
          {!resolved && (
            <button onClick={() => onResolve(comment.id)} disabled={busy}>
              Resolve
            </button>
          )}
          {resolved && (
            <button onClick={() => onReopen(comment.id)} disabled={busy}>
              Reopen
            </button>
          )}
          {ownable && (
            <>
              <button onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button onClick={() => onDelete(comment.id)} disabled={busy}>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function short(s: string): string {
  return s.slice(0, 7);
}
