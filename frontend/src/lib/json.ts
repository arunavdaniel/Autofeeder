export function safeJsonParse<T = unknown>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "string") return safeJsonParse(parsed, fallback);
    return parsed as T;
  } catch {
    return fallback;
  }
}
