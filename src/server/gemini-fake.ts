// Lane A. Fake Gemini for GEMINI_FAKE=1 (E2E and CI). Scenario from the `fake-scenario` cookie.
import { AppError } from "@/lib/errors";
import { GeminiResponseSchema, type GeminiResponse } from "@/lib/schema";
import type { UploadStage } from "@/lib/types";
import recorded from "./__fixtures__/gemini-response.json";
import type { UploadedFile } from "./gemini";

export const FAKE_SCENARIOS = [
  "happy",
  "no_steps",
  "not_screen_recording",
  "rate_limited",
  "bad_model_output",
  "gemini_failed",
  "slow",
] as const;
export type FakeScenario = (typeof FAKE_SCENARIOS)[number];

export const FAKE_COOKIE = "fake-scenario";
/** Per-stage delay: short normally, 10 s in `slow` (long enough to click Cancel). */
const delayFor = (scenario: FakeScenario) => (scenario === "slow" ? 10_000 : 150);

/**
 * What the fake serves. Built from the recorded real response, but with four steps whose
 * timestamps fit inside Lane G's ~20 s `e2e/fixtures/tiny.webm`, and the title the
 * happy-path spec expects in the export filename (create-a-purchase-order.docx).
 */
export const FAKE_RESPONSE: GeminiResponse = GeminiResponseSchema.parse({
  ...recorded,
  processTitle: "Create a purchase order",
  steps: recorded.steps.slice(0, 4).map((s, i) => ({
    ...s,
    timestamp: ["00:02", "00:06", "00:10", "00:15"][i],
  })),
});

export const FAKE_REJECTION_REASON =
  "The video shows a person talking to the camera, not a computer screen.";

let warned = false;

/** True when GEMINI_FAKE=1. Warns once per process, so a leftover flag shows up in the logs. */
export function isFakeMode(): boolean {
  const fake = process.env.GEMINI_FAKE === "1";
  if (fake && !warned) {
    warned = true;
    console.warn("[process-recorder] GEMINI_FAKE=1: serving the fake Gemini backend, no real analysis.");
  }
  return fake;
}

function isScenario(value: string): value is FakeScenario {
  return (FAKE_SCENARIOS as readonly string[]).includes(value);
}

/** Reads the `fake-scenario` cookie; "happy" when absent or unknown. */
export function scenarioFrom(request: Request): FakeScenario {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === FAKE_COOKIE) {
      const value = decodeURIComponent(rest.join("=")).trim();
      return isScenario(value) ? value : "happy";
    }
  }
  return "happy";
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export async function fakeUploadAndWait(
  scenario: FakeScenario,
  mimeType: string,
  signal?: AbortSignal,
  onStage?: (stage: UploadStage) => void,
): Promise<UploadedFile> {
  await wait(delayFor(scenario), signal); // "sending to Gemini"
  onStage?.("gemini_processing");
  await wait(delayFor(scenario), signal);
  if (scenario === "gemini_failed") throw new AppError("gemini_failed");
  return { fileName: `files/fake-${crypto.randomUUID()}`, mimeType };
}

export async function fakeGenerateSteps(
  scenario: FakeScenario,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  await wait(delayFor(scenario), signal);
  switch (scenario) {
    case "rate_limited":
      throw new AppError("rate_limited");
    case "bad_model_output":
      throw new AppError("bad_model_output");
    case "no_steps":
      return { ...FAKE_RESPONSE, steps: [] };
    case "not_screen_recording":
      return {
        isScreenRecording: false,
        rejectionReason: FAKE_REJECTION_REASON,
        processTitle: "",
        steps: [],
      };
    default:
      return structuredClone(FAKE_RESPONSE);
  }
}

export async function fakeDeleteFile(fileName: string): Promise<void> {
  void fileName;
}
