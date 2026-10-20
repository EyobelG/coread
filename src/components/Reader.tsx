"use client";

import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Run } from "@/lib/epub/blocks";
import { DEFAULT_THEME, themeStyle, type LinkTheme } from "@/lib/theme";

export interface ReaderBlock {
  key: string;
  globalOrdinal: number;
  kind: "p" | "h" | "li" | "blockquote" | "pre";
  level?: number;
  runs: Run[];
  text: string;
}

export interface TocItem {
  label: string;
  depth: number;
  ordinal: number | null;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export interface HighlightStyle {
  color: HighlightColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface Highlight extends HighlightStyle {
  id: string;
  ord: number; // block globalOrdinal
  start: number; // offset into block.text
  end: number;
  quote: string;
}

type ReaderTheme = "light" | "sepia" | "dark";
type FontChoice = "serif" | "sans" | "dyslexic";
type Spacing = "normal" | "relaxed";

interface Display {
  theme: ReaderTheme;
  fontPx: number;
  font: FontChoice;
  spacing: Spacing;
  rate: number; // read-aloud speed
}

const FONT_STACK: Record<FontChoice, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  // Lexend is loaded in app/layout.tsx; designed to reduce visual crowding for dyslexic readers.
  dyslexic: "'Lexend', system-ui, sans-serif",
};

// A note shared in a reading room. Only notes the viewer has reached are passed in.
export interface RoomNote {
  id: string;
  author: string; // display label
  ord: number; // block globalOrdinal
  start: number; // offset into block.text
  quote: string;
  body: string;
  own: boolean;
}

// Optional room integration. Omit for solo reading.
export interface RoomHooks {
  notes: RoomNote[];
  onPosition: (ordinal: number) => void; // top visible paragraph
  onNote: (draft: { ord: number; start: number; end: number; quote: string }, body: string) => Promise<void>;
}

interface Props {
  edition: string;
  title: string;
  blocks: ReaderBlock[];
  toc: TocItem[];
  room?: RoomHooks;
}

// First paragraph whose bottom edge is on screen.
function firstVisibleOrdinal(): number | null {
  for (const el of document.querySelectorAll<HTMLElement>("[data-ord]")) {
    if (el.getBoundingClientRect().bottom > 0) return Number(el.dataset.ord);
  }
  return null;
}

const HL_COLORS: Record<HighlightColor, { label: string; swatch: string; mark: string }> = {
  yellow: { label: "Yellow", swatch: "bg-amber-300", mark: "bg-amber-200" },
  green: { label: "Green", swatch: "bg-emerald-300", mark: "bg-emerald-200" },
  blue: { label: "Blue", swatch: "bg-sky-300", mark: "bg-sky-200" },
  pink: { label: "Pink", swatch: "bg-pink-300", mark: "bg-pink-200" },
};
const COLOR_KEYS = Object.keys(HL_COLORS) as HighlightColor[];

const THEMES: { key: ReaderTheme; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "sepia", label: "Sepia" },
  { key: "dark", label: "Dark" },
];

const DEFAULT_DISPLAY: Display = { theme: "light", fontPx: 20, font: "serif", spacing: "normal", rate: 1 };
const FONT_MIN = 14;
const FONT_MAX = 28;
const RATE_MIN = 0.6;
const RATE_MAX = 1.6;

const highlightKey = (edition: string) => `coread:highlights:${edition}`;
const THEME_KEY = "coread:theme";
const DISPLAY_KEY = "coread:display";

// Per-viewer convenience only. Shared state goes through the database later.
function readStored(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): state stays in memory for this view.
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Older saved highlights lack id, color, and style flags. Fill them in.
function loadHighlights(edition: string): Highlight[] {
  const raw = readStored(highlightKey(edition));
  if (!Array.isArray(raw)) return [];
  return (raw as Partial<Highlight>[]).map((h) => ({
    id: h.id ?? newId(),
    ord: Number(h.ord),
    start: Number(h.start),
    end: Number(h.end),
    quote: String(h.quote ?? ""),
    color: COLOR_KEYS.includes(h.color as HighlightColor) ? (h.color as HighlightColor) : "yellow",
    bold: !!h.bold,
    italic: !!h.italic,
    underline: !!h.underline,
  }));
}

