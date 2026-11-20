// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { LiveRegionProvider, useAnnounce } from "./LiveRegion";

function Announcer({ message }: { message: string }) {
  const announce = useAnnounce();
  return <button onClick={() => announce(message)}>Announce</button>;
}

describe("LiveRegion", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces messages in a polite status region, again on repeat", async () => {
    const { container } = render(
      <LiveRegionProvider>
        <Announcer message="3 steps ready" />
      </LiveRegionProvider>,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");

    act(() => screen.getByRole("button").click());
    act(() => vi.advanceTimersByTime(100));
    expect(region).toHaveTextContent("3 steps ready");

    act(() => screen.getByRole("button").click());
    expect(region).toHaveTextContent("");
    act(() => vi.advanceTimersByTime(100));
    expect(region).toHaveTextContent("3 steps ready");

    vi.useRealTimers();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("throws outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Announcer message="x" />)).toThrow(/LiveRegionProvider/);
  });
});
