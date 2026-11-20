// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  addBlankColumn,
  DEFAULT_PRESET_NAME,
  DEFAULT_TEMPLATE,
  defaultTemplate,
  deletePreset,
  LAST_TEMPLATE_KEY,
  loadLastTemplate,
  loadPresets,
  moveColumn,
  parseTemplate,
  PRESETS_KEY,
  removeColumn,
  renameColumn,
  saveLastTemplate,
  savePreset,
  toggleColumn,
  visibleColumns,
  type ExportTemplate,
} from "./export-template";

const ids = (t: ExportTemplate) => t.columns.map((c) => c.id);

describe("DEFAULT_TEMPLATE", () => {
  it("is today's 5 visible columns", () => {
    expect(DEFAULT_TEMPLATE.columns.map((c) => c.header)).toEqual([
      "#",
      "Action",
      "Description",
      "Expected result",
      "Screenshot",
    ]);
    expect(visibleColumns(DEFAULT_TEMPLATE)).toHaveLength(5);
    expect(defaultTemplate()).toEqual(DEFAULT_TEMPLATE);
    expect(defaultTemplate().columns[0]).not.toBe(DEFAULT_TEMPLATE.columns[0]);
  });
});

describe("helpers", () => {
  it("moveColumn swaps with a neighbour and ignores out-of-range moves", () => {
    expect(ids(moveColumn(DEFAULT_TEMPLATE, "action", -1)).slice(0, 2)).toEqual(["action", "number"]);
    expect(ids(moveColumn(DEFAULT_TEMPLATE, "action", 1)).slice(1, 3)).toEqual(["description", "action"]);
    expect(moveColumn(DEFAULT_TEMPLATE, "number", -1)).toBe(DEFAULT_TEMPLATE);
    expect(moveColumn(DEFAULT_TEMPLATE, "screenshot", 1)).toBe(DEFAULT_TEMPLATE);
    expect(moveColumn(DEFAULT_TEMPLATE, "nope", 1)).toBe(DEFAULT_TEMPLATE);
    expect(ids(DEFAULT_TEMPLATE)[0]).toBe("number"); // not mutated
  });

  it("renameColumn changes only that header", () => {
    const t = renameColumn(DEFAULT_TEMPLATE, "expectedResult", "Expected outcome");
    expect(t.columns[3].header).toBe("Expected outcome");
    expect(t.columns[1].header).toBe("Action");
    expect(DEFAULT_TEMPLATE.columns[3].header).toBe("Expected result");
  });

  it("toggleColumn hides and shows, but never hides the last visible column", () => {
    let t: ExportTemplate = DEFAULT_TEMPLATE;
    for (const id of ["number", "action", "description", "expectedResult"]) t = toggleColumn(t, id, false);
    expect(visibleColumns(t).map((c) => c.id)).toEqual(["screenshot"]);
    expect(toggleColumn(t, "screenshot", false)).toBe(t);
    expect(visibleColumns(toggleColumn(t, "action", true))).toHaveLength(2);
    expect(toggleColumn(t, "missing", true)).toBe(t);
  });

  it("addBlankColumn appends a visible blank column with a unique id", () => {
    const a = addBlankColumn(DEFAULT_TEMPLATE, "Pass/Fail");
    const b = addBlankColumn(a, "Tester");
    expect(b.columns.slice(-2).map((c) => [c.kind, c.header, c.visible])).toEqual([
      ["blank", "Pass/Fail", true],
      ["blank", "Tester", true],
    ]);
    expect(new Set(ids(b)).size).toBe(b.columns.length);
    expect(addBlankColumn(DEFAULT_TEMPLATE).columns[5].header).toBe("New column");
  });

  it("removeColumn removes blank columns only, keeping one visible", () => {
    const t = addBlankColumn(DEFAULT_TEMPLATE, "Pass/Fail", "pf");
    expect(ids(removeColumn(t, "pf"))).toEqual(ids(DEFAULT_TEMPLATE));
    expect(removeColumn(t, "action")).toBe(t);
    let only: ExportTemplate = t;
    for (const id of ["number", "action", "description", "expectedResult", "screenshot"]) only = toggleColumn(only, id, false);
    expect(visibleColumns(only).map((c) => c.id)).toEqual(["pf"]);
    expect(removeColumn(only, "pf")).toBe(only);
  });
});

