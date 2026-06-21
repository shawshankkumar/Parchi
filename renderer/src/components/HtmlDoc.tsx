import { forwardRef, useEffect, useRef, useState } from "react";
import type { Anchor } from "../types";
import { anchorFromRange } from "../lib/anchor";

export interface SelectionRect {
  left: number;
  width: number;
  bottom: number;
}

interface Props {
  content: string;
  /** Called when the user selects text inside the iframe. rect is in parent-viewport coords. */
  onSelect?: (anchor: Anchor, rect: SelectionRect) => void;
}

/**
 * Untrusted HTML rendered inside a sandboxed <iframe srcdoc>.
 *
 * Security: the sandbox attribute does NOT include `allow-scripts`, so no script
 * in the gist HTML can execute. We include `allow-same-origin` ONLY so the parent
 * can read the iframe's textContent for comment anchoring; with scripts disabled
 * this does not enable script-based same-origin attacks.
 *
 * The forwarded ref points at the iframe's <body> element once loaded, so the
 * anchoring layer can resolve/highlight against the rendered HTML. Because the
 * content lives in a separate document, text selection happens INSIDE the iframe
 * — so we listen on the iframe's own document and translate the selection rect
 * into parent-viewport coordinates before reporting it to the parent.
 */
export const HtmlDoc = forwardRef<HTMLElement | null, Props>(
  ({ content, onSelect }, ref) => {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const [height, setHeight] = useState(400);

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      let innerDoc: Document | null = null;
      const onMouseUp = () => {
        const idoc = iframe.contentDocument;
        const body = idoc?.body;
        if (!idoc || !body || !onSelect) return;
        const sel = idoc.getSelection();
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!body.contains(range.commonAncestorContainer)) return;
        const anchor = anchorFromRange(body, range);
        if (!anchor) return;
        // Translate the iframe-relative rect into parent-viewport coords.
        const ir = iframe.getBoundingClientRect();
        const rr = range.getBoundingClientRect();
        onSelect(anchor, {
          left: ir.left + rr.left + rr.width / 2,
          width: 0,
          bottom: ir.top + rr.bottom,
        });
      };

      const onLoad = () => {
        const idoc = iframe.contentDocument;
        const body = idoc?.body ?? null;
        // Expose the iframe body to the parent ref for anchoring.
        if (typeof ref === "function") ref(body);
        else if (ref) ref.current = body;

        // Listen for selections inside the iframe document.
        if (idoc) {
          innerDoc = idoc;
          idoc.addEventListener("mouseup", onMouseUp);
        }

        // Auto-size the iframe to its content.
        if (idoc) {
          const h = Math.max(
            idoc.body?.scrollHeight ?? 0,
            idoc.documentElement?.scrollHeight ?? 0,
          );
          if (h) setHeight(h + 16);
        }
      };

      iframe.addEventListener("load", onLoad);
      return () => {
        iframe.removeEventListener("load", onLoad);
        if (innerDoc) innerDoc.removeEventListener("mouseup", onMouseUp);
        if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    }, [content, ref, onSelect]);

    return (
      <iframe
        ref={iframeRef}
        className="doc doc-html"
        title="Document"
        sandbox="allow-same-origin"
        srcDoc={content}
        style={{ width: "100%", height, border: "none" }}
      />
    );
  },
);
HtmlDoc.displayName = "HtmlDoc";
