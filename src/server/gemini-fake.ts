// Lane A. Fake Gemini for GEMINI_FAKE=1 (E2E and CI). Scenario from the `fake-scenario` cookie.
import type { GeminiResponse } from "@/lib/schema";
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

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function isFakeMode(): boolean {
  return process.env.GEMINI_FAKE === "1";
}

/** Reads the `fake-scenario` cookie; "happy" when absent or unknown. */
export function scenarioFrom(request: Request): FakeScenario {
  void request;
  return notImplemented();
}

export async function fakeUploadAndWait(
  scenario: FakeScenario,
  mimeType: string,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  void scenario;
  void mimeType;
  void signal;
  return notImplemented();
}

export async function fakeGenerateSteps(
  scenario: FakeScenario,
  signal?: AbortSignal,
): Promise<GeminiResponse> {
  void scenario;
  void signal;
  return notImplemented();
}
