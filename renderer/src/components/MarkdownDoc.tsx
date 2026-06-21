import { forwardRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

interface Props {
  content: string;
}

/**
 * Markdown rendered with react-markdown + rehype-sanitize. The forwarded ref
 * exposes the container element whose textContent is used for anchoring.
 */
export const MarkdownDoc = forwardRef<HTMLDivElement, Props>(
  ({ content }, ref) => {
    return (
      <div ref={ref} className="doc doc-markdown">
        <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
      </div>
    );
  },
);
MarkdownDoc.displayName = "MarkdownDoc";