function loadTheme(): LinkTheme {
  const raw = readStored(THEME_KEY) as Partial<LinkTheme> | null;
  return raw ? { ...DEFAULT_THEME, ...raw } : DEFAULT_THEME;
}

function loadDisplay(): Display {
  const raw = readStored(DISPLAY_KEY) as Partial<Display> | null;
  if (!raw) return DEFAULT_DISPLAY;
  const theme = THEMES.some((t) => t.key === raw.theme) ? (raw.theme as ReaderTheme) : DEFAULT_DISPLAY.theme;
  const fontPx = Math.min(FONT_MAX, Math.max(FONT_MIN, Number(raw.fontPx) || DEFAULT_DISPLAY.fontPx));
  const font = raw.font && raw.font in FONT_STACK ? raw.font : DEFAULT_DISPLAY.font;
  const spacing: Spacing = raw.spacing === "relaxed" ? "relaxed" : "normal";
  const rate = Math.min(RATE_MAX, Math.max(RATE_MIN, Number(raw.rate) || DEFAULT_DISPLAY.rate));
  return { theme, fontPx, font, spacing, rate };
}

// Highlight covering this offset. If several overlap, the most recent one wins.
function hlAt(mine: Highlight[], abs: number): Highlight | undefined {
  let found: Highlight | undefined;
  for (const h of mine) if (abs >= h.start && abs < h.end) found = h;
  return found;
}

interface Seg {
  text: string;
  run: Run;
  hl?: Highlight;
}

// Split a block into styled segments, grouping characters by run and highlight.
// Offsets index into block.text, which equals the runs concatenated.
function segments(block: ReaderBlock, highlights: Highlight[]): Seg[] {
  const mine = highlights.filter((h) => h.ord === block.globalOrdinal);
  const segs: Seg[] = [];
  let pos = 0;
  for (const run of block.runs) {
    let i = 0;
    while (i < run.t.length) {
      const hl = hlAt(mine, pos + i);
      let j = i + 1;
      while (j < run.t.length && hlAt(mine, pos + j)?.id === hl?.id) j++;
      segs.push({ text: run.t.slice(i, j), run, hl });
      i = j;
    }
    pos += run.t.length;
  }
  return segs;
}

// Scroll to a block and flash it briefly.
function jumpTo(ordinal: number): void {
  const el = document.querySelector<HTMLElement>(`[data-ord="${ordinal}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.remove("cr-flash");
  // Force reflow so the animation restarts on repeat jumps.
  void el.offsetWidth;
  el.classList.add("cr-flash");
}

function SegView({
  seg,
  onJump,
  onHighlight,
}: {
  seg: Seg;
  onJump: (ordinal: number) => void;
  onHighlight: (id: string) => void;
}) {
  const { run } = seg;
  let node: ReactNode = seg.text;
  if (run.code) node = <code className="rounded bg-[var(--r-border)] px-1 text-[0.9em]">{node}</code>;
  if (run.em) node = <em>{node}</em>;
  if (run.strong) node = <strong>{node}</strong>;

  if (run.target !== undefined) {
    // Chapter or in-book link: jump inside the reader instead of navigating away.
    const target = run.target;
    node = (
      <a
        href={`#ord-${target}`}
        className="cr-link"
        onClick={(e) => {
          e.preventDefault();
          onJump(target);
        }}
      >
        {node}
      </a>
    );
  } else if (run.href) {
    const external = /^https?:\/\//.test(run.href);
    node = external ? (
      <a href={run.href} target="_blank" rel="noopener noreferrer" className="cr-link">
        {node}
      </a>
    ) : (
      <span className="underline decoration-[var(--r-muted)]">{node}</span>
    );
  }

  if (seg.hl) {
    const h = seg.hl;
    const cls = [
      HL_COLORS[h.color].mark,
      "rounded-sm px-0.5 text-stone-900 cursor-pointer",
      h.bold ? "font-bold" : "",
      h.italic ? "italic" : "",
      h.underline ? "underline decoration-2 underline-offset-2" : "",
    ].join(" ");
    node = (
      <mark
        data-hl={h.id}
        title="Edit highlight"
        onClick={(e) => {
          e.stopPropagation();
          onHighlight(h.id);
        }}
        className={cls}
      >
        {node}
      </mark>
    );
  }
  return <>{node}</>;
}

