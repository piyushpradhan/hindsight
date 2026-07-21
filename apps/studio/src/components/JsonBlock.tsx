export function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <pre className="json">{text}</pre>;
}

/** Renders a string as pretty JSON when it parses, otherwise as plain text. */
export function SmartPayload({ value }: { value: unknown }) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return <JsonBlock value={JSON.parse(trimmed)} />;
      } catch {
        // malformed JSON is first-class data here — show it raw
      }
    }
    return <p className="msg-text">{value}</p>;
  }
  return <JsonBlock value={value} />;
}
