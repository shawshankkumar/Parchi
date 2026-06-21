import * as textQuote from "dom-anchor-text-quote";
import type { Anchor } from "../types";

const CONTEXT_LEN = 32;

/**
 * Find the nearest ancestor block element of a node within `root`, and report
 * its index among all block elements (accelerator hint), plus the heading path
 * leading up to it.
 */
function describeBlock(
  root: HTMLElement,
  node: Node,
): { blockIndex: number; headingPath: string[] } {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>(
      "p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, div",
    ),
  );
  let el: Node | null = node;
  while (el && el !== root && !(el instanceof HTMLElement)) {
    el = el.parentNode;
  }
  let target = el as HTMLElement | null;
  // Walk up to the first element that is in our block list.
  while (target && target !== root && !blocks.includes(target)) {
    target = target.parentElement;
  }
  const blockIndex = target ? blocks.indexOf(target) : -1;

  // Heading path: collect headings that precede the target in document order.
  const headingPath: string[] = [];
  if (target) {
    const headings = Array.from(
      root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
    );
    const seenLevels: Record<number, string> = {};
    for (const h of headings) {
      const pos = target.compareDocumentPosition(h);
      const before =
        h === target ||
        (pos & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
      if (!before) break;
      const level = Number(h.tagName[1]);
      // Reset deeper levels.
      for (const k of Object.keys(seenLevels)) {
        if (Number(k) >= level) delete seenLevels[Number(k)];
      }
      seenLevels[level] = h.textContent?.trim() ?? "";
    }
    for (const lvl of Object.keys(seenLevels)
      .map(Number)
      .sort((a, b) => a - b)) {
      if (seenLevels[lvl]) headingPath.push(seenLevels[lvl]);
    }
  }
  return { blockIndex, headingPath };
}

/**
 * Build a contract Anchor from a user selection Range within the rendered root.
 * Returns null if the selection is empty/whitespace.
 */
export function anchorFromRange(root: HTMLElement, range: Range): Anchor | null {
  const quote = range.toString();
  if (!quote.trim()) return null;

  const sel = textQuote.fromRange(root, range);
  const fullText = root.textContent ?? "";

  // Compute raw offsets within textContent for the startOffset/endOffset hints.
  const startOffset = computeOffset(root, range.startContainer, range.startOffset);
  const endOffset = startOffset >= 0 ? startOffset + quote.length : -1;

  const prefix =
    sel.prefix ?? (startOffset > 0
      ? fullText.slice(Math.max(0, startOffset - CONTEXT_LEN), startOffset)
      : "");
  const suffix =
    sel.suffix ?? (endOffset >= 0
      ? fullText.slice(endOffset, endOffset + CONTEXT_LEN)
      : "");

  const { blockIndex, headingPath } = describeBlock(root, range.startContainer);

  return {
    quote: sel.exact ?? quote,
    prefix,
    suffix,
    blockIndex,
    headingPath,
    startOffset: startOffset < 0 ? 0 : startOffset,
    endOffset: endOffset < 0 ? quote.length : endOffset,
  };
}

/** Compute the textContent offset of (container, offset) within root. */
function computeOffset(root: HTMLElement, container: Node, offset: number): number {
  // Use the root's own document so this works inside the HTML iframe too.
  const ownerDoc = root.ownerDocument ?? document;
  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node === container) return total + offset;
    total += (node.textContent ?? "").length;
    node = walker.nextNode();
  }
  // Container may be an element (e.g. selection anchored at element boundary).
  if (container.nodeType === Node.ELEMENT_NODE) {
    const child = container.childNodes[offset];
    if (child) {
      const w2 = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let t = 0;
      let n: Node | null = w2.nextNode();
      while (n) {
        if (
          child.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING ||
          n === child
        ) {
          return t;
        }
        t += (n.textContent ?? "").length;
        n = w2.nextNode();
      }
    }
  }
  return -1;
}

export interface ResolveResult {
  range: Range | null;
  matched: boolean;
}

/**
 * Re-resolve an Anchor against the current rendered root.
 * Uses prefix/suffix to disambiguate and the startOffset as a proximity hint.
 */
export function resolveAnchor(root: HTMLElement, anchor: Anchor): ResolveResult {
  const selector: textQuote.TextQuoteSelector = {
    exact: anchor.quote,
    prefix: anchor.prefix,
    suffix: anchor.suffix,
  };
  let range: Range | null = null;
  try {
    range = textQuote.toRange(root, selector, { hint: anchor.startOffset });
  } catch {
    range = null;
  }
  return { range, matched: range != null };
}
