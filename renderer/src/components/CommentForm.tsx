import { useState } from "react";
import { Turnstile } from "./Turnstile";

interface Props {
  quote: string;
  busy: boolean;
  error: string | null;
  onSubmit: (author: string, body: string, turnstileToken: string) => void;
  onCancel: () => void;
}

const NAME_KEY = "parchi:display_name";

export function CommentForm({ quote, busy, error, onSubmit, onCancel }: Props) {
  const [author, setAuthor] = useState<string>(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [body, setBody] = useState("");
  const [token, setToken] = useState<string>("");

  const canSubmit = author.trim().length > 0 && body.trim().length > 0 && !busy;

  return (
    <form
      className="comment-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        try {
          localStorage.setItem(NAME_KEY, author.trim());
        } catch {
          /* ignore */
        }
        onSubmit(author.trim(), body.trim(), token);
      }}
    >
      <div className="comment-form-quote">“{truncate(quote, 140)}”</div>
      <input
        type="text"
        placeholder="Your display name"
        maxLength={80}
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        disabled={busy}
      />
      <textarea
        placeholder="Add a comment…"
        rows={3}
        maxLength={10000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
      />
      <Turnstile onToken={setToken} onExpire={() => setToken("")} />
      {error && <div className="form-error">{error}</div>}
      <div className="comment-form-actions">
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit}>
          {busy ? "Posting…" : "Comment"}
        </button>
      </div>
    </form>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
