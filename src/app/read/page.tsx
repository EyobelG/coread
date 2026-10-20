"use client";

import { useEffect, useState } from "react";
import Reader from "@/components/Reader";
import { loadBook, type BookPayload } from "@/lib/bookDb";

// Static route: the book id comes from ?e=<edition>, read on the client.
export default function ReadPage() {
  // undefined = loading, null = not on this device
  const [book, setBook] = useState<BookPayload | null | undefined>(undefined);

  useEffect(() => {
    const edition = new URLSearchParams(window.location.search).get("e");
    if (!edition) {
      setBook(null);
      return;
    }
    loadBook(edition).then(
      (b) => setBook(b ?? null),
      () => setBook(null),
    );
  }, []);

  if (book === undefined) {
    return <p className="p-6 text-stone-500">Loading…</p>;
  }
  if (book === null) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Book not found</h1>
        <p className="mt-2 text-stone-600">
          This book isn&apos;t saved on this device. Books are stored per browser, so import it again here.
        </p>
        <a href="/" className="mt-6 inline-flex min-h-11 items-center rounded bg-stone-900 px-4 text-white">
          Import a book
        </a>
      </main>
    );
  }
  return <Reader edition={book.edition} title={book.title} blocks={book.blocks} toc={book.toc} />;
}
