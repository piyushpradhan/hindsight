/**
 * Tool registry. Each tool is keyed by name, flagged safe vs side-effectful
 * (send/write/pay = side_effectful), and produces deterministic output so demos
 * and forks are reproducible. The fork executor consumes this registry to
 * decide which tools it may actually re-run vs. which must be answered from
 * recordings (side-effectful tools are never re-run under a strict mock policy).
 */
import type { ToolDef, ToolRegistry } from "./types.js";

/** web_search: safe, read-only. Deterministic fake results keyed on query. */
const webSearch: ToolDef = {
  name: "web_search",
  description: "Search the web for a query; returns titled result snippets.",
  effect: "safe",
  async run(args) {
    const query = String(args.query ?? "");
    const n = 3;
    return {
      query,
      results: Array.from({ length: n }, (_, i) => ({
        title: `Result ${i + 1} for "${query}"`,
        url: `https://example.com/${encodeURIComponent(query)}/${i + 1}`,
        snippet: `Deterministic snippet ${i + 1} about ${query}.`,
      })),
    };
  },
};

/** calculator: safe, pure arithmetic over a whitelisted expression. */
const calculator: ToolDef = {
  name: "calculator",
  description: "Evaluate a simple arithmetic expression (+ - * / and parens).",
  effect: "safe",
  async run(args) {
    const expr = String(args.expression ?? args.expr ?? "");
    return { expression: expr, result: safeEval(expr) };
  },
};

/** ticket_lookup: safe, read-only lookup in a fixed in-memory ticket table. */
const ticketLookup: ToolDef = {
  name: "ticket_lookup",
  description: "Look up a support ticket by id; returns status and summary.",
  effect: "safe",
  async run(args) {
    const id = String(args.ticketId ?? args.id ?? "");
    const table: Record<string, { status: string; summary: string; priority: string }> = {
      "T-1001": { status: "open", summary: "Login fails after password reset", priority: "high" },
      "T-1002": { status: "pending", summary: "Billing overcharge dispute", priority: "medium" },
      "T-1003": { status: "resolved", summary: "Dark mode request", priority: "low" },
    };
    const hit = table[id];
    return hit
      ? { ticketId: id, found: true, ...hit }
      : { ticketId: id, found: false, status: "unknown", summary: "No such ticket", priority: "n/a" };
  },
};

/** send_reply: SIDE-EFFECTFUL — represents writing/sending to a customer. */
const sendReply: ToolDef = {
  name: "send_reply",
  description: "Send a reply to the customer (side-effectful).",
  effect: "side_effectful",
  async run(args) {
    return {
      sent: true,
      to: String(args.ticketId ?? "unknown"),
      body: String(args.body ?? ""),
    };
  },
};

export const RESEARCH_TOOLS: ToolRegistry = index([webSearch, calculator]);
export const SUPPORT_TOOLS: ToolRegistry = index([ticketLookup, sendReply]);
export const ALL_TOOLS: ToolRegistry = index([webSearch, calculator, ticketLookup, sendReply]);

/** Build a name→ToolDef registry from a list of tools. */
export function index(tools: ToolDef[]): ToolRegistry {
  const reg: ToolRegistry = {};
  for (const t of tools) reg[t.name] = t;
  return reg;
}

/** True when a tool is safe to re-execute (no external effects). */
export function isSafe(registry: ToolRegistry, name: string): boolean {
  return registry[name]?.effect === "safe";
}

/* -------------------------------- helpers --------------------------------- */

/** Tiny, safe arithmetic evaluator (no eval); tolerant of malformed input. */
function safeEval(expr: string): number {
  const tokens = expr.match(/\d+(\.\d+)?|[+\-*/()]/g) ?? [];
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr(): number {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const rhs = parseTerm();
      v = op === "+" ? v + rhs : v - rhs;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = next();
      const rhs = parseFactor();
      v = op === "*" ? v * rhs : v / rhs;
    }
    return v;
  }
  function parseFactor(): number {
    if (peek() === "(") {
      next();
      const v = parseExpr();
      if (peek() === ")") next();
      return v;
    }
    const t = next();
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  }

  const result = parseExpr();
  return Number.isFinite(result) ? result : 0;
}
