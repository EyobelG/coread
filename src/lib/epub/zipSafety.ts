import JSZip from "jszip";

export const LIMITS = {
  maxEntries: 5000,
  maxTotalUncompressed: 200 * 1024 * 1024,
  maxRatio: 100,
} as const;

export class EpubError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "EpubError";
  }
}

// Rejects absolute paths, traversal, and backslash separators.
export function checkEntryName(name: string): void {
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name) || name.includes("\\")) {
    throw new EpubError("UNSAFE_PATH", `absolute or invalid path: ${name}`);
  }
  if (name.split("/").some((part) => part === "..")) {
    throw new EpubError("UNSAFE_PATH", `path traversal: ${name}`);
  }
}

const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

// Opens an EPUB ZIP after structural checks. Limits are checked before
// decompressing, using the sizes recorded in the ZIP central directory.
export async function openEpubZip(data: ArrayBuffer | Uint8Array): Promise<JSZip> {
  const zip = await JSZip.loadAsync(data);
  const entries = Object.values(zip.files);

  if (entries.length > LIMITS.maxEntries) {
    throw new EpubError("TOO_MANY_ENTRIES", `${entries.length} entries`);
  }

  let total = 0;
  for (const entry of entries) {
    checkEntryName(entry.name);
    if (entry.dir) continue;

    const unix = entry.unixPermissions;
    if (typeof unix === "number" && (unix & S_IFMT) === S_IFLNK) {
      throw new EpubError("SYMLINK", `symlink not allowed: ${entry.name}`);
    }

    // JSZip keeps size metadata on an internal field; it is not in the public typings.
    const meta = (entry as unknown as { _data?: { compressedSize?: number; uncompressedSize?: number } })._data;
    const compressed = meta?.compressedSize ?? 0;
    const uncompressed = meta?.uncompressedSize ?? 0;
    if (compressed > 0 && uncompressed / compressed > LIMITS.maxRatio) {
      throw new EpubError("ZIP_BOMB", `compression ratio too high: ${entry.name}`);
    }
    total += uncompressed;
    if (total > LIMITS.maxTotalUncompressed) {
      throw new EpubError("TOO_LARGE_UNCOMPRESSED", "uncompressed total over limit");
    }
  }

  const mimetype = zip.file("mimetype");
  if (!mimetype || (await mimetype.async("string")).trim() !== "application/epub+zip") {
    throw new EpubError("NOT_EPUB", "missing or invalid mimetype entry");
  }

  return zip;
}
