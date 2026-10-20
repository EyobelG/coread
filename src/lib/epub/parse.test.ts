import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseEpub } from "./parse";

const CONTAINER = `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;

const opf = (spineHref = "text/ch2.xhtml") => `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title><dc:creator>Jane Doe</dc:creator><dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="${spineHref}" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`;

const xhtml = (body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`;

async function makeEpub(files: Record<string, string>, { mimetype = true } = {}): Promise<Uint8Array> {
  const zip = new JSZip();
  if (mimetype) zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: "uint8array" });
}

const good = () =>
  makeEpub({
    "META-INF/container.xml": CONTAINER,
    "OEBPS/content.opf": opf(),
    "OEBPS/text/ch1.xhtml": xhtml("<h1>One</h1><p>Alpha beta.</p>"),
    "OEBPS/text/ch2.xhtml": xhtml("<p>Gamma.</p><p>Delta epsilon.</p>"),
  });

describe("parseEpub", () => {
  it("extracts metadata, blocks, and contiguous global ordinals across chapters", async () => {
    const book = await parseEpub(await good());
    expect(book.title).toBe("Test Book");
    expect(book.author).toBe("Jane Doe");
    expect(book.language).toBe("en");
    expect(book.blocks.map((b) => b.text)).toEqual(["One", "Alpha beta.", "Gamma.", "Delta epsilon."]);
    expect(book.blocks.map((b) => b.globalOrdinal)).toEqual([0, 1, 2, 3]);
    expect(book.blocks.map((b) => b.key)).toEqual(["c000-b0000", "c000-b0001", "c001-b0000", "c001-b0001"]);
    expect(book.chapterStarts).toEqual([0, 2]);
  });

  it("produces a 64-char edition hash that is stable for identical bytes", async () => {
    const bytes = await good();
    const a = await parseEpub(bytes);
    const b = await parseEpub(bytes);
    expect(a.edition).toMatch(/^[0-9a-f]{64}$/);
    expect(a.edition).toBe(b.edition);
  });

  it("rejects DRM-protected files", async () => {
    const bytes = await makeEpub({
      "META-INF/container.xml": CONTAINER,
      "META-INF/encryption.xml": "<encryption/>",
      "OEBPS/content.opf": opf(),
      "OEBPS/text/ch1.xhtml": xhtml("<p>x</p>"),
      "OEBPS/text/ch2.xhtml": xhtml("<p>y</p>"),
    });
    await expect(parseEpub(bytes)).rejects.toMatchObject({ code: "DRM_UNSUPPORTED" });
  });

  it("rejects spine hrefs that escape the package", async () => {
    const bytes = await makeEpub({
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": opf("../../etc/passwd.xhtml"),
      "OEBPS/text/ch1.xhtml": xhtml("<p>x</p>"),
    });
    await expect(parseEpub(bytes)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });

  it("rejects ZIPs without a valid mimetype entry", async () => {
    const bytes = await makeEpub({ "META-INF/container.xml": CONTAINER }, { mimetype: false });
    await expect(parseEpub(bytes)).rejects.toMatchObject({ code: "NOT_EPUB" });
  });

  it("rejects non-ZIP input", async () => {
    await expect(parseEpub(new TextEncoder().encode("not a zip"))).rejects.toThrow();
  });
});
