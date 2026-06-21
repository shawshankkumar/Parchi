// Minimal type declarations for dom-anchor-text-quote (no types shipped).
declare module "dom-anchor-text-quote" {
  export interface TextQuoteSelector {
    exact: string;
    prefix?: string;
    suffix?: string;
  }
  export interface TextPositionSelector {
    start: number;
    end: number;
  }
  export interface ToOptions {
    hint?: number;
  }
  export function fromRange(root: Node, range: Range): TextQuoteSelector;
  export function fromTextPosition(
    root: Node,
    selector: TextPositionSelector,
  ): TextQuoteSelector;
  export function toRange(
    root: Node,
    selector: TextQuoteSelector,
    options?: ToOptions,
  ): Range | null;
  export function toTextPosition(
    root: Node,
    selector: TextQuoteSelector,
    options?: ToOptions,
  ): TextPositionSelector | null;
}
