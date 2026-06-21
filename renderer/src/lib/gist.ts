import type { DocFormat, LoadedDoc, GistHistoryEntry } from "../types";

// Minimal shape of the GitHub Gist API response we rely on.
interface GistFile {
  filename: string;
  content: string;
  raw_url?: string;
  truncated?: boolean;
}
interface GistHistoryRaw {
  version: string;
  committed_at: string;
  url?: string;
}
interface GistApiResponse {
  id: string;
  html_url: string;
  updated_at: string;
  files: Record<string, GistFile>;
  history?: GistHistoryRaw[];
}

function detectFormat(filename: string): DocFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return null;
}

/**
 * Pick the single content file. Contract says the file is named plan.md or plan.html,
 * but we tolerate any single .md/.markdown/.html file as a fallback.
 */
function pickFile(
  files: Record<string, GistFile>,
): { file: GistFile; format: DocFormat } | null {
  const named = files["plan.md"] || files["plan.markdown"] || files["plan.html"];
  if (named) {
    const fmt = detectFormat(named.filename);
    if (fmt) return { file: named, format: fmt };
  }
  // Fallback: first file with a recognised extension.
  for (const f of Object.values(files)) {
    const fmt = detectFormat(f.filename);
    if (fmt) return { file: f, format: fmt };
  }
  return null;
}

export class GistError extends Error {}

export async function fetchGist(gistId: string): Promise<LoadedDoc> {
  const url = `https://api.github.com/gists/${encodeURIComponent(gistId)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
    });
  } catch {
    throw new GistError(
      "Network error while fetching the gist from GitHub. Check your connection and try again.",
    );
  }

  if (res.status === 404) {
    throw new GistError("Gist not found. Check the ?g= id in the URL.");
  }
  if (res.status === 403) {
    throw new GistError(
      "GitHub rate limit reached (unauthenticated requests are limited per IP). Try again later.",
    );
  }
  if (!res.ok) {
    throw new GistError(`GitHub returned ${res.status} while fetching the gist.`);
  }

  const data = (await res.json()) as GistApiResponse;
  const picked = pickFile(data.files || {});
  if (!picked) {
    throw new GistError(
      "This gist has no plan.md or plan.html content file to render.",
    );
  }

  if (picked.file.truncated) {
    // GitHub truncates very large file contents inline; fetch the raw blob.
    if (picked.file.raw_url) {
      try {
        const rawRes = await fetch(picked.file.raw_url);
        if (rawRes.ok) picked.file.content = await rawRes.text();
      } catch {
        // Keep the (possibly truncated) inline content rather than failing hard.
      }
    }
  }

  const history: GistHistoryEntry[] = (data.history || []).map((h) => ({
    version: h.version,
    committed_at: h.committed_at,
    url: h.url,
  }));

  const revision = history[0]?.version ?? data.id;

  return {
    gistId: data.id,
    fileName: picked.file.filename,
    format: picked.format,
    content: picked.file.content,
    revision,
    updatedAt: data.updated_at,
    htmlUrl: data.html_url,
    history,
  };
}
