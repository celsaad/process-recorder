// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { Toaster } from "sonner";
import { RESULTS_HEADING_ID } from "@/lib/ui-contracts";
import { LiveRegionProvider } from "@/components/shell/LiveRegion";
import { AppHeader } from "@/components/shell/AppHeader";
import { ProjectTitle } from "./ProjectTitle";
import { ExportButton } from "./ExportButton";
import { NoSteps } from "./NoSteps";

afterEach(cleanup);

// jsdom lacks pointer capture; sonner calls it on pointerdown inside a toast (swipe-to-dismiss).
Element.prototype.setPointerCapture ??= () => {};

describe("ProjectTitle", () => {
  it("is a focusable h1 with the results id; Rename → Enter saves and focus returns to Rename", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<ProjectTitle value="Create a purchase order" onChange={onChange} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Create a purchase order" });
    expect(heading).toHaveAttribute("id", RESULTS_HEADING_ID);
    expect(heading).toHaveAttribute("tabindex", "-1");
    const viewViolations = await axe(container);

    await user.click(screen.getByRole("button", { name: "Rename process" }));
    const input = screen.getByRole("textbox", { name: "Process title" });
    expect(input).toHaveFocus();
    // The post-capture focus target still exists while renaming.
    expect(document.getElementById(RESULTS_HEADING_ID)).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById(RESULTS_HEADING_ID)).toContainElement(input);
    const renameViolations = await axe(container);
    await user.clear(input);
    await user.type(input, "Raise a PO{Enter}");
    expect(onChange).toHaveBeenCalledExactlyOnceWith("Raise a PO");
    expect(screen.getByRole("button", { name: "Rename process" })).toHaveFocus();
    expect(viewViolations).toHaveNoViolations();
    expect(renameViolations).toHaveNoViolations();
  });

  it("Esc cancels, and an empty title is not saved", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ProjectTitle value="Create a purchase order" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Rename process" }));
    await user.type(screen.getByRole("textbox"), " changed{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Create a purchase order" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Rename process" }));
    await user.clear(screen.getByRole("textbox"));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

function withShell(ui: React.ReactNode) {
  return (
    <LiveRegionProvider>
      {ui}
      <Toaster />
    </LiveRegionProvider>
  );
}

describe("ExportButton", () => {
  it("is aria-disabled and ignores clicks while busy", async () => {
    let finish!: () => void;
    const onExport = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const user = userEvent.setup();
    const { container } = render(withShell(<ExportButton onExport={onExport} />));
    const button = screen.getByRole("button", { name: "Export to Word" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveTextContent("Exporting…");
    expect(button).toHaveFocus();
    await user.click(button);
    expect(onExport).toHaveBeenCalledTimes(1);
    const busyViolations = await axe(container);
    await act(async () => finish());
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(busyViolations).toHaveNoViolations();
  });

  it("shows the export-failed toast with focus on Try again; Try again re-runs the export", async () => {
    const onExport = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    const { container } = render(withShell(<ExportButton onExport={onExport} />));
    await user.click(screen.getByRole("button", { name: "Export to Word" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByText(/couldn.t be created/)).toBeInTheDocument();
    await waitFor(() => expect(retry).toHaveFocus());
    // The toast renders inside sonner's region in this container; check it while it's open.
    const toastViolations = await axe(container);
    await user.click(retry);
    expect(onExport).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Try again" })).toBeNull());
    expect(screen.getByRole("button", { name: "Export to Word" })).toHaveFocus();
    expect(toastViolations).toHaveNoViolations();
  });
});

describe("NoSteps", () => {
  it("focuses its heading on mount and offers Add a step manually", async () => {
    const onAddStep = vi.fn();
    const { container } = render(<NoSteps onAddStep={onAddStep} />);
    expect(screen.getByRole("heading", { name: "No steps found" })).toHaveFocus();
    await userEvent.setup().click(screen.getByRole("button", { name: "Add a step manually" }));
    expect(onAddStep).toHaveBeenCalledOnce();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("AppHeader", () => {
  it("empty state: brand only, no save status or Start new", async () => {
    const { container } = render(<AppHeader saveStatus="idle" />);
    expect(screen.getByRole("banner")).toHaveTextContent("Process Recorder");
    expect(screen.queryByRole("button")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("editor: title on the left; save status, Start new and the actions on the right", async () => {
    const onStartNew = vi.fn();
    const { container, rerender } = render(
      withShell(
        <AppHeader saveStatus="saved" onStartNew={onStartNew}>
          <ProjectTitle value="Create a purchase order" onChange={vi.fn()} />
          <ExportButton onExport={vi.fn(async () => {})} />
        </AppHeader>,
      ),
    );
    const header = screen.getByRole("banner");
    expect(header.className).toMatch(/sticky/);
    expect(header).toHaveTextContent("Saved");
    const names = screen.getAllByRole("button").map((b) => b.textContent || b.getAttribute("aria-label"));
    expect(names).toEqual(["Rename process", "Start new", "Export to Word"]);
    await userEvent.setup().click(screen.getByRole("button", { name: "Start new" }));
    expect(onStartNew).toHaveBeenCalledOnce();
    const editorViolations = await axe(container);

    rerender(withShell(<AppHeader saveStatus="saving" onStartNew={onStartNew}><span>t</span></AppHeader>));
    expect(screen.getByRole("banner")).toHaveTextContent("Saving…");
    rerender(withShell(<AppHeader saveStatus="error" onStartNew={onStartNew}><span>t</span></AppHeader>));
    expect(screen.getByRole("banner")).toHaveTextContent("Not saved");
    expect(screen.getByRole("banner").querySelector("[aria-live],[role=status]")).toBeNull();
    expect(editorViolations).toHaveNoViolations();
  });
});
