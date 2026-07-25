import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));

if (!/\.incident-table colgroup\s*\{\s*display:\s*none/.test(mobile)) {
  throw new Error("mobile incident cards must ignore desktop column widths");
}

if (!/\.field-change-list\s*\{[^}]*overflow-wrap:\s*anywhere/s.test(css)) {
  throw new Error("comparison field evidence must wrap instead of widening the page");
}
