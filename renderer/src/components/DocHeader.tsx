import type { LoadedDoc } from "../types";

interface Props {
  doc: LoadedDoc;
}

export function DocHeader({ doc }: Props) {
  const total = doc.history.length || 1;
  // Revision N of M: history[0] is the newest, so the current doc is revision M.
  const currentN = total;

  return (
    <header className="doc-header">
      <div className="doc-header-row">
        <h1 className="doc-title">{doc.fileName}</h1>
        <span className="doc-format-badge">{doc.format}</span>
      </div>
      <div className="doc-meta">
        <span>
          Revision {currentN} of {total}
        </span>
        <span> · updated {fmt(doc.updatedAt)}</span>
        <a href={doc.htmlUrl} target="_blank" rel="noopener noreferrer">
          open gist ↗
        </a>
      </div>
      {doc.history.length > 1 && (
        <details className="doc-revisions">
          <summary>Version history ({total})</summary>
          <ol>
            {doc.history.map((h, i) => (
              <li key={h.version}>
                <a
                  href={`https://gist.github.com/${doc.gistId}/${h.version}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Revision {total - i} · {short(h.version)}
                </a>
                <span className="rev-time"> — {fmt(h.committed_at)}</span>
                {i === 0 && <span className="rev-current"> (current)</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
      <div className="privacy-banner">
        This document is fetched directly from GitHub in your browser and never
        touches our servers.
      </div>
    </header>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
function short(s: string): string {
  return s.slice(0, 7);
}