describe("parseTemplate", () => {
  it("accepts a valid template and rejects bad shapes", () => {
    expect(parseTemplate(DEFAULT_TEMPLATE)).toEqual(DEFAULT_TEMPLATE);
    expect(parseTemplate(null)).toBeNull();
    expect(parseTemplate({ columns: [] })).toBeNull();
    expect(parseTemplate({ columns: [{ id: "x", kind: "weird", header: "X", visible: true }] })).toBeNull();
    expect(parseTemplate(toggleAllOff())).toBeNull();
    const dupId = { columns: [DEFAULT_TEMPLATE.columns[0], DEFAULT_TEMPLATE.columns[0]] };
    expect(parseTemplate(dupId)).toBeNull();
    const dupKind = { columns: [DEFAULT_TEMPLATE.columns[1], { ...DEFAULT_TEMPLATE.columns[1], id: "a2" }] };
    expect(parseTemplate(dupKind)).toBeNull();
  });
});

function toggleAllOff() {
  return { columns: DEFAULT_TEMPLATE.columns.map((c) => ({ ...c, visible: false })) };
}

describe("preset storage", () => {
  beforeEach(() => localStorage.clear());

  it("starts with only the built-in Default", () => {
    expect(loadPresets()).toEqual([{ name: DEFAULT_PRESET_NAME, template: DEFAULT_TEMPLATE }]);
  });

  it("saves, overwrites, loads and deletes presets", () => {
    const acme = renameColumn(DEFAULT_TEMPLATE, "expectedResult", "Expected outcome");
    expect(savePreset("  Acme Corp ", acme).map((p) => p.name)).toEqual(["Default", "Acme Corp"]);
    const acme2 = addBlankColumn(acme, "Pass/Fail", "pf");
    savePreset("Acme Corp", acme2);
    expect(loadPresets()).toHaveLength(2);
    expect(loadPresets()[1].template).toEqual(acme2);
    expect(deletePreset("Acme Corp").map((p) => p.name)).toEqual(["Default"]);
  });

  it("refuses to save over or delete Default, and empty names", () => {
    const t = renameColumn(DEFAULT_TEMPLATE, "action", "Step");
    savePreset("Default", t);
    savePreset("   ", t);
    deletePreset("Default");
    expect(loadPresets()).toEqual([{ name: "Default", template: DEFAULT_TEMPLATE }]);
  });

  it("falls back to Default on corrupt JSON or invalid data", () => {
    localStorage.setItem(PRESETS_KEY, "{not json");
    expect(loadPresets().map((p) => p.name)).toEqual(["Default"]);
    localStorage.setItem(PRESETS_KEY, JSON.stringify([{ name: "Bad", template: toggleAllOff() }]));
    expect(loadPresets().map((p) => p.name)).toEqual(["Default"]);
  });

  it("remembers the last template and falls back on corrupt data", () => {
    expect(loadLastTemplate()).toEqual(DEFAULT_TEMPLATE);
    const t = addBlankColumn(DEFAULT_TEMPLATE, "Tester", "tester");
    saveLastTemplate(t);
    expect(loadLastTemplate()).toEqual(t);
    localStorage.setItem(LAST_TEMPLATE_KEY, "]]");
    expect(loadLastTemplate()).toEqual(DEFAULT_TEMPLATE);
    localStorage.setItem(LAST_TEMPLATE_KEY, JSON.stringify(toggleAllOff()));
    expect(loadLastTemplate()).toEqual(DEFAULT_TEMPLATE);
  });
});
