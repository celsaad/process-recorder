// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { Dropzone } from "./Dropzone";
import { EmptyState } from "./EmptyState";

const file = () => new File(["x"], "demo.mp4", { type: "video/mp4" });

describe("Dropzone", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is a real button; Enter and Space open the file input", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const user = userEvent.setup();
    const { container } = render(<Dropzone onFile={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Choose a recording" });
    expect(button).toHaveAccessibleDescription(/MP4, MOV or WebM/);

    button.focus();
    await user.keyboard("{Enter}");
    expect(click).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(click).toHaveBeenCalledTimes(2);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("calls onFile for a chosen file and for a dropped file", async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<Dropzone onFile={onFile} />);
    const f = file();
    await user.upload(screen.getByTestId("file-input"), f);
    expect(onFile).toHaveBeenLastCalledWith(f);

    const zone = screen.getByTestId("dropzone");
    const dropped = file();
    fireEvent.dragEnter(zone, { dataTransfer: { files: [dropped], types: ["Files"] } });
    expect(screen.getByText("Drop the recording to upload it")).toBeInTheDocument();
    fireEvent.drop(zone, { dataTransfer: { files: [dropped], types: ["Files"] } });
    expect(onFile).toHaveBeenLastCalledWith(dropped);
    expect(onFile).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Choose a recording" })).toBeInTheDocument();
  });

  it("disabled blocks both the picker and a drop, and keeps the button focusable", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    const onFile = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Dropzone onFile={onFile} disabled />);
    const button = screen.getByRole("button", { name: "Choose a recording" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(/already being processed/);

    await user.click(button);
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveFocus();
    expect(click).not.toHaveBeenCalled();

    fireEvent.drop(screen.getByTestId("dropzone"), { dataTransfer: { files: [file()], types: ["Files"] } });
    expect(onFile).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe("EmptyState", () => {
  it("shows the heading, limits, how it works and the privacy line", async () => {
    const { container } = render(<EmptyState onFile={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Turn a screen recording into a test script");
    expect(screen.getByText(/up to 10 minutes · 500 MB/)).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText(/sent to Google Gemini/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
