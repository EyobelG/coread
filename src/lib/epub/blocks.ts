import { parseDocument } from "htmlparser2";
import { isTag, isText, type ChildNode } from "domhandler";

// Block kinds exposed to the reader. Anything not listed here is inline content.
export type BlockKind = "p" | "h" | "li" | "blockquote" | "pre";

export interface Run {
  t: string;
  em?: true;
  strong?: true;
  code?: true;
  href?: string;
  // Global ordinal of the block this link points to. Set by parse.ts after all chapters are read.
  target?: number;
}

export interface RawBlock {
  kind: BlockKind;
  level?: number; // heading level 1-6
  runs: Run[];
  text: string; // plain text; anchor offsets index into this
}

export interface ChapterParse {
  blocks: RawBlock[];
  // element id -> index of the block (within this chapter) where that id appears
  anchors: Map<string, number>;
}

const BLOCK_KIND: Record<string, { kind: BlockKind; level?: number }> = {
  p: { kind: "p" },
  div: { kind: "p" },
  section: { kind: "p" },
  article: { kind: "p" },
  header: { kind: "p" },
  footer: { kind: "p" },
  aside: { kind: "p" },
  figcaption: { kind: "p" },
  td: { kind: "p" },
  th: { kind: "p" },
  dt: { kind: "p" },
  dd: { kind: "p" },
  h1: { kind: "h", level: 1 },
  h2: { kind: "h", level: 2 },
  h3: { kind: "h", level: 3 },
  h4: { kind: "h", level: 4 },
  h5: { kind: "h", level: 5 },
  h6: { kind: "h", level: 6 },
  li: { kind: "li" },
  blockquote: { kind: "blockquote" },
  pre: { kind: "pre" },
};

// Dropped with their content. Never rendered.
const SKIP = new Set([
  "script", "style", "head", "img", "svg", "object", "iframe",
  "form", "input", "button", "select", "textarea", "video", "audio",
]);

interface Ctx {
  kind: BlockKind;
  level?: number;
  em?: true;
  strong?: true;
  code?: true;
  href?: string;
}

interface State {
  out: RawBlock[];
  pending: Run[];
  anchors: Map<string, number>;
}

// Collapse whitespace across run boundaries, trim ends, and NFC-normalize.
// Offsets are computed over the output, so normalization must happen here.
export function collapseRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  let lastSpace = true;
  for (const r of runs) {
    let t = "";
    for (const ch of r.t.normalize("NFC")) {
      if (/\s/.test(ch)) {
        if (!lastSpace) {
          t += " ";
          lastSpace = true;
        }
      } else {
        t += ch;
        lastSpace = false;
      }
    }
    if (t) out.push({ ...r, t });
  }
  while (out.length) {
    const last = out[out.length - 1];
    if (!last.t.endsWith(" ")) break;
    last.t = last.t.slice(0, -1);
    if (last.t) break;
    out.pop();
  }
  return out;
}

function flush(pending: Run[], ctx: Ctx, out: RawBlock[]): void {
  const runs = collapseRuns(pending);
  pending.length = 0;
  if (runs.length === 0) return;
  const text = runs.map((r) => r.t).join("");
  out.push({ kind: ctx.kind, level: ctx.level, runs, text });
}

function visit(node: ChildNode, ctx: Ctx, state: State): void {
  const { out, pending } = state;
  if (isText(node)) {
    pending.push({ t: node.data, em: ctx.em, strong: ctx.strong, code: ctx.code, href: ctx.href });
    return;
  }
  if (!isTag(node)) return;

  const name = node.name.toLowerCase();
  if (SKIP.has(name)) return;

  if (name === "br") {
    pending.push({ t: " " });
    return;
  }

  const id = node.attribs.id;
  const block = BLOCK_KIND[name];
  if (block) {
    // Close any inline text before this block so ordering is preserved.
    flush(pending, ctx, out);
    if (id && !state.anchors.has(id)) state.anchors.set(id, out.length);
    const blockCtx: Ctx = { kind: block.kind, level: block.level };
    const inner: Run[] = [];
    const innerState: State = { out, pending: inner, anchors: state.anchors };
    for (const child of node.children) visit(child, blockCtx, innerState);
    flush(inner, blockCtx, out);
    return;
  }

  // Inline element: pending text will land in the block at out.length.
  if (id && !state.anchors.has(id)) state.anchors.set(id, out.length);

  const next: Ctx = {
    ...ctx,
    em: ctx.em || name === "em" || name === "i" || undefined,
    strong: ctx.strong || name === "strong" || name === "b" || undefined,
    code: ctx.code || name === "code" || undefined,
    href: name === "a" ? (node.attribs.href ?? ctx.href) : ctx.href,
  };
  for (const child of node.children) visit(child, next, state);
}

function findBody(nodes: ChildNode[]): ChildNode[] {
  for (const node of nodes) {
    if (isTag(node) && node.name.toLowerCase() === "body") return node.children;
    if (isTag(node)) {
      const found = findBody(node.children);
      if (found.length) return found;
    }
  }
  return [];
}

// Parse one XHTML chapter into blocks plus its id anchors.
// XML mode does not resolve external entities.
export function parseChapterWithAnchors(xhtml: string): ChapterParse {
  const doc = parseDocument(xhtml, { xmlMode: true, decodeEntities: true });
  const body = findBody(doc.children);
  const roots = body.length ? body : doc.children;

  const state: State = { out: [], pending: [], anchors: new Map() };
  const ctx: Ctx = { kind: "p" };
  for (const node of roots) visit(node, ctx, state);
  flush(state.pending, ctx, state.out);
  return { blocks: state.out, anchors: state.anchors };
}

export function parseChapter(xhtml: string): RawBlock[] {
  return parseChapterWithAnchors(xhtml).blocks;
}

export function blockKey(chapterOrdinal: number, blockIndex: number): string {
  return `c${String(chapterOrdinal).padStart(3, "0")}-b${String(blockIndex).padStart(4, "0")}`;
}
