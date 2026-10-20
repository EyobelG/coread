"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AccountBar from "@/components/AccountBar";
import Reader, { type RoomHooks, type RoomNote } from "@/components/Reader";
import { loadBook, saveBook, type BookPayload } from "@/lib/bookDb";
import { parseEpub } from "@/lib/epub/parse";
import {
  addNote,
  createInvite,
  currentUserId,
  friendlyError,
  getRoom,
  listNotes,
  listProgress,
  saveProgress,
  type NoteRow,
  type ProgressRow,
  type RoomRow,
} from "@/lib/rooms";

// The book is read from this device. If it's missing, a catalog book is downloaded and
// checked against the room's edition hash, so everyone reads identical text.
async function ensureBook(room: RoomRow): Promise<BookPayload> {
  const edition = room.books.edition_sha256;
  const local = await loadBook(edition);
  if (local) return local;

  const res = await fetch(room.books.storage_path);
  if (!res.ok) throw new Error(`Couldn't download the book (HTTP ${res.status}).`);
  const parsed = await parseEpub(await res.arrayBuffer());
  if (parsed.edition !== edition) throw new Error("This copy of the book doesn't match the room's edition.");

  const payload: BookPayload = {
    edition,
    title: parsed.title,
    author: parsed.author,
    language: parsed.language,
    blocks: parsed.blocks.map(({ key, globalOrdinal, kind, level, runs, text }) => ({
      key,
      globalOrdinal,
      kind,
      level,
      runs,
      text,
    })),
    toc: parsed.toc,
  };
  await saveBook(payload);
  return payload;
}

export default function RoomPage() {
  const [phase, setPhase] = useState<"loading" | "signin" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [book, setBook] = useState<BookPayload | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Latest on-screen position from the reader, and the last position saved to the database.
  const pendingOrd = useRef<number | null>(null);
  const savedOrd = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const uid = await currentUserId();
        if (!uid) {
          setPhase("signin");
          return;
        }
        setUserId(uid);
        const id = new URLSearchParams(window.location.search).get("id");
        if (!id) throw new Error("This link is missing the room id.");
        const r = await getRoom(id);
        setRoom(r);
        setBook(await ensureBook(r));
        setPhase("ready");
      } catch (err) {
        setError(friendlyError(err));
        setPhase("error");
      }
    })();
  }, []);

  // Shared progress and notes refresh every 8 seconds.
  useEffect(() => {
    if (phase !== "ready" || !room) return;
    const refresh = async () => {
      try {
        const [p, n] = await Promise.all([listProgress(room.id), listNotes(room.id)]);
        setProgress(p);
        setNotes(n);
      } catch {
        // Keep the last good data on a failed refresh.
      }
    };
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [phase, room]);

  // Save position every 3 seconds, only when it changed.
  useEffect(() => {
    if (phase !== "ready" || !room || !userId) return;
    const t = setInterval(async () => {
      const ord = pendingOrd.current;
      if (ord === null || ord === savedOrd.current) return;
      try {
        await saveProgress(room.id, userId, ord);
        savedOrd.current = ord;
      } catch {
        // Retried on the next tick.
      }
    }, 3000);
    return () => clearInterval(t);
  }, [phase, room, userId]);

  const roomNotes: RoomNote[] = useMemo(
    () =>
      notes.map((n) => ({
        id: n.id,
        author: n.author_id === userId ? "You" : `Reader ${n.author_id.slice(0, 4)}`,
        ord: n.start_ordinal,
        start: n.start_offset,
        quote: n.quote_exact,
        body: n.body,
        own: n.author_id === userId,
      })),
    [notes, userId],
  );

  const hooks: RoomHooks | undefined =
    room && book && userId
      ? {
          notes: roomNotes,
          onPosition: (ord: number) => {
            pendingOrd.current = ord;
          },
          onNote: async (draft, body) => {
            const block = book.blocks.find((b) => b.globalOrdinal === draft.ord);
            if (!block) throw new Error("That paragraph isn't in this copy of the book.");
            await addNote(room.id, userId, draft, block.text, body);
            setNotes(await listNotes(room.id));
          },
        }
      : undefined;

  async function onInvite() {
    if (!room) return;
    setInviteError(null);
    try {
      const token = await createInvite(room.id);
      setInvite(`${window.location.origin}/join/?t=${token}`);
    } catch (err) {
      setInviteError(friendlyError(err));
    }
  }

  if (phase === "loading") return <p className="p-6 text-stone-500">Opening room…</p>;

  if (phase === "signin") {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Sign in to open this room</h1>
        <div className="mt-6">
          <AccountBar />
        </div>
      </main>
    );
  }

  if (phase === "error" || !room || !book) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Can't open this room</h1>
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
        <a href="/rooms/" className="mt-6 inline-flex min-h-11 items-center rounded bg-stone-900 px-4 text-white">
          Back to my rooms
        </a>
      </main>
    );
  }

  const total = Math.max(1, book.blocks.length - 1);
  const isOwner = room.owner_id === userId;

  return (
    <>
      <section className="border-b border-stone-200 bg-white px-4 py-3 text-sm">
        <div className="mx-auto flex max-w-prose flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <a href="/rooms/" className="text-stone-600 underline">
              ← Rooms
            </a>
            <span className="min-w-0 truncate font-medium">{room.name}</span>
          </div>
          <ul className="flex flex-wrap gap-2 text-xs text-stone-700">
            {progress.length === 0 && <li className="text-stone-500">No one has started yet.</li>}
            {progress.map((p) => (
              <li key={p.user_id} className="rounded-full bg-stone-100 px-3 py-1">
                {p.user_id === userId ? "You" : `Reader ${p.user_id.slice(0, 4)}`}{" "}
                {Math.round((100 * p.current_ordinal) / total)}%
              </li>
            ))}
          </ul>
          {isOwner && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onInvite}
                className="min-h-11 rounded border border-stone-300 px-3 text-stone-800"
              >
                Create invite link
              </button>
              {invite && (
                <input
                  readOnly
                  value={invite}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="Invite link"
                  className="min-h-11 min-w-0 flex-1 rounded border border-stone-300 bg-stone-50 px-3 text-xs"
                />
              )}
            </div>
          )}
          {inviteError && (
            <p role="alert" className="text-red-700">
              {inviteError}
            </p>
          )}
        </div>
      </section>

      <Reader
        edition={book.edition}
        title={`${book.title}${book.author ? ` — ${book.author}` : ""}`}
        blocks={book.blocks}
        toc={book.toc}
        room={hooks}
      />
    </>
  );
}
