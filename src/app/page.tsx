"use client";

import { useState } from "react";
import { parseEpub } from "@/lib/epub/parse";
import { EpubError } from "@/lib/epub/zipSafety";
import { saveBook } from "@/lib/bookDb";
import { CATALOG, type CatalogBook } from "@/lib/catalog";
import AccountBar from "@/components/AccountBar";

// Free tier cap. Replace with the tier lookup from the database once auth is wired.
const MAX_BYTES = 10 * 1024 * 1024;

interface ImportResult {
  edition: string;
  title: string;
  author: string | null;
  blockCount: number;
  chapterCount: number;
}

// Parsing happens in the browser; the book is saved to this device's IndexedDB.
async function importBytes(bytes: ArrayBuffer): Promise<ImportResult> {
  const book = await parseEpub(bytes);
  await saveBook({
    edition: book.edition,
    title: book.title,
    author: book.author,
    language: book.language,
    blocks: book.blocks.map(({ key, globalOrdinal, kind, level, runs, text }) => ({
      key,
      globalOrdinal,
      kind,
      level,
      runs,
      text,
    })),
    toc: book.toc,
  });
  return {
    edition: book.edition,
    title: book.title,
    author: book.author,
    blockCount: book.blocks.length,
    chapterCount: book.chapterStarts.length,
  };
}

function errorText(err: unknown): string {
  if (err instanceof EpubError) return err.code;
  console.error(err);
  return "PARSE_FAILED";
}

export default function Home() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // "upload" or a catalog id

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = new FormData(e.currentTarget).get("file");
    if (!(file instanceof File)) return;

    setBusy("upload");
    setError(null);
    setResult(null);
    try {
      if (file.size > MAX_BYTES) throw new EpubError("FILE_TOO_LARGE", `limit ${MAX_BYTES} bytes`);
      setResult(await importBytes(await file.arrayBuffer()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCatalog(book: CatalogBook) {
    setBusy(book.id);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(book.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await importBytes(await res.arrayBuffer()));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-2xl font-semibold">CoRead</h1>
      <p className="mt-1 text-sm text-stone-600">Read free classics, or import an EPUB you own.</p>

      <div className="mt-6 flex flex-col gap-4 rounded-lg border border-stone-200 bg-white p-4">
        <AccountBar />
        <a
          href="/rooms/"
          className="flex min-h-11 items-center justify-center rounded bg-stone-900 px-4 text-white"
        >
          Read together: reading rooms →
        </a>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Free classics</h2>
        <ul className="mt-3 grid gap-2">
          {CATALOG.map((book) => (
            <li key={book.id}>
              <button
                type="button"
                onClick={() => onCatalog(book)}
                disabled={busy !== null}
                className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white px-4 py-3 text-left disabled:opacity-50"
              >
                <span>
                  <span className="block font-medium">{book.title}</span>
                  <span className="block text-sm text-stone-500">{book.author}</span>
                </span>
                <span className="shrink-0 text-sm text-stone-600">{busy === book.id ? "Opening…" : "Open"}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 border-t border-stone-200 pt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Import your EPUB</h2>
        <p className="mt-1 text-sm text-stone-600">Up to 10 MB. Only DRM-free files you have the right to read.</p>
        <form onSubmit={onUpload} className="mt-4 flex flex-col gap-3">
          <input
            type="file"
            name="file"
            accept=".epub,application/epub+zip"
            required
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-stone-900 file:px-4 file:py-2 file:text-white"
          />
          <button
            type="submit"
            disabled={busy !== null}
            className="min-h-11 rounded bg-stone-900 px-4 py-2 text-white disabled:opacity-50"
          >
            {busy === "upload" ? "Parsing…" : "Import"}
          </button>
        </form>
      </section>

      {error && (
        <p role="alert" className="mt-6 text-sm text-red-700">
          Couldn&apos;t open that book: {error}
        </p>
      )}
      {result && (
        <div className="mt-6 rounded-lg border border-stone-200 bg-white p-4">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-stone-600">Title</dt>
            <dd>{result.title}</dd>
            <dt className="text-stone-600">Author</dt>
            <dd>{result.author ?? "—"}</dd>
            <dt className="text-stone-600">Chapters</dt>
            <dd>{result.chapterCount}</dd>
          </dl>
          <a
            href={`/read/?e=${result.edition}`}
            className="mt-4 flex min-h-11 items-center justify-center rounded bg-stone-900 px-4 text-white"
          >
            Open reader
          </a>
        </div>
      )}
    </main>
  );
}