const blockClass: Record<ReaderBlock["kind"], string> = {
  p: "my-4",
  h: "mt-10 mb-4 font-semibold",
  li: "ml-6 my-2 list-disc",
  blockquote: "my-4 border-l-4 border-[var(--r-border)] pl-4 italic opacity-85",
  pre: "my-4 overflow-x-auto whitespace-pre rounded bg-[var(--r-border)]/40 p-3 text-[0.85em]",
};

function headingTag(block: ReaderBlock): string {
  if (block.kind === "h") return `h${Math.min(Math.max(block.level ?? 2, 1), 6)}`;
  if (block.kind === "li") return "li";
  if (block.kind === "blockquote") return "blockquote";
  if (block.kind === "pre") return "pre";
  return "p";
}

interface Draft {
  ord: number;
  start: number;
  end: number;
  quote: string;
}

// Nearest enclosing block element for a DOM node.
function blockElement(node: Node | null): HTMLElement | null {
  const el = node instanceof Element ? node : node?.parentElement ?? null;
  return (el?.closest("[data-ord]") as HTMLElement | null) ?? null;
}

const COLOR_FIELDS: { key: keyof LinkTheme; label: string }[] = [
  { key: "link", label: "Link text" },
  { key: "hover", label: "Link hover" },
  { key: "cursorFill", label: "Hand fill" },
  { key: "cursorStroke", label: "Hand outline" },
];

function StyleControls({
  style,
  onChange,
}: {
  style: HighlightStyle;
  onChange: (patch: Partial<HighlightStyle>) => void;
}) {
  const toggle = "flex h-9 w-9 items-center justify-center rounded border border-[var(--r-border)] text-sm";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {COLOR_KEYS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`${HL_COLORS[c].label} highlight`}
          aria-pressed={style.color === c}
          onClick={() => onChange({ color: c })}
          className={`h-9 w-9 rounded-full border-2 ${HL_COLORS[c].swatch} ${
            style.color === c ? "border-[var(--r-fg)]" : "border-transparent"
          }`}
        />
      ))}
      <span className="mx-1 h-6 w-px bg-[var(--r-border)]" />
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={!!style.bold}
        onClick={() => onChange({ bold: !style.bold })}
        className={`${toggle} font-bold ${style.bold ? "bg-[var(--r-fg)] text-[var(--r-bg)]" : ""}`}
      >
        B
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={!!style.italic}
        onClick={() => onChange({ italic: !style.italic })}
        className={`${toggle} italic ${style.italic ? "bg-[var(--r-fg)] text-[var(--r-bg)]" : ""}`}
      >
        I
      </button>
      <button
        type="button"
        aria-label="Underline"
        aria-pressed={!!style.underline}
        onClick={() => onChange({ underline: !style.underline })}
        className={`${toggle} underline ${style.underline ? "bg-[var(--r-fg)] text-[var(--r-bg)]" : ""}`}
      >
        U
      </button>
    </div>
  );
}

