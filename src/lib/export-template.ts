// Word export templates (D15 item 6, lighter version): pick, order and rename the built-in
// columns, and add blank header-only columns for testers. Pure: no React, no Next.
import { z } from "zod";

export const COLUMN_KINDS = ["number", "action", "description", "expectedResult", "screenshot", "blank"] as const;
export type ColumnKind = (typeof COLUMN_KINDS)[number];

export type TemplateColumn = { id: string; kind: ColumnKind; header: string; visible: boolean };
export type ExportTemplate = { columns: TemplateColumn[] };
export type Preset = { name: string; template: ExportTemplate };

export const DEFAULT_PRESET_NAME = "Default";

/** Today's five columns. Treat as read-only; the helpers below never mutate their input. */
export const DEFAULT_TEMPLATE: ExportTemplate = {
  columns: [
    { id: "number", kind: "number", header: "#", visible: true },
    { id: "action", kind: "action", header: "Action", visible: true },
    { id: "description", kind: "description", header: "Description", visible: true },
    { id: "expectedResult", kind: "expectedResult", header: "Expected result", visible: true },
    { id: "screenshot", kind: "screenshot", header: "Screenshot", visible: true },
  ],
};

/** A fresh, mutable copy of the default template. */
export function defaultTemplate(): ExportTemplate {
  return { columns: DEFAULT_TEMPLATE.columns.map((c) => ({ ...c })) };
}

export function visibleColumns(t: ExportTemplate): TemplateColumn[] {
  return t.columns.filter((c) => c.visible);
}

/** Moves a column one place up (-1) or down (+1). Out of range is a no-op (same object). */
export function moveColumn(t: ExportTemplate, id: string, delta: -1 | 1): ExportTemplate {
  const i = t.columns.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= t.columns.length) return t;
  const columns = [...t.columns];
  [columns[i], columns[j]] = [columns[j], columns[i]];
  return { columns };
}

export function renameColumn(t: ExportTemplate, id: string, header: string): ExportTemplate {
  return { columns: t.columns.map((c) => (c.id === id ? { ...c, header } : c)) };
}

/** Toggles visibility. Hiding the last visible column is refused (same object returned). */
export function toggleColumn(t: ExportTemplate, id: string, visible: boolean): ExportTemplate {
  const col = t.columns.find((c) => c.id === id);
  if (!col || col.visible === visible) return t;
  if (!visible && visibleColumns(t).length <= 1) return t;
  return { columns: t.columns.map((c) => (c.id === id ? { ...c, visible } : c)) };
}

/** Appends a visible blank column. `id` is injectable for tests; defaults to a unique id. */
export function addBlankColumn(t: ExportTemplate, header = "New column", id = newId(t)): ExportTemplate {
  return { columns: [...t.columns, { id, kind: "blank", header, visible: true }] };
}

/** Removes a blank column. Built-in columns can only be hidden, and the last visible column stays. */
export function removeColumn(t: ExportTemplate, id: string): ExportTemplate {
  const col = t.columns.find((c) => c.id === id);
  if (!col || col.kind !== "blank") return t;
  if (col.visible && visibleColumns(t).length <= 1) return t;
  return { columns: t.columns.filter((c) => c.id !== id) };
}

function newId(t: ExportTemplate): string {
  let n = t.columns.length + 1;
  while (t.columns.some((c) => c.id === `blank-${n}`)) n++;
  return `blank-${n}`;
}

// ---------- Validation ----------

const columnSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(COLUMN_KINDS),
  header: z.string().max(200),
  visible: z.boolean(),
});

const templateSchema = z
  .object({ columns: z.array(columnSchema).min(1).max(50) })
  .refine((t) => t.columns.some((c) => c.visible), "at least one visible column")
  .refine((t) => new Set(t.columns.map((c) => c.id)).size === t.columns.length, "unique ids")
  .refine(
    (t) => COLUMN_KINDS.every((k) => k === "blank" || t.columns.filter((c) => c.kind === k).length <= 1),
    "each built-in column at most once",
  );

const presetsSchema = z.array(z.object({ name: z.string().min(1).max(100), template: templateSchema })).max(100);

export function parseTemplate(value: unknown): ExportTemplate | null {
  const r = templateSchema.safeParse(value);
  return r.success ? r.data : null;
}

// ---------- Storage (localStorage, small JSON) ----------

export const PRESETS_KEY = "export-template-presets";
export const LAST_TEMPLATE_KEY = "export-template-last";

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const raw = storage()?.getItem(key);
    return raw == null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: templates are a convenience, the export still works.
  }
}

/** Saved presets, with the built-in "Default" first. Corrupt storage yields just the default. */
export function loadPresets(): Preset[] {
  const parsed = presetsSchema.safeParse(readJson(PRESETS_KEY));
  const saved = parsed.success ? parsed.data.filter((p) => p.name !== DEFAULT_PRESET_NAME) : [];
  return [{ name: DEFAULT_PRESET_NAME, template: defaultTemplate() }, ...saved];
}

function savedOnly(): Preset[] {
  return loadPresets().filter((p) => p.name !== DEFAULT_PRESET_NAME);
}

/** Saves (or overwrites) a preset by name. "Default" and empty names are refused. Returns the new list. */
export function savePreset(name: string, template: ExportTemplate): Preset[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed === DEFAULT_PRESET_NAME || !parseTemplate(template)) return loadPresets();
  const rest = savedOnly().filter((p) => p.name !== trimmed);
  writeJson(PRESETS_KEY, [...rest, { name: trimmed, template }]);
  return loadPresets();
}

/** Deletes a saved preset. "Default" can't be deleted. Returns the new list. */
export function deletePreset(name: string): Preset[] {
  if (name === DEFAULT_PRESET_NAME) return loadPresets();
  writeJson(
    PRESETS_KEY,
    savedOnly().filter((p) => p.name !== name),
  );
  return loadPresets();
}

export function loadLastTemplate(): ExportTemplate {
  return parseTemplate(readJson(LAST_TEMPLATE_KEY)) ?? defaultTemplate();
}

export function saveLastTemplate(template: ExportTemplate): void {
  if (parseTemplate(template)) writeJson(LAST_TEMPLATE_KEY, template);
}
