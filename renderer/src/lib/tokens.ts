// Edit tokens are stored in localStorage keyed by comment id, namespaced.
const PREFIX = "parchi:edit_token:";

export function saveEditToken(commentId: string, token: string): void {
  try {
    localStorage.setItem(PREFIX + commentId, token);
  } catch {
    // localStorage may be unavailable (private mode); degrade silently.
  }
}

export function getEditToken(commentId: string): string | null {
  try {
    return localStorage.getItem(PREFIX + commentId);
  } catch {
    return null;
  }
}

export function hasEditToken(commentId: string): boolean {
  return getEditToken(commentId) != null;
}

export function clearEditToken(commentId: string): void {
  try {
    localStorage.removeItem(PREFIX + commentId);
  } catch {
    /* ignore */
  }
}
