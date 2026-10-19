// Inline SVG icons for the panel, on a 16 px grid in the style of VS Code's codicons. Paths are
// constants here and are set with setAttribute; host data never reaches an SVG.
const NS = "http://www.w3.org/2000/svg";

type Shape = { d: string; fill?: boolean };

const ICONS = {
  send: [{ d: "M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" }],
  stop: [{ d: "M4.5 4.5h7v7h-7z", fill: true }],
  chevron: [{ d: "M4.5 6.25 8 9.75l3.5-3.5" }],
  branch: [{ d: "M5 4.5v7M5 11.5a1.5 1.5 0 1 0 0 .01M5 4.5a1.5 1.5 0 1 0 0-.01M11 6a1.5 1.5 0 1 0 0-.01M11 6c0 2.5-6 2-6 5" }],
  folder: [{ d: "M1.75 4.25v8h12.5v-6.5h-6.5l-1.5-1.5z" }],
  shield: [{ d: "M8 1.75 13 3.5v4c0 3.1-2.1 5.3-5 6.75C5.1 12.8 3 10.6 3 7.5v-4z" }],
  warning: [{ d: "M8 2 14.5 13.5h-13zM8 6.25v3.25M8 11.5v.25" }],
  copy: [{ d: "M5.5 5.5h7v8h-7zM3.5 10.5v-8h7" }],
  plus: [{ d: "M8 3.25v9.5M3.25 8h9.5" }],
  file: [{ d: "M4 1.75h5l3 3v9.5H4zM9 1.75v3h3" }],
  close: [{ d: "M4.5 4.5l7 7M11.5 4.5l-7 7" }],
  pencil: [{ d: "M10.5 2.75l2.75 2.75-7.5 7.5H3v-2.75zM9 4.25l2.75 2.75" }],
  bulb: [{ d: "M6 12.25h4M6.5 14h3M8 2a4 4 0 0 0-2.5 7.1c.6.5 1 1.2 1 1.9h3c0-.7.4-1.4 1-1.9A4 4 0 0 0 8 2z" }],
  check: [{ d: "M3.5 8.25l3 3 6-6.5" }],
  trash: [{ d: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 9h5.5l.75-9M6.75 7v4.5M9.25 7v4.5" }],
  issue: [{ d: "M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5z" }, { d: "M8 7.25a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5z", fill: true }],
  chat: [{ d: "M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" }],
  search: [{ d: "M7 2.75a4.25 4.25 0 1 0 0 8.5 4.25 4.25 0 0 0 0-8.5zM10.1 10.1l3.4 3.4" }],
  terminal: [{ d: "M2 3h12v10H2zM4.5 6.25l2 1.75-2 1.75M8 10h3.5" }],
  globe: [{ d: "M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5zM2.25 8h11.5M8 2.25c1.6 1.6 2.4 3.5 2.4 5.75S9.6 12.15 8 13.75M8 2.25C6.4 3.85 5.6 5.75 5.6 8s.8 4.15 2.4 5.75" }],
  clock: [{ d: "M8 2.25a5.75 5.75 0 1 0 0 11.5 5.75 5.75 0 0 0 0-11.5zM8 5v3.25l2 1.25" }],
  undo: [{ d: "M5.5 3.5 2.75 6.25 5.5 9M3 6.25h6.25a3.75 3.75 0 0 1 0 7.5H7" }],
  tool: [{ d: "M10.5 2.25a3 3 0 0 0-2.9 3.75L2.5 11.1a1.25 1.25 0 0 0 1.75 1.75l5.1-5.1a3 3 0 0 0 3.75-2.9l-1.6 1.6-1.6-.5-.5-1.6z" }],
  /** A processor: the model chip. */
  processor: [{ d: "M4.5 4.5h7v7h-7zM6.5 6.5h3v3h-3zM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14" }],
  /** Fast mode: an outline bolt when off, filled when on. */
  bolt: [{ d: "M9 1.75 3.75 9H8l-1 5.25L12.25 7H8z" }],
  boltOn: [{ d: "M9 1.75 3.75 9H8l-1 5.25L12.25 7H8z", fill: true }],
} satisfies Record<string, Shape[]>;

/** The SVG icons, plus kernl's own mark (an image, see `mark`). */
export type IconName = keyof typeof ICONS | "kernl";

export function icon(name: IconName, size = 16): Element {
  if (name === "kernl") return mark(size);
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of [["viewBox", "0 0 16 16"], ["width", String(size)], ["height", String(size)], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.25"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["class", "icon"]]) {
    svg.setAttribute(k, v);
  }
  for (const shape of ICONS[name] as Shape[]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", shape.d);
    if (shape.fill) path.setAttribute("fill", "currentColor");
    svg.append(path);
  }
  return svg;
}

/**
 * kernl's mark: media/mark.png (made from the logo by scripts/logo-mark.swift), painted in the text
 * color through a CSS mask (panel.css), so it follows the theme like the SVG icons.
 */
function mark(size: number): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "icon kernl-mark";
  span.setAttribute("aria-hidden", "true");
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  return span;
}
