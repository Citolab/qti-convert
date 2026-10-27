/**
 * Format-neutral page layout. The paper designs (compose.ts) produce these
 * blocks once; render-docx.ts and render-pdf.ts each draw them. All sizes are
 * in points (1/72 inch).
 */

export type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sup?: boolean;
  sub?: boolean;
  mono?: boolean;
  /** Hex without #, e.g. '555555' */
  color?: string;
  size?: number;
};

export type InlineNode =
  | { t: 'text'; text: string; style?: TextStyle }
  | { t: 'break' }
  /** A blank to write on, optionally numbered "(1)" and optionally filled in (answer key). */
  | { t: 'gap'; label?: string; width: number; fill?: string }
  /** Answer bubble ○ / ● or checkbox ☐ / ☒, optionally followed by its letter. */
  | { t: 'mark'; shape: 'circle' | 'square'; label?: string; filled?: boolean }
  /** Bordered box, empty or with a letter written in it. */
  | { t: 'box'; text?: string; width?: number }
  | { t: 'image'; path: string; width: number; height: number }
  | { t: 'space'; width: number };

export type ImageOverlay = {
  shape: 'circle' | 'rect' | 'poly' | 'ellipse' | 'default';
  /** In the image's own coordinate space (see LayoutImage.coordWidth). */
  coords: number[];
  /** Letter or number drawn in a disc at the shape's centre. */
  label?: string;
  /** Draw the outline of the shape (answer key areas). */
  outline?: boolean;
};

export type LayoutImage = {
  t: 'image';
  path: string;
  width: number;
  height: number;
  /** Coordinate space QTI coords are expressed in (declared or intrinsic size). */
  coordWidth?: number;
  coordHeight?: number;
  overlays?: ImageOverlay[];
  indent?: number;
};

export type ParaStyle = 'title' | 'heading' | 'subheading' | 'body' | 'small' | 'muted' | 'note';

export type LayoutCell = {
  blocks: LayoutBlock[];
  shade?: boolean;
  align?: 'left' | 'center';
};

export type LayoutRow = { cells: LayoutCell[]; header?: boolean };

export type LayoutBlock =
  | {
      t: 'para';
      content: InlineNode[];
      style?: ParaStyle;
      align?: 'left' | 'center';
      indent?: number;
      /** Hanging first line, for "A.  option text" lists. */
      hanging?: number;
      spaceBefore?: number;
      spaceAfter?: number;
      keepNext?: boolean;
    }
  | {
      t: 'table';
      /** Relative column widths */
      widths: number[];
      rows: LayoutRow[];
      borders: 'grid' | 'none' | 'rows' | 'outer';
      indent?: number;
      /** Fraction of the available width; default 1 */
      fill?: number;
    }
  | LayoutImage
  /** Ruled writing lines; `texts` pre-fills them (answer key). */
  | { t: 'lines'; count: number; texts?: string[]; indent?: number }
  /** Empty bordered area to draw or work in. */
  | { t: 'box'; height: number; indent?: number }
  | { t: 'spacer'; height: number }
  | { t: 'pageBreak' }
  /** Keep on one page when it fits (a whole question). */
  | { t: 'group'; blocks: LayoutBlock[] };

export type LayoutDocument = {
  title: string;
  /** Small running header on every page. */
  header?: string;
  /** "Page {n} of {total}" */
  pageLabel: (page: number, total: number) => string;
  blocks: LayoutBlock[];
};

export const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 56,
  get contentWidth(): number {
    return this.width - 2 * this.margin;
  }
};

export const FONT_SIZE: Record<ParaStyle, number> = {
  title: 18,
  heading: 13,
  subheading: 11,
  body: 11,
  small: 9.5,
  muted: 9.5,
  note: 10
};

export const COLOR = {
  text: '1A1A1A',
  muted: '555555',
  note: '994400',
  rule: '999999',
  shade: 'EEEEEE',
  mark: 'C00000'
};

export function text(value: string, style?: TextStyle): InlineNode {
  return style ? { t: 'text', text: value, style } : { t: 'text', text: value };
}

export function para(
  content: InlineNode[] | string,
  opts: Omit<Extract<LayoutBlock, { t: 'para' }>, 't' | 'content'> = {}
): LayoutBlock {
  return { t: 'para', content: typeof content === 'string' ? [text(content)] : content, ...opts };
}
