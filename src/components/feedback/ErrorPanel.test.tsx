// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { ERROR_COPY, ERROR_KINDS } from "@/lib/errors";
import { ErrorDetail, ErrorPanel } from "./ErrorPanel";
import { Banner } from "./Banner";

afterEach(cleanup);

describe("ErrorPanel", () => {
  it("focuses its h1 on mount and fills the copy from ERROR_COPY with the detail", async () => {
    const { container } = render(<ErrorPanel error={{ kind: "too_long", detail: "12:40" }} onPrimary={vi.fn()} />);
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(ERROR_COPY.too_long.title);
    expect(heading).toHaveFocus();
    expect(screen.getByText("This video is 12:40. Recordings must be 10 minutes or less.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another file" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("renders children in the detail area and never uses role=alert", async () => {
    const onPrimary = vi.fn();
    const onSecondary = vi.fn();
    const { container } = render(
      <ErrorPanel error={{ kind: "rate_limited" }} onPrimary={onPrimary} onSecondary={onSecondary}>
        <ErrorDetail>Your video is already uploaded. Retry won&apos;t upload it again.</ErrorDetail>
      </ErrorPanel>,
    );
    expect(screen.getByTestId("error-detail")).toHaveTextContent("already uploaded");
    expect(container.querySelector("[role=alert],[role=status],[aria-live]")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await user.click(screen.getByRole("button", { name: "Choose another file" }));
    expect(onPrimary).toHaveBeenCalledOnce();
    expect(onSecondary).toHaveBeenCalledOnce();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no action button for missing_api_key and refocuses when the error changes", () => {
    const { rerender } = render(<ErrorPanel error={{ kind: "missing_api_key" }} onPrimary={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
    screen.getByRole("heading").blur();
    rerender(<ErrorPanel error={{ kind: "network" }} onPrimary={vi.fn()} />);
    expect(screen.getByRole("heading", { name: ERROR_COPY.network.title })).toHaveFocus();
  });

  it.each(ERROR_KINDS)("renders %s", (kind) => {
    render(<ErrorPanel error={{ kind }} onPrimary={vi.fn()} />);
    expect(screen.getByRole("heading", { name: ERROR_COPY[kind].title })).toBeInTheDocument();
  });
});

describe("Banner", () => {
  it("renders both tones without a role of its own; the action is a button", async () => {
    const onClick = vi.fn();
    const { container } = render(
      <>
        <Banner tone="warning" action={{ label: "Export to Word", onClick }}>
          Changes won&apos;t survive a refresh. Export now.
        </Banner>
        <Banner tone="info">This recording is 5:26.</Banner>
      </>,
    );
    expect(container.querySelector("[role],[aria-live]")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Export to Word" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(await axe(container)).toHaveNoViolations();
  });
});
