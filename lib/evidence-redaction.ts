function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactStudentIdentifiers(text: string, identifiers: Array<string | null | undefined>) {
  let redacted = text;
  const values = [...new Set(identifiers.map(value => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => b.length - a.length);
  for (const value of values) {
    const escaped = escapeRegExp(value);
    if (/^\d{1,4}$/.test(value)) {
      redacted = redacted
        .replace(new RegExp(`(?:학번|번호)\\s*[:：]?\\s*${escaped}(?!\\d)`, "gi"), "[학생 식별정보]")
        .replace(new RegExp(`(?<!\\d)${escaped}\\s*번`, "gi"), "[학생 식별정보]");
    } else if (value.length >= 2) {
      redacted = redacted.replace(new RegExp(escaped, "gi"), "[학생 식별정보]");
    }
  }
  return redacted;
}