// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportButton } from "@/components/project/ExportButton";
import { ProjectTitle } from "@/components/project/ProjectTitle";
import { AppHeader, HEADER_HEIGHT_VAR } from "./AppHeader";
import { AppShell } from "./AppShell";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Editor({ onExport }: { onExport: () => Promise<void> }) {
  return (
    <AppShell>
      <AppHeader
        saveStatus="saved"
        onStartNew={() => {}}
        title={<ProjectTitle value="Create a purchase order" onChange={() => {}} />}
        actions={<ExportButton onExport={onExport} />}
      />
      <main />
    </AppShell>
  );
}

describe("AppShell", () => {
  it("has exactly one aria-live region, also while the export-failed toast is open (D13)", async () => {
    const user = userEvent.setup();
    render(<Editor onExport={vi.fn().mockRejectedValue(new Error("boom"))} />);
    expect(document.querySelectorAll("[aria-live]")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Export to Word" }));
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(retry).toHaveFocus();
    const live = document.querySelectorAll("[aria-live]");
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveAttribute("data-testid", "live-region");
  });
});

describe("AppHeader --header-height", () => {
  it("tracks the header's real height on <html> and removes it on unmount", () => {
    let fire!: () => void;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    let height = 64;
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ height }) as DOMRect,
    );
    const root = document.documentElement;
    const { unmount } = render(<AppHeader saveStatus="idle" />);
    expect(root.style.getPropertyValue(HEADER_HEIGHT_VAR)).toBe("64px");

    height = 119.5; // wrapped onto two rows
    act(() => fire());
    expect(root.style.getPropertyValue(HEADER_HEIGHT_VAR)).toBe("120px");

    unmount();
    expect(root.style.getPropertyValue(HEADER_HEIGHT_VAR)).toBe("");
    rect.mockRestore();
  });
});
