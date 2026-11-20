// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import { loadLastTemplate, loadPresets, type ExportTemplate } from "@/lib/export-template";
import { ExportOptions } from "./ExportOptions";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function setup() {
  const onExport = vi.fn<(t: ExportTemplate) => Promise<void>>(async () => {});
  const user = userEvent.setup();
  const utils = render(
    <LiveRegionProvider>
      <ExportOptions onExport={onExport} />
    </LiveRegionProvider>,
  );
  return { ...utils, onExport, user };
}

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Export options" }));
  return screen.getByRole("dialog", { name: "Export options" });
}

const headersOf = (t: ExportTemplate) => t.columns.filter((c) => c.visible).map((c) => c.header);
const liveText = () => screen.getByTestId("live-region").textContent;

describe("ExportOptions", () => {
  it("renames a header, reorders, adds a blank column; Export to Word uses the template; focus returns", async () => {
    const { user, onExport, baseElement } = setup();
    const trigger = screen.getByRole("button", { name: "Export options" });
    const dialog = await open(user);

    const header4 = within(dialog).getByRole("textbox", { name: "Header for Expected result column" });
    expect(header4).toHaveValue("Expected result");
    await user.clear(header4);
    await user.type(header4, "Expected outcome");

    // Move "Screenshot" (last) up: the down button at the end is aria-disabled and keeps focus.
    const down = within(dialog).getByRole("button", { name: "Move 'Screenshot' down" });
    expect(down).toHaveAttribute("aria-disabled", "true");
    expect(down).not.toBeDisabled();
    await user.click(down);
    const up = within(dialog).getByRole("button", { name: "Move 'Screenshot' up" });
    await user.click(up);
    await waitFor(() => expect(liveText()).toBe("Moved 'Screenshot' to position 4 of 5."));
    expect(within(dialog).getByRole("button", { name: "Move 'Screenshot' up" })).toHaveFocus();
    expect(within(dialog).getByRole("button", { name: "Move 'Expected outcome' down" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );

    await user.click(within(dialog).getByRole("button", { name: "Add blank column" }));
    const blank = within(dialog).getByRole("textbox", { name: "Header for blank column 1" });
    expect(blank).toHaveFocus();
    await user.clear(blank);
    await user.type(blank, "Pass/Fail");
    await waitFor(() => expect(liveText()).toBe("Added blank column 'New column'."));
    expect(within(dialog).getByRole("button", { name: "Remove 'Pass/Fail'" })).toBeInTheDocument();
    expect(within(dialog).getByRole("checkbox", { name: "Show 'Pass/Fail'" })).toBeChecked();
    const violations = await axe(baseElement);

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Export to Word" }));
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
    const used = onExport.mock.calls[0][0];
    expect(headersOf(used)).toEqual(["#", "Action", "Description", "Screenshot", "Expected outcome", "Pass/Fail"]);
    expect(loadLastTemplate()).toEqual(used);
    expect(violations).toHaveNoViolations();
  });

  it("keeps the last column visible with an inline message", async () => {
    const { user, baseElement } = setup();
    const dialog = await open(user);
    for (const name of ["#", "Action", "Description", "Expected result"]) {
      await user.click(within(dialog).getByRole("checkbox", { name: `Show '${name}'` }));
    }
    const last = within(dialog).getByRole("checkbox", { name: "Show 'Screenshot'" });
    await user.click(last);
    expect(last).toBeChecked();
    expect(within(dialog).getByText("At least one column must stay visible.")).toBeInTheDocument();
    expect(last).toHaveAccessibleDescription("At least one column must stay visible.");
    await waitFor(() => expect(liveText()).toBe("At least one column must stay visible."));
    expect(baseElement.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it("saves, loads and deletes a preset; Default can't be deleted", async () => {
    const { user, onExport, baseElement } = setup();
    const dialog = await open(user);
    const header2 = within(dialog).getByRole("textbox", { name: "Header for Action column" });
    await user.clear(header2);
    await user.type(header2, "Step");

    await user.type(within(dialog).getByRole("textbox", { name: "Save as preset…" }), "Acme Corp");
    await user.click(within(dialog).getByRole("button", { name: "Save preset" }));
    await waitFor(() => expect(liveText()).toBe("Saved preset 'Acme Corp'."));
    expect(loadPresets().map((p) => p.name)).toEqual(["Default", "Acme Corp"]);

    const select = within(dialog).getByRole("combobox", { name: "Preset" });
    await user.selectOptions(select, "Default");
    expect(header2).toHaveValue("Action");
    const del = within(dialog).getByRole("button", { name: "Delete preset" });
    expect(del).toHaveAttribute("aria-disabled", "true");
    await user.click(del);
    expect(loadPresets()).toHaveLength(2);

    await user.selectOptions(select, "Acme Corp");
    expect(header2).toHaveValue("Step");
    await waitFor(() => expect(liveText()).toBe("Loaded preset 'Acme Corp'."));
    const violations = await axe(baseElement);

    await user.click(within(dialog).getByRole("button", { name: "Delete preset Acme Corp" }));
    expect(loadPresets().map((p) => p.name)).toEqual(["Default"]);
    expect(within(dialog).queryByRole("option", { name: "Acme Corp" })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Export options" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Export to Word" }));
    await waitFor(() => expect(onExport).toHaveBeenCalled());
    expect(headersOf(onExport.mock.calls[0][0])[1]).toBe("Step");
    expect(violations).toHaveNoViolations();
  });

  it("refuses an empty or reserved preset name with an inline message", async () => {
    const { user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Save preset" }));
    const input = within(dialog).getByRole("textbox", { name: "Save as preset…" });
    expect(input).toHaveAccessibleDescription("Enter a name for the preset.");
    await user.type(input, "   {Enter}");
    expect(input).toHaveAccessibleDescription("Enter a name for the preset.");
    await user.clear(input);
    await user.type(input, "  dEfAuLt {Enter}");
    expect(input).toHaveAccessibleDescription(/built in/);
    expect(loadPresets()).toHaveLength(1);
  });

  it("marks a loaded preset as modified after edits; saving the same name (any case) updates it", async () => {
    const { user } = setup();
    const dialog = await open(user);
    const nameInput = within(dialog).getByRole("textbox", { name: "Save as preset…" });
    await user.type(nameInput, "Acme Corp{Enter}");
    const select = within(dialog).getByRole("combobox", { name: "Preset" });
    expect(within(select).getByRole("option", { selected: true })).toHaveTextContent(/^Acme Corp$/);

    const header = within(dialog).getByRole("textbox", { name: "Header for Description column" });
    await user.type(header, " (detail)");
    expect(within(select).getByRole("option", { selected: true })).toHaveTextContent("Acme Corp (modified)");
    expect(within(dialog).getByRole("button", { name: "Delete preset Acme Corp" })).not.toHaveAttribute("aria-disabled");

    await user.type(nameInput, "ACME corp{Enter}");
    await waitFor(() => expect(liveText()).toBe("Updated preset 'Acme Corp'."));
    expect(loadPresets().map((p) => p.name)).toEqual(["Default", "Acme Corp"]);
    expect(loadPresets()[1].template.columns[2].header).toBe("Description (detail)");
    expect(within(select).getByRole("option", { selected: true })).toHaveTextContent(/^Acme Corp$/);
  });

  it("header input names are stable across moves; Remove focuses the next column (or previous if last)", async () => {
    const { user } = setup();
    const dialog = await open(user);
    await user.click(within(dialog).getByRole("button", { name: "Add blank column" }));
    await user.click(within(dialog).getByRole("button", { name: "Add blank column" }));
    const blank1 = within(dialog).getByRole("textbox", { name: "Header for blank column 1" });
    await user.clear(blank1);
    await user.type(blank1, "Pass/Fail");
    await user.click(within(dialog).getByRole("button", { name: "Move 'Pass/Fail' up" }));
    expect(within(dialog).getByRole("textbox", { name: "Header for blank column 1" })).toHaveValue("Pass/Fail");

    // Order: … Expected result, Pass/Fail, Screenshot, New column. Removing Pass/Fail focuses the next one.
    await user.click(within(dialog).getByRole("button", { name: "Remove 'Pass/Fail'" }));
    expect(within(dialog).getByRole("checkbox", { name: "Show 'Screenshot'" })).toHaveFocus();
    // The last column: removing it focuses the previous one (Screenshot).
    await user.click(within(dialog).getByRole("checkbox", { name: "Show 'Action'" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove 'New column'" }));
    expect(within(dialog).getByRole("checkbox", { name: "Show 'Screenshot'" })).toHaveFocus();
  });
});
