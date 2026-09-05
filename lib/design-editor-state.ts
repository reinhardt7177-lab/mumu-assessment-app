import type { DesignSessionRecord } from "./design-studio-domain";

// Only persist changed inputs. Saving unchanged inputs would invalidate a completed audit.
export function pendingDesignChanges(current: DesignSessionRecord, saved: DesignSessionRecord) {
  const patch: Record<string, unknown> = {};
  const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  for (const key of ["title", "learningGoal", "source", "standards", "competency"] as const) {
    if (current[key] != null && changed(current[key], saved[key])) patch[key] = current[key];
  }
  if (current.blueprint) {
    for (const key of ["rubric", "questions", "methods"] as const) {
      if (changed(current.blueprint[key], saved.blueprint?.[key])) patch[key] = current.blueprint[key];
    }
  }
  return patch;
}
