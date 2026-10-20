import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseEpub } from "./parse";

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Linked</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

const CH1 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h1>One</h1>
  <p>See <a href="ch2.xhtml#sec">section two</a> and <a href="https://example.com">the web</a>.</p>
  <p>Footnote <a href="#fn1">1</a>.</p>
  <p id="fn1">Note text.</p>
</body></html>`;

const CH2 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>
  <h2>Two</h2>
  <p>Intro.</p>
  <h2 id="sec">Section</h2>
</body></html>`;

const NAV = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
  <nav epub:type="toc"><ol>
    <li><a href="text/ch1.xhtml">Chapter One</a></li>
    <li><a href="text/ch2.xhtml#sec">Chapter Two</a>
      <ol><li><a href="text/ch2.xhtml#sec">Section</a></li></ol>
    </li>
  </ol></nav>
</body></html>`;

async function epub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", OPF);
  zip.file("OEBPS/nav.xhtml", NAV);
  zip.file("OEBPS/text/ch1.xhtml", CH1);
  zip.file("OEBPS/text/ch2.xhtml", CH2);
  return zip.generateAsync({ type: "uint8array" });
}

describe("internal links and TOC", () => {
  it("resolves cross-chapter links to the anchored block", async () => {
    const book = await parseEpub(await epub());
    const sectionOrd = book.blocks.find((b) => b.text === "Section")!.globalOrdinal;
    const link = book.blocks
      .flatMap((b) => b.runs)
      .find((r) => r.t === "section two");
    expect(link?.target).toBe(sectionOrd);
  });

  it("resolves same-chapter footnote anchors", async () => {
    const book = await parseEpub(await epub());
    const note = book.blocks.find((b) => b.text === "Note text.")!;
    const link = book.blocks.flatMap((b) => b.runs).find((r) => r.href === "#fn1");
    expect(link?.target).toBe(note.globalOrdinal);
  });

  it("leaves external links without a target", async () => {
    const book = await parseEpub(await epub());
    const ext = book.blocks.flatMap((b) => b.runs).find((r) => r.t === "the web");
    expect(ext?.href).toBe("https://example.com");
    expect(ext?.target).toBeUndefined();
  });

  it("builds a nested TOC from the EPUB 3 nav document", async () => {
    const book = await parseEpub(await epub());
    const ch1 = book.blocks.find((b) => b.text === "One")!.globalOrdinal;
    const ch2 = book.blocks.find((b) => b.text === "Two")!.globalOrdinal;
    const section = book.blocks.find((b) => b.text === "Section")!.globalOrdinal;
    expect(book.toc).toEqual([
      { label: "Chapter One", depth: 0, ordinal: ch1 },
      { label: "Chapter Two", depth: 0, ordinal: section },
      { label: "Section", depth: 1, ordinal: section },
    ]);
    expect(ch2).toBeGreaterThan(ch1);
  });
});
