import { compareValues, nextSort } from "../src/components/SortableHeader";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const rows = [{ value: null }, { value: 12 }, { value: 3 }];
assert(
  [...rows].sort((a, b) => compareValues(a.value, b.value, "asc")).map((row) => row.value).join() ===
    "3,12,",
  "ascending numeric sort keeps missing values last",
);
assert(
  [...rows].sort((a, b) => compareValues(a.value, b.value, "desc")).map((row) => row.value).join() ===
    "12,3,",
  "descending numeric sort keeps missing values last",
);
assert(
  nextSort({ key: "agent", direction: "asc" }, "agent").direction === "desc",
  "reselecting a column reverses its direction",
);
assert(
  nextSort({ key: "agent", direction: "desc" }, "started").direction === "asc",
  "selecting a new column starts ascending",
);
