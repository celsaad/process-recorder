// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { RESULTS_HEADING_ID, type ConfirmKind } from "@/lib/ui-contracts";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function Harness({ kind, onResolve }: { kind: ConfirmKind; onResolve: (ok: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Start new
      </button>
      <ConfirmDialog
        open={open}
        kind={kind}
        onResolve={(ok) => {
          onResolve(ok);
          setOpen(false);
        }}
      />
    </>
  );
}

describe("ConfirmDialog", () => {
  it("traps focus, starts on Cancel, Esc resolves false and focus returns to the trigger", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<Harness kind="start_new" onResolve={onResolve} />);
    const trigger = screen.getByRole("button", { name: "Start new" });
    await user.click(trigger);

    const dialog = screen.getByRole("alertdialog", { name: "Start new?" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Delete and start new" });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus(); // wrapped: focus is trapped
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    const openViolations = await axe(document.body);

    await user.keyboard("{Escape}");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(openViolations).toHaveNoViolations();
  });

  it("the destructive button resolves true exactly once", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Harness kind="replace" onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Start new" }));
    expect(screen.getByRole("alertdialog", { name: "Replace current project?" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep current project" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("with no focused opener (e.g. a drop), focus falls back to the results heading", async () => {
    function NoOpener({ open, onResolve }: { open: boolean; onResolve: (ok: boolean) => void }) {
      return (
        <main>
          <h1 id={RESULTS_HEADING_ID} tabIndex={-1}>
            Create a purchase order
          </h1>
          <button type="button">Other</button>
          <ConfirmDialog open={open} kind="replace" onResolve={onResolve} />
        </main>
      );
    }
    const user = userEvent.setup();
    const onResolve = vi.fn();
    const { container, rerender } = render(<NoOpener open={false} onResolve={onResolve} />);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    rerender(<NoOpener open onResolve={onResolve} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep current project" })).toHaveFocus());
    await user.keyboard("{Escape}");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(false);
    act(() => rerender(<NoOpener open={false} onResolve={onResolve} />));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Create a purchase order" })).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });
});
