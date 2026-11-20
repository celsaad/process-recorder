// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { ConfirmKind } from "@/lib/ui-contracts";
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
    expect(await axe(document.body)).toHaveNoViolations();

    await user.keyboard("{Escape}");
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("the destructive button resolves true exactly once", async () => {
    const onResolve = vi.fn();
    const user = userEvent.setup();
    render(<Harness kind="replace" onResolve={onResolve} />);
    await user.click(screen.getByRole("button", { name: "Start new" }));
    expect(screen.getByRole("alertdialog", { name: "Replace current project?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep current project" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(onResolve).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
