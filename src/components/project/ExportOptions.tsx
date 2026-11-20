"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAnnounce } from "@/components/shell/LiveRegion";
import { buttonClass } from "@/components/shell/button-styles";
import {
  addBlankColumn,
  DEFAULT_PRESET_NAME,
  deletePreset,
  loadLastTemplate,
  loadPresets,
  moveColumn,
  removeColumn,
  renameColumn,
  saveLastTemplate,
  savePreset,
  toggleColumn,
  visibleColumns,
  type ColumnKind,
  type ExportTemplate,
  type Preset,
  type TemplateColumn,
} from "@/lib/export-template";
import { ExportButton } from "./ExportButton";

export type ExportOptionsProps = { onExport: (template: ExportTemplate) => Promise<void> };

const KIND_LABEL: Record<ColumnKind, string> = {
  number: "Step number",
  action: "Action",
  description: "Description",
  expectedResult: "Expected result",
  screenshot: "Screenshot",
  blank: "Blank column for testers",
};

const disabledLook = "aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/** The name a column goes by in accessible names and announcements. */
const nameOf = (c: TemplateColumn) => c.header.trim() || KIND_LABEL[c.kind];

/**
 * "Export options" (Word export template) next to "Export to Word". The dialog picks, orders and
 * renames the columns, adds blank tester columns, and manages named presets (localStorage).
 * The current template is remembered and used by "Export to Word".
 */
