import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Anchor, Comment, LoadedDoc } from "./types";
import { fetchGist, GistError } from "./lib/gist";
import {
  apiConfigured,
  createComment,
  deleteComment,
  listComments,
  patchComment,
  reopenComment,
  resolveComment,
} from "./lib/api";
import { anchorFromRange, resolveAnchor } from "./lib/anchor";
import { clearHighlights, focusHighlight, highlightRange } from "./lib/highlight";
import { getEditToken, hasEditToken, saveEditToken } from "./lib/tokens";
import { DocHeader } from "./components/DocHeader";
import { MarkdownDoc } from "./components/MarkdownDoc";
import { HtmlDoc } from "./components/HtmlDoc";
import { CommentForm } from "./components/CommentForm";
import { CommentRail, type RailComment } from "./components/CommentRail";

function getGistId(): string | null {
  const params = new URLSearchParams(window.location.search);
  const g = params.get("g");
  return g && g.trim() ? g.trim() : null;
}

interface PopoverState {
  x: number;
  y: number;
  anchor: Anchor;
}

export default function App() {
  const gistId = useMemo(getGistId, []);
  const [doc, setDoc] = useState<LoadedDoc | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!!gistId);

  const [comments, setComments] = useState<Comment[]>([]);
  const [apiAvailable, setApiAvailable] = useState<boolean>(apiConfigured());
  const [anchoredIds, setAnchoredIds] = useState<Set<string>>(new Set());

  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // For markdown the ref is the div; for html it is the iframe body. We keep a
  // generic getter that returns the current rendered root used for anchoring.
  const mdRef = useRef<HTMLDivElement | null>(null);
  const htmlBodyRef = useRef<HTMLElement | null>(null);

  const getRoot = useCallback((): HTMLElement | null => {
    if (!doc) return null;
    return doc.format === "markdown" ? mdRef.current : htmlBodyRef.current;
  }, [doc]);

  // ---- Load gist ----
  useEffect(() => {
    if (!gistId) return;
    let cancelled = false;
    setLoading(true);
    fetchGist(gistId)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((e) => {
        if (!cancelled)
          setDocError(e instanceof GistError ? e.message : "Failed to load gist.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gistId]);

  // ---- Load comments (degrade gracefully) ----
  const reloadComments = useCallback(async () => {
    if (!gistId || !apiConfigured()) {
      setApiAvailable(false);
      return;
    }
    try {
      const list = await listComments(gistId, "all");
      setComments(list);
      setApiAvailable(true);
    } catch {
      setApiAvailable(false);
    }
  }, [gistId]);

  useEffect(() => {
    void reloadComments();
  }, [reloadComments]);

  // ---- Re-resolve anchors + paint highlights whenever doc/comments change ----
  const repaint = useCallback(() => {
    const root = getRoot();
    if (!root) return;
    clearHighlights(root);
    const matched = new Set<string>();
    for (const c of comments) {
      if (c.status === "deleted") continue;
      const { range, matched: ok } = resolveAnchor(root, c.anchor);
      if (ok && range) {
        matched.add(c.id);
        if (c.status === "open") {
          highlightRange(range, c.id, (id) => onFocusComment(id));
        }
      }
    }
    setAnchoredIds(matched);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments, getRoot]);

  useEffect(() => {
    // Defer to allow markdown/iframe content to mount.
    const t = setTimeout(repaint, 50);
    return () => clearTimeout(t);
  }, [repaint, doc]);

  // ---- Text selection -> popover ----
  // centerX / viewportBottom are in viewport coords; we add scrollY here.
  const showPopover = useCallback(
    (anchor: Anchor, centerX: number, viewportBottom: number) => {
      setFormError(null);
      setPopover({ x: centerX, y: viewportBottom + window.scrollY + 8, anchor });
    },
    [],
  );

  // Markdown: content lives in the parent DOM, so listen on the parent document.
  const onMouseUp = useCallback(() => {
    if (!doc || doc.format !== "markdown") return;
    const root = getRoot();
    if (!root) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    const anchor = anchorFromRange(root, range);
    if (!anchor) return;
    const rect = range.getBoundingClientRect();
    showPopover(anchor, rect.left + rect.width / 2, rect.bottom);
  }, [doc, getRoot, showPopover]);

  useEffect(() => {
    document.addEventListener("mouseup", onMouseUp);
    return () => document.removeEventListener("mouseup", onMouseUp);
  }, [onMouseUp]);

  // HTML: selection happens inside the iframe; HtmlDoc reports it here with a
  // rect already translated to parent-viewport coords (center x, bottom y).
  const onFrameSelect = useCallback(
    (anchor: Anchor, rect: { left: number; bottom: number }) => {
      showPopover(anchor, rect.left, rect.bottom);
    },
    [showPopover],
  );

  // ---- Comment actions ----
  const submitComment = useCallback(
    async (author: string, body: string, turnstileToken: string) => {
      if (!doc || !popover) return;
      setFormBusy(true);
      setFormError(null);
      try {
        const res = await createComment({
          gistId: doc.gistId,
          author,
          body,
          anchor: popover.anchor,
          gistRevision: doc.revision,
          turnstileToken: turnstileToken || undefined,
        });
        saveEditToken(res.comment.id, res.edit_token);
        setComments((prev) => [...prev, res.comment]);
        setPopover(null);
        window.getSelection()?.removeAllRanges();
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to post comment.");
      } finally {
        setFormBusy(false);
      }
    },
    [doc, popover],
  );

  const onFocusComment = useCallback(
    (id: string) => {
      const root = getRoot();
      if (root) focusHighlight(root, id);
    },
    [getRoot],
  );

  const onEdit = useCallback(async (id: string, body: string) => {
    const token = getEditToken(id);
    if (!token) return;
    setBusyId(id);
    try {
      const updated = await patchComment(id, token, { body });
      setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
    } catch {
      /* surfaced via no-op; could add toast */
    } finally {
      setBusyId(null);
    }
  }, []);

  // Optimistically apply a status change, then reconcile with the server. On
  // error, reload from the server so the UI reflects the truth.
  const optimisticStatus = useCallback(
    (id: string, status: Comment["status"]) =>
      setComments((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status } : c)),
      ),
    [],
  );

  const onDelete = useCallback(
    async (id: string) => {
      const token = getEditToken(id);
      if (!token) return;
      setBusyId(id);
      optimisticStatus(id, "deleted");
      try {
        await deleteComment(id, token);
      } catch {
        void reloadComments();
      } finally {
        setBusyId(null);
      }
    },
    [optimisticStatus, reloadComments],
  );

  const onResolve = useCallback(
    async (id: string) => {
      setBusyId(id);
      optimisticStatus(id, "resolved");
      try {
        const updated = await resolveComment(id, "reader");
        setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
      } catch {
        void reloadComments();
      } finally {
        setBusyId(null);
      }
    },
    [optimisticStatus, reloadComments],
  );

  const onReopen = useCallback(
    async (id: string) => {
      setBusyId(id);
      optimisticStatus(id, "open");
      try {
        const updated = await reopenComment(id);
        setComments((prev) => prev.map((c) => (c.id === id ? updated : c)));
      } catch {
        void reloadComments();
      } finally {
        setBusyId(null);
      }
    },
    [optimisticStatus, reloadComments],
  );

  const railComments: RailComment[] = useMemo(
    () =>
      comments
        .filter((c) => c.status !== "deleted")
        .map((c) => ({
          comment: c,
          anchored: anchoredIds.has(c.id),
          ownable: hasEditToken(c.id),
        })),
    [comments, anchoredIds],
  );

  // ---- Render states ----
  if (!gistId) {
    return (
      <div className="empty-state">
        <h1>Parchi</h1>
        <p>
          Open a document with <code>?g=&lt;gistId&gt;</code> in the URL.
        </p>
        <p className="privacy-banner">
          This document is fetched directly from GitHub in your browser and never
          touches our servers.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="empty-state">Loading gist…</div>;
  }

  if (docError || !doc) {
    return (
      <div className="empty-state">
        <h1>Parchi</h1>
        <p className="form-error">{docError ?? "Document unavailable."}</p>
      </div>
    );
  }

  return (
    <div className="layout">
      <main className="content">
        <DocHeader doc={doc} />
        {doc.format === "markdown" ? (
          <MarkdownDoc ref={mdRef} content={doc.content} />
        ) : (
          <HtmlDoc
            ref={htmlBodyRef}
            content={doc.content}
            onSelect={onFrameSelect}
          />
        )}
      </main>

      <CommentRail
        comments={railComments}
        apiAvailable={apiAvailable}
        busyId={busyId}
        onFocus={onFocusComment}
        onEdit={onEdit}
        onDelete={onDelete}
        onResolve={onResolve}
        onReopen={onReopen}
      />

      {popover && (
        <div
          className="popover"
          style={{ left: popover.x, top: popover.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {apiAvailable ? (
            <CommentForm
              quote={popover.anchor.quote}
              busy={formBusy}
              error={formError}
              onSubmit={submitComment}
              onCancel={() => {
                setPopover(null);
                window.getSelection()?.removeAllRanges();
              }}
            />
          ) : (
            <div className="comment-form">
              <p className="form-error">
                Comments API unreachable — cannot add comments right now.
              </p>
              <button onClick={() => setPopover(null)}>Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
