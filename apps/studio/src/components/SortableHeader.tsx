export type SortDirection = "asc" | "desc";
export type SortState<Key extends string> = { key: Key; direction: SortDirection };

export function nextSort<Key extends string>(
  current: SortState<Key>,
  key: Key,
): SortState<Key> {
  return current.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: "asc" };
}

export function compareValues(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  direction: SortDirection,
): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? order : -order;
}

export function SortableHeader({
  label,
  active,
  direction,
  onSort,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
}) {
  return (
    <th aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : undefined}>
      <button className="sort-button" type="button" onClick={onSort}>
        {label}
        <span className="sort-indicator" aria-hidden="true">
          {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

export function MobileSort<Key extends string>({
  label,
  options,
  sort,
  onChange,
}: {
  label: string;
  options: Array<{ key: Key; label: string }>;
  sort: SortState<Key>;
  onChange: (sort: SortState<Key>) => void;
}) {
  return (
    <div className="mobile-sort-controls">
      <select
        className="input table-filter"
        value={sort.key}
        onChange={(event) =>
          onChange({ key: event.target.value as Key, direction: "asc" })
        }
        aria-label={label}
      >
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            Sort by {option.label}
          </option>
        ))}
      </select>
      <button
        className="btn btn-ghost"
        type="button"
        aria-label={`Sort ${sort.direction === "asc" ? "descending" : "ascending"}`}
        onClick={() => onChange(nextSort(sort, sort.key))}
      >
        {sort.direction === "asc" ? "↑" : "↓"}
      </button>
    </div>
  );
}
