import type { ReaderBlock, TocItem } from "@/components/Reader";

// A parsed book as the reader needs it. Stored on this device only.
export interface BookPayload {
  edition: string;
  title: string;
  author: string | null;
  language: string | null;
  blocks: ReaderBlock[];
  toc: TocItem[];
}

const DB_NAME = "coread";
const STORE = "books";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "edition" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Per-device storage: a book imported on one device is not available on another.
export async function saveBook(book: BookPayload): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(book);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadBook(edition: string): Promise<BookPayload | undefined> {
  const db = await open();
  try {
    return await new Promise<BookPayload | undefined>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(edition);
      req.onsuccess = () => resolve(req.result as BookPayload | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
