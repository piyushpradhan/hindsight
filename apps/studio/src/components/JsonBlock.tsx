export function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="json"><code>{text}</code></pre>;
}

/** Renders JSON-shaped strings as code, including malformed payload evidence. */
export function SmartPayload({ value }: { value: unknown }) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return <JsonBlock value={JSON.parse(trimmed)} />;
      } catch {
        return <JsonBlock value={value} />;
      }
    }
    return <p className="msg-text">{value}</p>;
  }
  return <JsonBlock value={value} />;
}
