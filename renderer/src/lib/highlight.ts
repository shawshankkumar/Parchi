// Wrap a resolved Range in highlight <mark> spans. Multi-node ranges are split
// into per-text-node spans so we don't break the DOM structure.

const HL_CLASS = "parchi-hl";

export function clearHighlights(root: HTMLElement): void {
  const marks = Array.from(root.querySelectorAll<HTMLElement>(`mark.${HL_CLASS}`));
  for (const m of marks) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

/**
 * Highlight the given range, tagging each wrapper with the comment id.
 * Returns the first wrapper element (for scroll-into-view), or null.
 */
export function highlightRange(
  range: Range,
  commentId: string,
  onClick: (commentId: string) => void,
): HTMLElement | null {
  const textNodes = collectTextNodes(range);
  let first: HTMLElement | null = null;

  for (const { node, start, end } of textNodes) {
    const text = node.textContent ?? "";
    if (start >= end) continue;
    const before = text.slice(0, start);
    const middle = text.slice(start, end);
    const after = text.slice(end);

    // Create nodes in the same document as the text node (iframe-safe).
    const ownerDoc = node.ownerDocument ?? document;
    const mark = ownerDoc.createElement("mark");
    mark.className = HL_CLASS;
    mark.dataset.commentId = commentId;
    mark.textContent = middle;
    mark.style.cursor = "pointer";
    mark.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(commentId);
    });

    const parent = node.parentNode;
    if (!parent) continue;
    const frag = ownerDoc.createDocumentFragment();
    if (before) frag.appendChild(ownerDoc.createTextNode(before));
    frag.appendChild(mark);
    if (after) frag.appendChild(ownerDoc.createTextNode(after));
    parent.replaceChild(frag, node);

    if (!first) first = mark;
  }
  return first;
}

interface NodePart {
  node: Text;
  start: number;
  end: number;
}

function collectTextNodes(range: Range): NodePart[] {
  const root = range.commonAncestorContainer;
  const parts: NodePart[] = [];
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode! : root,
    NodeFilter.SHOW_TEXT,
    null,
  );
  let n: Node | null = walker.nextNode();
  while (n) {
    const tn = n as Text;
    if (range.intersectsNode(tn)) {
      const len = tn.textContent?.length ?? 0;
      let start = 0;
      let end = len;
      if (tn === range.startContainer) start = range.startOffset;
      if (tn === range.endContainer) end = range.endOffset;
      // Skip text nodes that only touch boundaries with zero overlap.
      if (end > start) parts.push({ node: tn, start, end });
    }
    n = walker.nextNode();
  }
  return parts;
}

export function focusHighlight(root: HTMLElement, commentId: string): void {
  const el = root.querySelector<HTMLElement>(
    `mark.${HL_CLASS}[data-comment-id="${cssEscape(commentId)}"]`,
  );
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("parchi-hl-flash");
    setTimeout(() => el.classList.remove("parchi-hl-flash"), 1200);
  }
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/["\\]/g, "\\$&");
}
