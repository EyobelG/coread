import { XMLParser } from "fast-xml-parser";
import { parseChapterWithAnchors, blockKey, type RawBlock } from "./blocks";
import * as posix from "./path";
import { sha256Hex } from "./path";
import { parseNavToc, parseNcxToc } from "./toc";
import { openEpubZip, EpubError } from "./zipSafety";

export interface ParsedBlock extends RawBlock {
  key: string;
  globalOrdinal: number;
  chapterOrdinal: number;
  textHash: string;
}

export interface ParsedTocEntry {
  label: string;
  depth: number;
  ordinal: number | null; // global ordinal of the target block, null if unresolvable
}

export interface ParsedBook {
  edition: string; // sha256 of the input file
  title: string;
  author: string | null;
  language: string | null;
  blocks: ParsedBlock[];
  chapterStarts: number[]; // first global ordinal of each chapter
  toc: ParsedTocEntry[];
}

interface ChapterInfo {
  path: string; // full zip path
  firstOrdinal: number;
  anchors: Map<string, number>; // id -> block index within chapter
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

type Zip = Awaited<ReturnType<typeof openEpubZip>>;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
});

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

const text = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return String((v as { "#text": unknown })["#text"]).trim();
  return "";
};

function safeDecode(s: string): string | undefined {
  try {
    return decodeURI(s);
  } catch {
    return undefined;
  }
}

async function readPart(zip: Zip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new EpubError("MISSING_PART", `missing ${path}`);
  return file.async("string");
}

// Resolve an href from a document in baseDir to a global block ordinal.
// Returns undefined for external URLs or targets outside the spine.
export function resolveTarget(
  href: string,
  baseDir: string,
  chapters: Map<string, ChapterInfo>,
  current?: ChapterInfo,
): number | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;

  const hash = href.indexOf("#");
  const pathPart = hash === -1 ? href : href.slice(0, hash);
  const frag = hash === -1 ? "" : href.slice(hash + 1);

  let chapter = current;
  if (pathPart) {
    const decoded = safeDecode(pathPart);
    if (decoded === undefined) return undefined;
    chapter = chapters.get(posix.normalize(posix.join(baseDir, decoded)));
  }
  if (!chapter) return undefined;

  if (frag) {
    const idx = chapter.anchors.get(safeDecode(frag) ?? frag);
    if (idx !== undefined) return chapter.firstOrdinal + idx;
  }
  return chapter.firstOrdinal;
}

async function readToc(
  zip: Zip,
  items: ManifestItem[],
  opfDir: string,
  chapters: Map<string, ChapterInfo>,
): Promise<ParsedTocEntry[]> {
  const nav = items.find((i) => i.properties.split(/\s+/).includes("nav"));
  const ncx = items.find((i) => i.mediaType === "application/x-dtbncx+xml");
  try {
    let entries;
    let baseDir: string;
    if (nav) {
      const path = posix.normalize(posix.join(opfDir, safeDecode(nav.href) ?? nav.href));
      entries = parseNavToc(await readPart(zip, path));
      baseDir = posix.dirname(path);
    } else if (ncx) {
      const path = posix.normalize(posix.join(opfDir, safeDecode(ncx.href) ?? ncx.href));
      entries = parseNcxToc(await readPart(zip, path));
      baseDir = posix.dirname(path);
    } else {
      return [];
    }
    return entries.map((e) => ({
      label: e.label || "Untitled",
      depth: e.depth,
      ordinal: resolveTarget(e.href, baseDir, chapters) ?? null,
    }));
  } catch {
    // A broken TOC should not block reading the book.
    return [];
  }
}

export async function parseEpub(data: ArrayBuffer | Uint8Array): Promise<ParsedBook> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const edition = await sha256Hex(bytes);

  const zip = await openEpubZip(bytes);
  if (zip.file("META-INF/encryption.xml")) {
    throw new EpubError("DRM_UNSUPPORTED", "encrypted or DRM-protected EPUB");
  }

  const container = xml.parse(await readPart(zip, "META-INF/container.xml"));
  const rootfile = arr(container?.container?.rootfiles?.rootfile)[0];
  const opfPath: string | undefined = rootfile?.["@_full-path"];
  if (!opfPath) throw new EpubError("BAD_CONTAINER", "no rootfile in container.xml");

  const opfDir = posix.dirname(opfPath);
  const pkg = xml.parse(await readPart(zip, opfPath)).package;
  if (!pkg) throw new EpubError("BAD_OPF", "missing package element");

  const meta = pkg.metadata ?? {};
  const items: ManifestItem[] = arr(pkg.manifest?.item).map((item) => ({
    id: item["@_id"],
    href: item["@_href"],
    mediaType: item["@_media-type"] ?? "",
    properties: item["@_properties"] ?? "",
  }));
  const manifest = new Map(items.map((i) => [i.id, i]));

  const blocks: ParsedBlock[] = [];
  const chapterStarts: number[] = [];
  const chapters = new Map<string, ChapterInfo>();
  const chapterList: ChapterInfo[] = [];
  let chapterOrdinal = 0;

  for (const ref of arr(pkg.spine?.itemref)) {
    const item = manifest.get(ref["@_idref"]);
    if (!item || !/xhtml|html/.test(item.mediaType)) continue;

    // Resolve relative to the OPF, and stay inside the package.
    const decoded = safeDecode(item.href);
    if (decoded === undefined) throw new EpubError("BAD_OPF", `malformed href: ${item.href}`);
    const path = posix.normalize(posix.join(opfDir, decoded));
    if (path.startsWith("..")) throw new EpubError("UNSAFE_PATH", `spine href escapes package: ${item.href}`);

    const parsed = parseChapterWithAnchors(await readPart(zip, path));
    const info: ChapterInfo = { path, firstOrdinal: blocks.length, anchors: parsed.anchors };
    chapters.set(path, info);
    chapterList.push(info);
    chapterStarts.push(blocks.length);

    for (let i = 0; i < parsed.blocks.length; i++) {
      const b = parsed.blocks[i];
      blocks.push({
        ...b,
        key: blockKey(chapterOrdinal, i),
        globalOrdinal: blocks.length,
        chapterOrdinal,
        textHash: await sha256Hex(new TextEncoder().encode(b.text)),
      });
    }
    chapterOrdinal++;
  }

  if (blocks.length === 0) throw new EpubError("EMPTY_BOOK", "no readable text in spine");

  // Link targets need every chapter's anchors, so resolve after the spine walk.
  for (const block of blocks) {
    const info = chapterList[block.chapterOrdinal];
    const baseDir = posix.dirname(info.path);
    for (const run of block.runs) {
      if (run.href) run.target = resolveTarget(run.href, baseDir, chapters, info);
    }
  }

  return {
    edition,
    title: text(meta["title"]) || "Untitled",
    author: text(meta["creator"]) || null,
    language: text(meta["language"]) || null,
    blocks,
    chapterStarts,
    toc: await readToc(zip, items, opfDir, chapters),
  };
}
