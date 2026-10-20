"use client";

import { useEffect, useState, type FormEvent } from "react";
import AccountBar from "@/components/AccountBar";
import {
  currentUserId,
  createRoom,
  friendlyError,
  listCatalogBooks,
  listRooms,
  type CatalogRow,
  type RoomRow,
} from "@/lib/rooms";

export default function RoomsPage() {
  const [phase, setPhase] = useState<"loading" | "signin" | "ready" | "error">("loading");
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [books, setBooks] = useState<CatalogRow[]>([]);
  const [name, setName] = useState("");
  const [bookId, setBookId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!(await currentUserId())) {
          setPhase("signin");
          return;
        }
        const [roomList, bookList] = await Promise.all([listRooms(), listCatalogBooks()]);
        setRooms(roomList);
        setBooks(bookList);
        if (bookList[0]) setBookId(bookList[0].id);
        setPhase("ready");
      } catch (err) {
        setError(friendlyError(err));
        setPhase("error");
      }
    })();
  }, []);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = await createRoom(bookId, name.trim() || "Reading room");
      window.location.href = `/room/?id=${id}`;
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  if (phase === "loading") return <p className="p-6 text-stone-500">Loading…</p>;

  if (phase === "signin") {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Sign in to read together</h1>
        <p className="mt-2 text-sm text-stone-600">Rooms need an account so friends can find each other.</p>
        <div className="mt-6">
          <AccountBar />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <a href="/" className="text-sm text-stone-600 underline">
        ← Home
      </a>
      <h1 className="mt-4 text-2xl font-semibold">Reading rooms</h1>

      <div className="mt-4">
        <AccountBar />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Your rooms</h2>
        {rooms.length === 0 && <p className="mt-2 text-sm text-stone-600">No rooms yet. Create one below.</p>}
        <ul className="mt-3 grid gap-2">
          {rooms.map((r) => (
            <li key={r.id}>
              <a
                href={`/room/?id=${r.id}`}
                className="flex min-h-14 items-center justify-between rounded-lg border border-stone-200 bg-white px-4 py-3"
              >
                <span>
                  <span className="block font-medium">{r.name}</span>
                  <span className="block text-sm text-stone-500">{r.books.title}</span>
                </span>
                <span className="text-sm text-stone-600">Open →</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 border-t border-stone-200 pt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">New room</h2>
        <form onSubmit={onCreate} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Book
            <select
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              className="min-h-11 rounded border border-stone-300 bg-white px-3"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.author ? ` — ${b.author}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Room name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder="Thursday book club"
              className="min-h-11 rounded border border-stone-300 bg-white px-3"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !bookId}
            className="min-h-11 rounded bg-stone-900 px-4 text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create room"}
          </button>
        </form>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