export function ExportOptions({ onExport }: ExportOptionsProps) {
  const announce = useAnnounce();
  const [template, setTemplate] = useState<ExportTemplate>(loadLastTemplate);
  const [presets, setPresets] = useState<Preset[]>(loadPresets);
  const [preset, setPreset] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [lastVisibleId, setLastVisibleId] = useState<string | null>(null);
  /** Control to focus after the next render ("add", or a row's data-focus-key). */
  const focusTarget = useRef<string | null>(null);
  const setFocusTarget = (key: string) => void (focusTarget.current = key);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const uid = useId();

  useEffect(() => saveLastTemplate(template), [template]);

  // Moving a row re-inserts its DOM node, which can drop focus; put it back on the same control.
  // Adding focuses the new header input; removing focuses "Add blank column".
  useEffect(() => {
    const key = focusTarget.current;
    if (!key) return;
    focusTarget.current = null;
    if (key === "add") addRef.current?.focus();
    else listRef.current?.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
  }, [template]);

  const update = (next: ExportTemplate) => {
    setTemplate(next);
    setLastVisibleId(null);
  };

  const move = (col: TemplateColumn, delta: -1 | 1) => {
    const next = moveColumn(template, col.id, delta);
    if (next === template) return;
    update(next);
    const pos = next.columns.findIndex((c) => c.id === col.id) + 1;
    announce(`Moved '${nameOf(col)}' to position ${pos} of ${next.columns.length}.`);
    setFocusTarget(`${col.id}:${delta < 0 ? "up" : "down"}`);
  };

  const toggle = (col: TemplateColumn, visible: boolean) => {
    const next = toggleColumn(template, col.id, visible);
    if (next === template) {
      setLastVisibleId(col.id);
      announce("At least one column must stay visible.");
      return;
    }
    update(next);
    announce(`'${nameOf(col)}' ${visible ? "shown" : "hidden"}.`);
  };

  const add = () => {
    const next = addBlankColumn(template);
    const col = next.columns[next.columns.length - 1];
    update(next);
    announce(`Added blank column '${col.header}'.`);
    setFocusTarget(`${col.id}:header`);
  };

  const remove = (col: TemplateColumn) => {
    const next = removeColumn(template, col.id);
    if (next === template) {
      setLastVisibleId(col.id);
      announce("At least one column must stay visible.");
      return;
    }
    update(next);
    announce(`Removed '${nameOf(col)}'.`);
    setFocusTarget("add");
  };

  const pickPreset = (name: string) => {
    setPreset(name);
    const found = presets.find((p) => p.name === name);
    if (!found) return;
    update(found.template);
    announce(`Loaded preset '${name}'.`);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const name = presetName.trim();
    if (!name) return setPresetError("Enter a name for the preset.");
    if (name === DEFAULT_PRESET_NAME) return setPresetError(`"${DEFAULT_PRESET_NAME}" is built in. Choose another name.`);
    setPresets(savePreset(name, template));
    setPreset(name);
    setPresetName("");
    setPresetError(null);
    announce(`Saved preset '${name}'.`);
  };

  const canDelete = preset !== "" && preset !== DEFAULT_PRESET_NAME;
  const removePreset = () => {
    if (!canDelete) return;
    setPresets(deletePreset(preset));
    announce(`Deleted preset '${preset}'.`);
    setPreset("");
  };

  const count = template.columns.length;
  const visibleCount = visibleColumns(template).length;
  const lastVisibleMsgId = `${uid}-last-visible`;
  const presetErrorId = `${uid}-preset-error`;

  return (
    <div className="flex items-center gap-2">
      <Dialog>
        <DialogTrigger className={buttonClass("secondary", "lg", "px-4")}>
          <Settings2 aria-hidden="true" className="size-[18px]" strokeWidth={1.9} />
          Export options
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Export options</DialogTitle>
            <DialogDescription>
              Choose the Word table&apos;s columns, their order and headers. Blank columns are left empty for testers.
            </DialogDescription>
          </DialogHeader>

          <section aria-labelledby={`${uid}-columns`} className="flex flex-col gap-2">
            <h3 id={`${uid}-columns`} className="text-sm font-semibold">
              Columns ({visibleCount} of {count} shown)
            </h3>
            <ol ref={listRef} className="flex flex-col gap-2">
              {template.columns.map((col, i) => {
                const name = nameOf(col);
                const checkId = `${uid}-${col.id}-show`;
                const inputId = `${uid}-${col.id}-header`;
                const first = i === 0;
                const last = i === count - 1;
                return (
                  <li key={col.id} className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-2">
                    <div className="flex items-center gap-2 self-center">
                      <input
                        id={checkId}
                        type="checkbox"
                        className="size-4"
                        checked={col.visible}
                        onChange={(e) => toggle(col, e.target.checked)}
                        aria-describedby={lastVisibleId === col.id ? lastVisibleMsgId : undefined}
                      />
                      <Label htmlFor={checkId}>
                        Show <span className="sr-only">&apos;{name}&apos;</span>
                      </Label>
                    </div>
                    <div className="flex min-w-40 flex-1 flex-col gap-1">
                      <Label htmlFor={inputId}>
                        Header <span className="sr-only">for column {i + 1}</span>
                      </Label>
                      <input
                        id={inputId}
                        data-focus-key={`${col.id}:header`}
                        type="text"
                        value={col.header}
                        maxLength={200}
                        onChange={(e) => update(renameColumn(template, col.id, e.target.value))}
                        className="h-8 rounded-md border border-control-border bg-card px-2 text-sm"
                      />
                      <span className="text-meta text-foreground-2">{KIND_LABEL[col.kind]}</span>
                    </div>
                    <div className="flex items-center gap-1 self-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={disabledLook}
                        data-focus-key={`${col.id}:up`}
                        aria-label={`Move '${name}' up`}
                        aria-disabled={first || undefined}
                        onClick={() => !first && move(col, -1)}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={disabledLook}
                        data-focus-key={`${col.id}:down`}
                        aria-label={`Move '${name}' down`}
                        aria-disabled={last || undefined}
                        onClick={() => !last && move(col, 1)}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      {col.kind === "blank" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Remove '${name}'`}
                          onClick={() => remove(col)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {lastVisibleId && (
              <p id={lastVisibleMsgId} className="text-sm font-medium text-warning-foreground">
                At least one column must stay visible.
              </p>
            )}
            <div>
              <Button ref={addRef} type="button" variant="outline" onClick={add}>
                <Plus aria-hidden="true" />
                Add blank column
              </Button>
            </div>
          </section>

          <section aria-labelledby={`${uid}-presets`} className="flex flex-col gap-3">
            <h3 id={`${uid}-presets`} className="text-sm font-semibold">
              Presets
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${uid}-preset`}>Preset</Label>
                <select
                  id={`${uid}-preset`}
                  value={preset}
                  onChange={(e) => pickPreset(e.target.value)}
                  className="h-8 min-w-48 rounded-md border border-control-border bg-card px-2 text-sm"
                >
                  <option value="">Choose a preset…</option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="button"
                variant="outline"
                className={disabledLook}
                aria-disabled={!canDelete || undefined}
                onClick={removePreset}
              >
                Delete preset{canDelete && " "}{canDelete && <span className="sr-only">&apos;{preset}&apos;</span>}
              </Button>
            </div>
            <form onSubmit={save} className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${uid}-preset-name`}>Save as preset…</Label>
                <input
                  id={`${uid}-preset-name`}
                  type="text"
                  value={presetName}
                  maxLength={100}
                  placeholder="e.g. Acme Corp"
                  onChange={(e) => setPresetName(e.target.value)}
                  aria-describedby={presetError ? presetErrorId : undefined}
                  aria-invalid={presetError ? true : undefined}
                  className="h-8 min-w-48 rounded-md border border-control-border bg-card px-2 text-sm"
                />
              </div>
              <Button type="submit" variant="outline">
                Save preset
              </Button>
            </form>
            {presetError && (
              <p id={presetErrorId} className="text-sm font-medium text-warning-foreground">
                {presetError}
              </p>
            )}
          </section>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ExportButton onExport={() => onExport(template)} />
    </div>
  );
}
