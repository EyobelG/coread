import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEpub } from "./parse";
import { CATALOG } from "../catalog";

// Real Gutenberg files: guards the parser against layouts the synthetic fixtures miss.
describe("bundled catalog books", () => {
  for (const book of CATALOG) {
    it(`parses ${book.title}`, async () => {
      const bytes = readFileSync(join(process.cwd(), "public", book.file));
      const parsed = await parseEpub(new Uint8Array(bytes));
      expect(parsed.blocks.length).toBeGreaterThan(100);
      expect(parsed.chapterStarts.length).toBeGreaterThan(0);
      expect(parsed.toc.length).toBeGreaterThan(0);
      expect(parsed.edition).toMatch(/^[0-9a-f]{64}$/);
    }, 60_000);
  }
});
