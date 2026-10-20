import type { CSSProperties } from "react";

// Reader link and cursor colors. Edit DEFAULT_THEME or let users change them in the reader.
export interface LinkTheme {
  link: string; // link text
  hover: string; // link text on hover
  cursorFill: string; // hand cursor body
  cursorStroke: string; // hand cursor outline
}

export const DEFAULT_THEME: LinkTheme = {
  link: "#2563eb",
  hover: "#c026d3",
  cursorFill: "#fde68a",
  cursorStroke: "#1f2937",
};

// Pointing-hand cursor as an SVG data URI. The hotspot sits on the fingertip.
export function handCursor(fill: string, stroke: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<path d="M12 4.5a2 2 0 0 1 4 0V14l1 .2V8.5a2 2 0 0 1 4 0V15l.8.3V10.5a2 2 0 0 1 4 0V19c0 5-3 9-8 9h-2c-3.5 0-5.5-2-7-4.5L5.5 18a2 2 0 0 1 3-2.5L12 19z" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 3, pointer`;
}

// CSS custom properties consumed by .cr-link in globals.css.
export function themeStyle(t: LinkTheme): CSSProperties {
  return {
    "--cr-link": t.link,
    "--cr-link-hover": t.hover,
    "--cr-cursor": handCursor(t.cursorFill, t.cursorStroke),
  } as CSSProperties;
}
