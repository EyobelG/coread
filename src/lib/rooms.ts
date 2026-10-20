import { supabase } from "./supabase";

// Room, progress, and note data. Every call runs as the signed-in user; RLS decides what they can see.

export interface CatalogRow {
  id: string;
  title: string;
  author: string | null;
  edition_sha256: string;
  storage_path: string;
}

export interface RoomRow {
  id: string;
  name: string;
  owner_id: string;
  books: { title: string; edition_sha256: string; storage_path: string };
}

export interface ProgressRow {
  user_id: string;
  current_ordinal: number;
  high_water: number;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  author_id: string;
  start_ordinal: number;
  start_offset: number;
  end_offset: number;
  quote_exact: string;
  body: string;
  created_at: string;
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

export async function listCatalogBooks(): Promise<CatalogRow[]> {
  const { data, error } = await supabase
    .from("books")
    .select("id,title,author,edition_sha256,storage_path")
    .eq("source", "gutenberg")
    .order("title");
  if (error) throw error;
  return (data ?? []) as CatalogRow[];
}

export async function listRooms(): Promise<RoomRow[]> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id,name,owner_id,books(title,edition_sha256,storage_path)")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as RoomRow[];
}

export async function getRoom(id: string): Promise<RoomRow> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id,name,owner_id,books(title,edition_sha256,storage_path)")
    .eq("id", id)
    .single();
  if (error || !data) throw new Error("Room not found, or you aren't a member.");
  return data as unknown as RoomRow;
}

// Enforces the plan limit in the database (ROOM_LIMIT_REACHED).
export async function createRoom(bookId: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_room", { p_book_id: bookId, p_name: name });
  if (error) throw error;
  return data as string;
}

// Owner-only. Stores a hash of a new random token; the raw token goes in the link.
export async function createInvite(roomId: string): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const { error } = await supabase
    .from("rooms")
    .update({ invite_token_hash: await sha256Text(token) })
    .eq("id", roomId);
  if (error) throw error;
  return token;
}

export async function joinRoom(token: string): Promise<string> {
  const { data, error } = await supabase.rpc("join_room", { p_token: token });
  if (error) throw error;
  return data as string;
}

export async function saveProgress(roomId: string, userId: string, ordinal: number): Promise<void> {
  const { error } = await supabase.from("reading_progress").upsert(
    { room_id: roomId, user_id: userId, current_ordinal: ordinal, high_water: ordinal },
    { onConflict: "room_id,user_id" },
  );
  if (error) throw error;
}

export async function listProgress(roomId: string): Promise<ProgressRow[]> {
  const { data, error } = await supabase
    .from("reading_progress")
    .select("user_id,current_ordinal,high_water,updated_at")
    .eq("room_id", roomId);
  if (error) throw error;
  return (data ?? []) as ProgressRow[];
}

// RLS returns only notes at or before the viewer's high-water mark.
export async function listNotes(roomId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("annotations")
    .select("id,author_id,start_ordinal,start_offset,end_offset,quote_exact,body,created_at")
    .eq("room_id", roomId)
    .order("start_ordinal");
  if (error) throw error;
  return (data ?? []) as NoteRow[];
}

export async function addNote(
  roomId: string,
  userId: string,
  draft: { ord: number; start: number; end: number; quote: string },
  blockText: string,
  body: string,
): Promise<void> {
  // The database only accepts notes on text the author has reached, so record progress first.
  await saveProgress(roomId, userId, draft.ord);
  const { error } = await supabase.from("annotations").insert({
    room_id: roomId,
    author_id: userId,
    start_ordinal: draft.ord,
    end_ordinal: draft.ord,
    start_offset: draft.start,
    end_offset: draft.end,
    quote_exact: draft.quote.slice(0, 500),
    block_hash: await sha256Text(blockText),
    body,
  });
  if (error) throw error;
}

// Friendly text for database errors shown in the UI.
export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String((err as { message: unknown }).message) : "Something went wrong.";
  if (msg.includes("ROOM_LIMIT_REACHED")) return "Your plan allows 2 active rooms. Leave a room to join or create another.";
  if (msg.includes("ROOM_FULL")) return "This room is full.";
  if (msg.includes("INVALID_INVITE")) return "This invite link is no longer valid.";
  if (msg.includes("ANCHOR_AHEAD_OF_PROGRESS")) return "You can only add notes on text you've already read.";
  return msg;
}
