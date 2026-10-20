# CoRead (Phase 1 slice)

Implements the EPUB ingestion path from [ARCHITECTURE.md](../ARCHITECTURE.md), section 4.1, plus a smoke upload page.

## What exists

- `src/lib/epub/zipSafety.ts`: ZIP limits (entry count, uncompressed total, compression ratio), path checks, symlink rejection, mimetype check.
- `src/lib/epub/blocks.ts`: XHTML to block list. Allowlisted block kinds, inline runs keep em/strong/code/link, whitespace collapsed, NFC normalized. Offsets index into `text`.
- `src/lib/epub/parse.ts`: container, OPF, spine walk, global ordinals, per-block SHA-256, edition hash, DRM detection.
- `src/app/api/books/route.ts`: upload endpoint with 10 MB Free cap and error codes.
- `src/app/page.tsx`: upload smoke page.

## Not yet built

- Supabase wiring (auth, storage, writes to `books` / `book_blocks`). Schema is in [schema.sql](../schema.sql).
- Reader UI (virtualized blocks, selection to offset, highlights).
- Rooms, progress, annotations, billing.

## Run

```bash
npm install
npm test
npm run dev
```

Status: written without being run. Install, typecheck, and test before relying on it.
