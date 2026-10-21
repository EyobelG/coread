# CoRead — Shared Multiplayer Reading Rooms

A browser-based reading platform where small groups read the same book together. Live: https://coread-beta.vercel.app

## What exists

- **EPUB ingestion** (`src/lib/epub/`): `zipSafety.ts` enforces ZIP limits (entry count, uncompressed total, compression ratio), path checks, symlink rejection, mimetype check. `blocks.ts` converts XHTML into an allowlisted block list with NFC-normalized text and stable character offsets. `parse.ts` walks the container/OPF/spine, assigns global ordinals, hashes each block (SHA-256) and the edition, and detects DRM.
- **Upload path**: `src/app/api/books/route.ts` (10 MB Free cap, typed error codes) and `src/app/page.tsx` (upload UI), plus a free-classics catalog (`src/lib/catalog.ts`) seeded from public-domain Gutenberg editions.
- **Auth**: `src/components/AccountBar.tsx` — Supabase email magic-link sign-in (`signInWithOtp`), session state, sign-out.
- **Reading rooms** (`src/lib/rooms.ts`, `src/app/rooms/`, `src/app/room/`, `src/app/join/`): create/list/join rooms via Supabase RPC (`create_room`, `join_room`), invite links (random token, only its SHA-256 hash stored), shared reading progress (`reading_progress`, high-water mark per user), and annotations gated to what the reader has actually reached (`ANCHOR_AHEAD_OF_PROGRESS`). Plan limits (`ROOM_LIMIT_REACHED`, `ROOM_FULL`) are enforced server-side via the RPC functions, not just in the UI.
- **Reader UI**: `src/components/Reader.tsx`, `src/app/read/page.tsx`.
- Access control is enforced by Postgres row-level security (RLS) on `rooms` / `reading_progress` / `annotations` — client calls always run as the signed-in user; the database decides what they can see.

## Not yet built

- Billing (plan upgrade flow beyond the `ROOM_LIMIT_REACHED` prompt).
- `schema.sql` (RLS policies, RPC functions) lives in a separate, unpublished setup repo — this repo is the application code only.

## Run

```bash
npm install
npm test
npm run dev
```

## Tests

`npm test` runs the Vitest suite covering EPUB parsing, block extraction, link resolution, and catalog loading (`src/lib/epub/*.test.ts`).
