// The agent's thinking, in place in the transcript: "Thinking…" streams open, then collapses to
// "Thought for 12s" and the start of the thought (click to reopen). The kernl.thinkingDisplay setting
// can keep it always collapsed or always open. Built with createElement + textContent only.
import { icon } from "./icons";
import { formatElapsed } from "./toolRow";

export type ThinkingDisplay = "auto" | "collapsed" | "expanded";

export interface ThinkingBlock {
  element: HTMLDetailsElement;
  append(delta: string): void;
  /** The thinking ended (text, a tool call, or the end of the run followed). */
  done(): void;
}

const PREVIEW = 120;

export function createThinking(display: ThinkingDisplay): ThinkingBlock {
  const element = document.createElement("details");
  element.className = "thinking";
  element.dataset.state = "streaming";
  element.open = display !== "collapsed";
  const summary = document.createElement("summary");
  const label = document.createElement("span");
  label.className = "thinking-label";
  label.textContent = "Thinking…";
  const preview = document.createElement("span");
  preview.className = "thinking-preview";
  summary.append(icon("kernl", 13), label, preview, icon("chevron", 12));
  const body = document.createElement("div");
  body.className = "thinking-text";
  element.append(summary, body);
  const started = Date.now();
  let text = "";
  let finished = false;

  return {
    element,
    append(delta) {
      text += delta;
      body.textContent = text;
      preview.textContent = text.replace(/\s+/g, " ").trim().slice(0, PREVIEW);
    },
    done() {
      if (finished) return;
      finished = true;
      element.dataset.state = "done";
      label.textContent = `Thought for ${formatElapsed(Date.now() - started)}`;
      if (display === "auto") element.open = false;
    },
  };
}
