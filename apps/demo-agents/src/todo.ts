import type { PlanStep } from "./mock-provider.js";
import type { ToolDef, ToolRegistry } from "./types.js";

export interface TodoTask {
  id: number;
  title: string;
  priority: "low" | "medium" | "high";
  dueDate?: string;
  done: boolean;
}

// ponytail: process-local storage is enough for the demo; add SQLite only when persistence matters.
const tasks: TodoTask[] = [];
let nextId = 1;

const listTasks: ToolDef = {
  name: "list_tasks",
  description: "List the current tasks before deciding what to add.",
  effect: "safe",
  async run() {
    return { tasks: listTodoTasks() };
  },
};

const createTask: ToolDef = {
  name: "create_task",
  description: "Create one task with a title, low/medium/high priority, and optional due date.",
  effect: "side_effectful",
  async run(args) {
    const title = String(args.title ?? "").trim();
    const priority = String(args.priority ?? "medium");
    if (!title) throw namedError("InvalidTaskError", "task title is required");
    if (!["low", "medium", "high"].includes(priority)) {
      throw namedError("InvalidPriorityError", `unsupported priority: ${priority}`);
    }
    const task: TodoTask = {
      id: nextId++,
      title,
      priority: priority as TodoTask["priority"],
      dueDate: typeof args.dueDate === "string" ? args.dueDate : undefined,
      done: false,
    };
    tasks.push(task);
    return { created: task };
  },
};

export const TODO_TOOLS: ToolRegistry = {
  [listTasks.name]: listTasks,
  [createTask.name]: createTask,
};

export function listTodoTasks(): TodoTask[] {
  return tasks.map((task) => ({ ...task }));
}

export function toggleTodoTask(id: number): TodoTask | undefined {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) return undefined;
  task.done = !task.done;
  return { ...task };
}

export function resetTodoTasks(): void {
  tasks.length = 0;
  nextId = 1;
}

export function buildTodoPlan(input: string, fail = false): PlanStep[] {
  const title = taskTitle(input);
  const priority = fail ? "impossible" : taskPriority(input);
  const dueDate = /\btomorrow\b/i.test(input)
    ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    : undefined;
  return [
    { kind: "tool", name: "list_tasks", args: {} },
    {
      kind: "tool",
      name: "create_task",
      args: { title, priority, ...(dueDate ? { dueDate } : {}) },
    },
    {
      kind: "final",
      content: `Created "${title}" with ${priority} priority${dueDate ? ` for ${dueDate}` : ""}.`,
    },
  ];
}

function taskTitle(input: string): string {
  return (
    input
      .replace(/^(please\s+)?(add|create|remember|remind me to)\s+/i, "")
      .replace(/\b(today|tomorrow)\b/gi, "")
      .replace(/\b(with\s+)?(low|medium|high|urgent)\s+priority\b/gi, "")
      .replace(/\s+/g, " ")
      .trim() || "Untitled task"
  );
}

function taskPriority(input: string): TodoTask["priority"] {
  if (/\b(urgent|high priority|p0)\b/i.test(input)) return "high";
  if (/\blow priority\b/i.test(input)) return "low";
  return "medium";
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}
