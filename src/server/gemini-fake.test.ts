import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSteps } from "@/lib/normalize";
import {
  FAKE_RESPONSE,
  FAKE_SCENARIOS,
  fakeGenerateSteps,
  fakeUploadAndWait,
  scenarioFrom,
} from "./gemini-fake";

const withCookie = (cookie: string) => new Request("http://x/", { headers: { cookie } });

describe("scenarioFrom", () => {
  it("reads the fake-scenario cookie among others", () => {
    expect(scenarioFrom(withCookie("a=1; fake-scenario=rate_limited; b=2"))).toBe("rate_limited");
  });

  it("defaults to happy when absent or unknown", () => {
    expect(scenarioFrom(new Request("http://x/"))).toBe("happy");
    expect(scenarioFrom(withCookie("fake-scenario=nonsense"))).toBe("happy");
  });

  it("knows every scenario", () => {
    for (const s of FAKE_SCENARIOS) expect(scenarioFrom(withCookie(`fake-scenario=${s}`))).toBe(s);
  });
});

describe("FAKE_RESPONSE", () => {
  it("fits inside the ~20 s E2E clip and has the expected title", () => {
    const steps = normalizeSteps(FAKE_RESPONSE);
    expect(FAKE_RESPONSE.processTitle).toBe("Create a purchase order");
    expect(steps.map((s) => s.timestampSec)).toEqual([2, 6, 10, 15]);
    expect(steps.every((s) => s.box !== null)).toBe(true);
  });
});

describe("fake backend", () => {
  it("happy: upload reports processing and returns a valid file name", async () => {
    const onStage = vi.fn();
    const file = await fakeUploadAndWait("happy", "video/webm", undefined, onStage);
    expect(file.fileName).toMatch(/^files\/[a-z0-9-]+$/);
    expect(file.mimeType).toBe("video/webm");
    expect(onStage).toHaveBeenCalledWith("gemini_processing");
    expect((await fakeGenerateSteps("happy")).steps).toHaveLength(4);
  });

  it("serves each error scenario", async () => {
    await expect(fakeUploadAndWait("gemini_failed", "video/mp4")).rejects.toMatchObject({ kind: "gemini_failed" });
    await expect(fakeGenerateSteps("rate_limited")).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(fakeGenerateSteps("bad_model_output")).rejects.toMatchObject({ kind: "bad_model_output" });
    expect((await fakeGenerateSteps("no_steps")).steps).toEqual([]);
    const notScreen = await fakeGenerateSteps("not_screen_recording");
    expect(notScreen.isScreenRecording).toBe(false);
    expect(notScreen.rejectionReason).not.toBe("");
  });

  it("slow: waits 10 s per stage and can be aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const done = fakeUploadAndWait("slow", "video/mp4", controller.signal);
    const assertion = expect(done).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(5000);
    controller.abort();
    await assertion;
    vi.useRealTimers();
  });
});

describe("isFakeMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns once per process when fake mode is first used, whatever NODE_ENV is", async () => {
    vi.resetModules(); // a fresh module, so the once-per-process flag starts unset
    const { isFakeMode } = await import("./gemini-fake");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");

    vi.stubEnv("GEMINI_FAKE", "");
    expect(isFakeMode()).toBe(false);
    expect(warn).not.toHaveBeenCalled();

    vi.stubEnv("GEMINI_FAKE", "1");
    expect(isFakeMode()).toBe(true);
    expect(isFakeMode()).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/GEMINI_FAKE=1/);
  });
});