export default function Reader({ edition, title, blocks, toc, room }: Props) {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [newStyle, setNewStyle] = useState<HighlightStyle>({ color: "yellow" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [theme, setTheme] = useState<LinkTheme>(DEFAULT_THEME);
  const [display, setDisplay] = useState<Display>(DEFAULT_DISPLAY);
  const [progress, setProgress] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);

  // Room notes: composing a note, and the notes list sheet.
  const [composing, setComposing] = useState(false);
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  // Refs read inside long-lived listeners, so they always see the latest value.
  const composingRef = useRef(false);
  composingRef.current = composing;
  const roomRef = useRef(room);
  roomRef.current = room;
  // Undo/redo history of highlight lists. Refs: changing history must not re-render.
  const past = useRef<Highlight[][]>([]);
  const future = useRef<Highlight[][]>([]);

  // Read aloud: one block at a time via the Web Speech API.
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);
  const displayRef = useRef(display);
  displayRef.current = display;

  function markSpeaking(ord: number | null) {
    document.querySelectorAll(".cr-speaking").forEach((el) => el.classList.remove("cr-speaking"));
    if (ord === null) return;
    document.querySelector(`[data-ord="${ord}"]`)?.classList.add("cr-speaking");
  }

  function speakFrom(index: number) {
    if (!speakingRef.current) return;
    if (index >= blocks.length) {
      stopSpeaking();
      return;
    }
    const block = blocks[index];
    markSpeaking(block.globalOrdinal);
    const u = new SpeechSynthesisUtterance(block.text);
    u.rate = displayRef.current.rate;
    u.onend = () => speakFrom(index + 1);
    u.onerror = () => stopSpeaking();
    window.speechSynthesis.speak(u);
  }

  // Start at the first paragraph whose bottom edge is on screen.
  function startSpeaking() {
    if (!("speechSynthesis" in window)) {
      setHint("Read aloud is not supported in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const visible = blocks.find((b) => {
      const el = document.querySelector(`[data-ord="${b.globalOrdinal}"]`);
      return el && el.getBoundingClientRect().bottom > 0;
    });
    const startIndex = visible ? blocks.indexOf(visible) : 0;
    speakingRef.current = true;
    setSpeaking(true);
    speakFrom(startIndex);
  }

  function stopSpeaking() {
    speakingRef.current = false;
    setSpeaking(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    markSpeaking(null);
  }

  // Stop speech when leaving the page.
  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    setHighlights(loadHighlights(edition));
    setTheme(loadTheme());
    setDisplay(loadDisplay());
  }, [edition]);

  // Reading progress from scroll position.
  useEffect(() => {
    function onScroll() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      const top = firstVisibleOrdinal();
      if (top !== null) roomRef.current?.onPosition(top);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Map the DOM selection to (block ordinal, character offset). Offsets are measured
  // against the block's text, so they do not depend on window width or font size.
  useEffect(() => {
    function onSelectionChange() {
      // Typing in the note box moves the selection; keep the draft while composing.
      if (composingRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setDraft(null);
        setHint(null);
        return;
      }
      const a = blockElement(sel.anchorNode);
      const f = blockElement(sel.focusNode);
      if (!a || !f || a !== f) {
        setDraft(null);
        setHint("Select text within one paragraph to highlight.");
        return;
      }
      const range = sel.getRangeAt(0);
      const pre = document.createRange();
      pre.selectNodeContents(a);
      pre.setEnd(range.startContainer, range.startOffset);
      const start = pre.toString().length;
      const quote = range.toString();
      if (!quote.trim()) {
        setDraft(null);
        setHint(null);
        return;
      }
      setHint(null);
      setActiveId(null);
      setDraft({ ord: Number(a.dataset.ord), start, end: start + quote.length, quote });
    }
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const HISTORY_LIMIT = 100;

  // Every highlight change goes through here so it can be undone.
  function commitHighlights(next: Highlight[]) {
    past.current.push(highlights);
    if (past.current.length > HISTORY_LIMIT) past.current.shift();
    future.current = [];
    setHighlights(next);
    writeStored(highlightKey(edition), next);
  }

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(highlights);
    setHighlights(prev);
    setActiveId(null);
    writeStored(highlightKey(edition), prev);
  }

  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(highlights);
    setHighlights(next);
    setActiveId(null);
    writeStored(highlightKey(edition), next);
  }

  // Cmd/Ctrl+Z to undo; Cmd/Ctrl+Y or Cmd/Ctrl+Shift+Z to redo.
  // Skipped while a form control has focus so sliders and color pickers keep their own keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [highlights]);

  async function sendNote() {
    if (!draft || !room || !noteBody.trim()) return;
    setNoteBusy(true);
    try {
      await room.onNote(draft, noteBody.trim());
      setNoteBody("");
      setComposing(false);
      setDraft(null);
      window.getSelection()?.removeAllRanges();
    } catch (err) {
      setHint(err instanceof Error ? err.message : "Couldn't save the note. Try again.");
    } finally {
      setNoteBusy(false);
    }
  }

  function cancelNote() {
    setComposing(false);
    setNoteBody("");
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  }

  function addHighlight() {
    if (!draft) return;
    commitHighlights([...highlights, { ...draft, ...newStyle, id: newId() }]);
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  }

  function updateHighlight(id: string, patch: Partial<HighlightStyle>) {
    commitHighlights(highlights.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  }

  function removeHighlight(id: string) {
    commitHighlights(highlights.filter((h) => h.id !== id));
    setActiveId(null);
  }

  function clearHighlights() {
    commitHighlights([]);
    setActiveId(null);
  }

  function updateColor(key: keyof LinkTheme, value: string) {
    const next = { ...theme, [key]: value };
    setTheme(next);
    writeStored(THEME_KEY, next);
  }

  function resetColors() {
    setTheme(DEFAULT_THEME);
    writeStored(THEME_KEY, DEFAULT_THEME);
  }

  function updateDisplay(patch: Partial<Display>) {
    const next = { ...display, ...patch };
    setDisplay(next);
    writeStored(DISPLAY_KEY, next);
  }

  const active = highlights.find((h) => h.id === activeId) ?? null;
  const mode: "create" | "edit" | "idle" = draft ? "create" : active ? "edit" : "idle";
  const pct = Math.round(progress * 100);

  const rootStyle = {
    ...themeStyle(theme),
    fontSize: `${display.fontPx}px`,
    fontFamily: FONT_STACK[display.font],
    lineHeight: display.spacing === "relaxed" ? 1.9 : 1.6,
    letterSpacing: display.spacing === "relaxed" ? "0.02em" : "normal",
  } as CSSProperties;

  return (
    <div
      style={rootStyle}
      className={`reader-${display.theme} min-h-screen bg-[var(--r-bg)] text-[var(--r-fg)]`}
    >
      {/* Reading progress */}
      <div className="fixed inset-x-0 top-0 z-30 h-1 bg-[var(--r-border)]">
        <div className="h-full bg-[var(--cr-link)] transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>

      <div className="mx-auto max-w-prose px-5 pb-40 pt-8">
        <header className="mb-8 border-b border-[var(--r-border)] pb-5">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--r-muted)]">Reading</p>
          <h1 className="mt-1 text-[1.35em] font-semibold leading-tight">{title}</h1>
          <p className="mt-2 text-sm text-[var(--r-muted)]">
            {pct}% · {highlights.length} highlight{highlights.length === 1 ? "" : "s"}
          </p>
        </header>

        <article>
          {blocks.map((block) =>
            createElement(
              headingTag(block),
              {
                key: block.key,
                id: `ord-${block.globalOrdinal}`,
                "data-ord": block.globalOrdinal,
                className: blockClass[block.kind],
              },
              segments(block, highlights).map((seg, i) => (
                <SegView key={i} seg={seg} onJump={jumpTo} onHighlight={setActiveId} />
              )),
            ),
          )}
        </article>
      </div>

      {tocOpen && (
        <div className="fixed inset-0 z-20 bg-black/40" onClick={() => setTocOpen(false)}>
          <nav
            aria-label="Contents"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-[var(--r-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Contents</h2>
              <button type="button" onClick={() => setTocOpen(false)} className="min-h-11 px-3 text-[var(--r-muted)]">
                Close
              </button>
            </div>
            {toc.length === 0 && <p className="text-sm text-[var(--r-muted)]">This book has no table of contents.</p>}
            <ul className="text-base">
              {toc.map((item, i) => (
                <li key={i} style={{ paddingLeft: `${Math.max(0, item.depth) * 16}px` }}>
                  {item.ordinal !== null ? (
                    <button
                      type="button"
                      className="cr-link min-h-11 py-2 text-left"
                      onClick={() => {
                        setTocOpen(false);
                        jumpTo(item.ordinal as number);
                      }}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span className="block min-h-11 py-2 text-[var(--r-muted)]">{item.label}</span>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}

      {notesOpen && room && (
        <div className="fixed inset-0 z-20 bg-black/40" onClick={() => setNotesOpen(false)}>
          <div
            role="dialog"
            aria-label="Room notes"
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-[var(--r-surface)] p-5 shadow-2xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">Room notes</h2>
              <button type="button" onClick={() => setNotesOpen(false)} className="min-h-11 px-3 text-[var(--r-muted)]">
                Close
              </button>
            </div>
            {room.notes.length === 0 && (
              <p className="text-sm text-[var(--r-muted)]">
                No notes yet. Notes appear here once the reader reaches them.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {room.notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setNotesOpen(false);
                      jumpTo(n.ord);
                    }}
                    className="block w-full rounded-lg border border-[var(--r-border)] p-3 text-left"
                  >
                    <span className="block text-xs text-[var(--r-muted)]">{n.author}</span>
                    <span className="mt-1 block text-sm italic text-[var(--r-muted)]">“{n.quote.slice(0, 120)}”</span>
                    <span className="mt-1 block">{n.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {displayOpen && (
        <div className="fixed bottom-24 right-4 z-20 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-[var(--r-surface)] p-5 text-sm shadow-2xl ring-1 ring-[var(--r-border)]">
          <h2 className="mb-4 font-semibold">Display</h2>

          <p className="mb-2 text-[var(--r-muted)]">Theme</p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={display.theme === t.key}
                onClick={() => updateDisplay({ theme: t.key })}
                className={`min-h-11 rounded-lg border text-sm ${
                  display.theme === t.key ? "border-[var(--cr-link)] ring-2 ring-[var(--cr-link)]" : "border-[var(--r-border)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <label className="mb-4 block">
            <span className="mb-2 flex justify-between text-[var(--r-muted)]">
              Text size <span>{display.fontPx}px</span>
            </span>
            <input
              type="range"
              min={FONT_MIN}
              max={FONT_MAX}
              step={1}
              value={display.fontPx}
              onChange={(e) => updateDisplay({ fontPx: Number(e.target.value) })}
              className="w-full accent-[var(--cr-link)]"
            />
          </label>

          <p className="mb-2 text-[var(--r-muted)]">Font</p>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {(
              [
                { key: "serif", label: "Serif" },
                { key: "sans", label: "Sans" },
                { key: "dyslexic", label: "Dyslexia" },
              ] as { key: FontChoice; label: string }[]
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={display.font === f.key}
                onClick={() => updateDisplay({ font: f.key })}
                style={{ fontFamily: FONT_STACK[f.key] }}
                className={`min-h-11 rounded-lg border text-sm ${
                  display.font === f.key ? "border-[var(--cr-link)] ring-2 ring-[var(--cr-link)]" : "border-[var(--r-border)]"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-[var(--r-muted)]">Relaxed spacing</span>
            <button
              type="button"
              role="switch"
              aria-checked={display.spacing === "relaxed"}
              onClick={() => updateDisplay({ spacing: display.spacing === "relaxed" ? "normal" : "relaxed" })}
              className={`relative h-7 w-12 rounded-full transition-colors ${
                display.spacing === "relaxed" ? "bg-[var(--cr-link)]" : "bg-[var(--r-border)]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${
                  display.spacing === "relaxed" ? "left-5" : "left-0.5"
                }`}
              />
            </button>
          </div>

          <label className="mb-4 block">
            <span className="mb-2 flex justify-between text-[var(--r-muted)]">
              Read-aloud speed <span>{display.rate.toFixed(1)}×</span>
            </span>
            <input
              type="range"
              min={RATE_MIN}
              max={RATE_MAX}
              step={0.1}
              value={display.rate}
              onChange={(e) => updateDisplay({ rate: Number(e.target.value) })}
              className="w-full accent-[var(--cr-link)]"
            />
          </label>

          <p className="mb-2 text-[var(--r-muted)]">Link colors</p>
          <div className="flex flex-col gap-2">
            {COLOR_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center justify-between gap-3">
                <span>{f.label}</span>
                <input
                  type="color"
                  value={theme[f.key]}
                  onChange={(e) => updateColor(f.key, e.target.value)}
                  className="h-8 w-12 cursor-pointer rounded border border-[var(--r-border)]"
                />
              </label>
            ))}
          </div>
          <div className="mt-4 flex justify-between">
            <button type="button" onClick={resetColors} className="min-h-11 px-2 text-[var(--r-muted)]">
              Reset colors
            </button>
            <button type="button" onClick={() => setDisplayOpen(false)} className="min-h-11 px-2 font-medium">
              Done
            </button>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-[var(--r-border)] bg-[var(--r-surface)]/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-prose flex-col gap-2">
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-[var(--r-muted)]">
              {mode === "create" && draft
                ? `“${draft.quote.slice(0, 60)}${draft.quote.length > 60 ? "…" : ""}”`
                : mode === "edit"
                  ? "Editing highlight"
                  : hint ?? `${pct}% read`}
            </span>
            {mode === "idle" && (
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setTocOpen(true)}
                  className="min-h-11 rounded-lg border border-[var(--r-border)] px-3"
                >
                  Contents
                </button>
                <button
                  type="button"
                  onClick={speaking ? stopSpeaking : startSpeaking}
                  aria-pressed={speaking}
                  className={`min-h-11 rounded-lg border px-3 ${
                    speaking ? "border-[var(--cr-link)] text-[var(--cr-link)]" : "border-[var(--r-border)]"
                  }`}
                >
                  {speaking ? "Stop" : "Listen"}
                </button>
                <button
                  type="button"
                  onClick={() => setDisplayOpen((v) => !v)}
                  aria-label="Display settings"
                  className="min-h-11 rounded-lg border border-[var(--r-border)] px-3 font-serif"
                >
                  Aa
                </button>
                {room && (
                  <button
                    type="button"
                    onClick={() => setNotesOpen(true)}
                    className="min-h-11 rounded-lg border border-[var(--r-border)] px-3"
                  >
                    Notes {room.notes.length > 0 ? `(${room.notes.length})` : ""}
                  </button>
                )}
                {highlights.length > 0 && (
                  <button
                    type="button"
                    onClick={clearHighlights}
                    className="min-h-11 rounded-lg border border-[var(--r-border)] px-3 text-[var(--r-muted)]"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>

          {mode === "create" && composing && room && (
            <div className="flex items-center gap-2">
              <textarea
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                maxLength={5000}
                rows={2}
                placeholder="Write a note for your room…"
                aria-label="Note text"
                className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--r-border)] bg-transparent p-2 text-sm"
              />
              <button
                type="button"
                onClick={sendNote}
                disabled={noteBusy || !noteBody.trim()}
                className="min-h-11 shrink-0 rounded-lg bg-[var(--cr-link)] px-4 font-medium text-white disabled:opacity-40"
              >
                {noteBusy ? "Saving…" : "Share"}
              </button>
              <button
                type="button"
                onClick={cancelNote}
                className="min-h-11 shrink-0 px-2 text-[var(--r-muted)]"
              >
                Cancel
              </button>
            </div>
          )}

          {mode === "create" && !composing && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StyleControls style={newStyle} onChange={(p) => setNewStyle({ ...newStyle, ...p })} />
              <div className="flex gap-2">
                {room && (
                  <button
                    type="button"
                    onClick={() => setComposing(true)}
                    className="min-h-11 rounded-lg border border-[var(--r-border)] px-4"
                  >
                    Note
                  </button>
                )}
              <button
                type="button"
                onClick={addHighlight}
                className="min-h-11 rounded-lg bg-[var(--cr-link)] px-5 font-medium text-white"
              >
                Highlight
              </button>
              </div>
            </div>
          )}

          {mode === "edit" && active && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <StyleControls style={active} onChange={(p) => updateHighlight(active.id, p)} />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => removeHighlight(active.id)}
                  className="min-h-11 rounded-lg border border-red-300 px-4 text-red-600"
                >
                  Remove
                </button>
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="min-h-11 rounded-lg bg-[var(--r-fg)] px-4 font-medium text-[var(--r-bg)]"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
