import { describe, it, expect } from "vitest";
import { parseChapter, collapseRuns } from "./blocks";
import { checkEntryName, EpubError } from "./zipSafety";

const wrap = (body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title><style>p{}</style></head><body>${body}</body></html>`;

describe("parseChapter", () => {
  it("emits one block per paragraph and heading with levels", () => {
    const blocks = parseChapter(wrap("<h1>Chapter One</h1><p>First.</p><p>Second.</p>"));
    expect(blocks.map((b) => [b.kind, b.level, b.text])).toEqual([
      ["h", 1, "Chapter One"],
      ["p", undefined, "First."],
      ["p", undefined, "Second."],
    ]);
  });

  it("collapses whitespace and trims across inline runs", () => {
    const blocks = parseChapter(wrap("<p>  Hello\n\t <em>big</em>   world  </p>"));
    expect(blocks[0].text).toBe("Hello big world");
    expect(blocks[0].runs.some((r) => r.em)).toBe(true);
  });

  it("drops script and style content entirely", () => {
    const blocks = parseChapter(wrap("<p>Keep</p><script>alert(1)</script><p>Also</p>"));
    expect(blocks.map((b) => b.text)).toEqual(["Keep", "Also"]);
  });

  it("keeps link targets on runs but never emits markup", () => {
    const blocks = parseChapter(wrap('<p>See <a href="ch2.xhtml">next</a>.</p>'));
    expect(blocks[0].text).toBe("See next.");
    expect(blocks[0].runs.find((r) => r.t === "next")?.href).toBe("ch2.xhtml");
  });

  it("splits a div containing block children without losing order", () => {
    const blocks = parseChapter(wrap("<div>lead <p>inner</p> tail</div>"));
    expect(blocks.map((b) => b.text)).toEqual(["lead", "inner", "tail"]);
  });

  it("does not expand external entities", () => {
    const xhtml = `<?xml version="1.0"?><!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html><body><p>&x;</p></body></html>`;
    const blocks = parseChapter(xhtml);
    expect(blocks.every((b) => !b.text.includes("root:"))).toBe(true);
  });
});

describe("collapseRuns", () => {
  it("returns no runs for whitespace-only input", () => {
    expect(collapseRuns([{ t: "  " }, { t: "\n" }])).toEqual([]);
  });
});

describe("checkEntryName", () => {
  it("accepts normal package paths", () => {
    expect(() => checkEntryName("OEBPS/text/ch1.xhtml")).not.toThrow();
  });
  it("rejects traversal, absolute, and backslash paths", () => {
    for (const bad of ["../evil", "OEBPS/../../evil", "/etc/passwd", "C:/x", "a\\b"]) {
      expect(() => checkEntryName(bad)).toThrow(EpubError);
    }
  });
});
