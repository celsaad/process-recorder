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

const BLANK_ID = /^blank-(\d+)$/;

/** "blank-N", numbered at creation (max existing N + 1) and never renumbered. */
function newId(t: ExportTemplate): string {
  const used = t.columns.map((c) => Number(BLANK_ID.exec(c.id)?.[1] ?? 0));
  let n = Math.max(0, ...used) + 1;
  while (t.columns.some((c) => c.id === `blank-${n}`)) n++;
  return `blank-${n}`;
}

/** Stable name for a column, independent of its header and position: "Description", "blank column 2". */
export function columnLabel(c: TemplateColumn): string {
  if (c.kind !== "blank") return BUILT_IN_LABEL[c.kind];
  const n = BLANK_ID.exec(c.id)?.[1];
  return n ? `blank column ${n}` : `blank column ${c.id}`;
}

const BUILT_IN_LABEL: Record<Exclude<ColumnKind, "blank">, string> = {
  number: "Step number",
  action: "Action",
  description: "Description",
  expectedResult: "Expected result",
  screenshot: "Screenshot",
};

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

const presetSchema = z.object({ name: z.string().trim().min(1).max(100), template: templateSchema });

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

/** Preset names compare trimmed and case-insensitively. */
const nameKey = (name: string) => name.trim().toLocaleLowerCase();
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);
export const isReservedName = (name: string) => sameName(name, DEFAULT_PRESET_NAME);

/** The preset with this name (trimmed, any case), if any. */
export function findPreset(presets: Preset[], name: string): Preset | undefined {
  return presets.find((p) => sameName(p.name, name));
}

/** Saved presets only. Each entry is validated on its own: a bad one is dropped, the rest survive.
 *  Duplicate names (any case) and "Default" keep only the first valid entry / none. */
function savedOnly(): Preset[] {
  const raw = readJson(PRESETS_KEY);
  if (!Array.isArray(raw)) return [];
  const out: Preset[] = [];
  for (const entry of raw.slice(0, 100)) {
    const r = presetSchema.safeParse(entry);
    if (!r.success || isReservedName(r.data.name) || findPreset(out, r.data.name)) continue;
    out.push(r.data);
  }
  return out;
}

/** Saved presets, with the built-in "Default" first. */
export function loadPresets(): Preset[] {
  return [{ name: DEFAULT_PRESET_NAME, template: defaultTemplate() }, ...savedOnly()];
}

/**
 * Saves a preset. An existing name (any case) is updated in place, keeping its stored name.
 * "Default" (any case), empty names and invalid templates are refused. Returns the new list.
 */
export function savePreset(name: string, template: ExportTemplate): Preset[] {
  const trimmed = name.trim();
  if (!trimmed || isReservedName(trimmed) || !parseTemplate(template)) return loadPresets();
  const saved = savedOnly();
  const i = saved.findIndex((p) => sameName(p.name, trimmed));
  if (i >= 0) saved[i] = { name: saved[i].name, template };
  else saved.push({ name: trimmed, template });
  writeJson(PRESETS_KEY, saved);
  return loadPresets();
}

/** Deletes a saved preset (name in any case). "Default" can't be deleted. Returns the new list. */
export function deletePreset(name: string): Preset[] {
  if (isReservedName(name)) return loadPresets();
  writeJson(
    PRESETS_KEY,
    savedOnly().filter((p) => !sameName(p.name, name)),
  );
  return loadPresets();
}

export function loadLastTemplate(): ExportTemplate {
  return parseTemplate(readJson(LAST_TEMPLATE_KEY)) ?? defaultTemplate();
}

export function saveLastTemplate(template: ExportTemplate): void {
  if (parseTemplate(template)) writeJson(LAST_TEMPLATE_KEY, template);
}
