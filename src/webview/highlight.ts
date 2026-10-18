// Syntax highlighting for code blocks. lowlight (highlight.js grammars) returns a tree of plain
// objects; we build spans from it with createElement/textContent, so code is never parsed as HTML.
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";

const lowlight = createLowlight({ bash, c, cpp, csharp, css, diff, dockerfile, go, java, javascript, json, kotlin, markdown, php, python, ruby, rust, sql, swift, typescript, xml, yaml });
lowlight.registerAlias({
  bash: ["sh", "shell", "zsh", "console"],
  cpp: ["c++", "hpp", "cc"],
  csharp: ["cs", "c#"],
  dockerfile: ["docker"],
  javascript: ["js", "jsx", "mjs", "cjs"],
  kotlin: ["kt"],
  markdown: ["md"],
  python: ["py"],
  ruby: ["rb"],
  rust: ["rs"],
  typescript: ["ts", "tsx", "mts", "cts"],
  xml: ["html", "svg", "vue"],
  yaml: ["yml"],
});

// Grammar class names are constants from highlight.js; anything else is dropped rather than trusted.
const HLJS_CLASS = /^(hljs-[a-z_-]+|[a-z]+_)$/;

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: string[] };
  children?: HastNode[];
}

function append(parent: Node, nodes: HastNode[]) {
  for (const n of nodes) {
    if (n.type === "text") parent.appendChild(document.createTextNode(n.value ?? ""));
    else if (n.type === "element") {
      const span = document.createElement("span");
      const classes = (n.properties?.className ?? []).filter((c) => HLJS_CLASS.test(c));
      if (classes.length) span.className = classes.join(" ");
      append(span, n.children ?? []);
      parent.appendChild(span);
    }
  }
}

/** Fills `code` with highlighted spans when the language is known, plain text otherwise. */
export function highlightInto(code: HTMLElement, lang: string | undefined, text: string) {
  const name = lang?.trim().toLowerCase();
  if (!name || !lowlight.registered(name)) {
    code.textContent = text;
    return;
  }
  append(code, lowlight.highlight(name, text).children as HastNode[]);
  code.classList.add("hljs");
}
