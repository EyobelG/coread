import { parseDocument } from "htmlparser2";
import { isTag, isText, type ChildNode, type Element } from "domhandler";
import { XMLParser } from "fast-xml-parser";

export interface TocEntry {
  label: string;
  href: string; // relative to the nav/NCX file
  depth: number; // 0 = top level
}

function textOf(node: ChildNode): string {
  if (isText(node)) return node.data;
  if (isTag(node)) return node.children.map(textOf).join("");
  return "";
}

function findNav(nodes: ChildNode[]): Element | undefined {
  for (const node of nodes) {
    if (!isTag(node)) continue;
    if (node.name.toLowerCase() === "nav" && /\btoc\b/.test(node.attribs["epub:type"] ?? "")) return node;
    const found = findNav(node.children);
    if (found) return found;
  }
  return undefined;
}

// EPUB 3 navigation document: <nav epub:type="toc"> with nested <ol>/<li>/<a>.
export function parseNavToc(xhtml: string): TocEntry[] {
  const doc = parseDocument(xhtml, { xmlMode: true, decodeEntities: true });
  const nav = findNav(doc.children);
  if (!nav) return [];

  const out: TocEntry[] = [];
  const walk = (nodes: ChildNode[], depth: number) => {
    for (const node of nodes) {
      if (!isTag(node)) continue;
      const name = node.name.toLowerCase();
      if (name === "a" && node.attribs.href) {
        out.push({
          label: textOf(node).replace(/\s+/g, " ").trim(),
          href: node.attribs.href,
          depth: Math.max(0, depth),
        });
      } else if (name === "ol" || name === "ul") {
        walk(node.children, depth + 1);
      } else {
        walk(node.children, depth);
      }
    }
  };
  // Start at -1 so the outermost <ol> brings depth to 0 for top-level entries.
  walk(nav.children, -1);
  return out;
}

type NcxPoint = {
  navLabel?: { text?: unknown };
  content?: { "@_src"?: string };
  navPoint?: NcxPoint | NcxPoint[];
};

function textValue(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && "#text" in v) return String((v as { "#text": unknown })["#text"]).trim();
  return "";
}

// EPUB 2 NCX fallback for books without a nav document.
export function parseNcxToc(xmlText: string): TocEntry[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true });
  const ncx: { navMap?: { navPoint?: NcxPoint | NcxPoint[] } } | undefined = parser.parse(xmlText)?.ncx;
  const out: TocEntry[] = [];
  const walk = (points: NcxPoint | NcxPoint[] | undefined, depth: number) => {
    const list = Array.isArray(points) ? points : points ? [points] : [];
    for (const p of list) {
      const href = p.content?.["@_src"] ?? "";
      if (href) out.push({ label: textValue(p.navLabel?.text), href, depth });
      walk(p.navPoint, depth + 1);
    }
  };
  walk(ncx?.navMap?.navPoint, 0);
  return out;
}
