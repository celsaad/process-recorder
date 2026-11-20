// Lane A. Gemini Files API + generateContent (D4, D5). Server only.
import {
  ApiError,
  FileState,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type Content,
  type GenerateContentConfig,
} from "@google/genai";
import { ZodError } from "zod";
import { AppError, toAppError } from "@/lib/errors";
import { GeminiResponseSchema, type GeminiResponse } from "@/lib/schema";
import type { ErrorKind, UploadStage } from "@/lib/types";
import {
  fakeDeleteFile,
  fakeGenerateSteps,
  fakeUploadAndWait,
  isFakeMode,
  scenarioFrom,
} from "./gemini-fake";
import { PROMPT, RESPONSE_SCHEMA } from "./prompt";

export type UploadedFile = { fileName: string; mimeType: string };

export const DEFAULT_MODEL = "gemini-3.8-flash";
export const POLL_INTERVAL_MS = 2000;
export const POLL_TIMEOUT_MS = 2 * 60 * 1000;

/** The model stopped for a reason other than STOP. `classifyGeminiError` maps it. */
export class FinishReasonError extends Error {
  constructor(readonly finishReason: string) {
    super(`Gemini finished with ${finishReason}`);
    this.name = "FinishReasonError";
  }
}

let client: { key: string; ai: GoogleGenAI } | null = null;

/** Throws `missing_api_key` when GEMINI_API_KEY is unset (the SDK would only fail later, vaguely). */
export function getClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new AppError("missing_api_key");
  if (client?.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

export function modelName(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Uploads a temp file and polls until ACTIVE (2 min timeout).
 * `onStage("gemini_processing")` fires once the bytes are with Gemini and polling starts.
 * If processing fails, times out or is aborted, the Gemini file is deleted (best effort).
 */
export async function uploadAndWait(
  path: string,
  mimeType: string,
  signal?: AbortSignal,
  onStage?: (stage: UploadStage) => void,
): Promise<UploadedFile> {
  const ai = getClient();
  let file = await ai.files.upload({ file: path, config: { mimeType, abortSignal: signal } });
  const name = file.name;
  if (!name) throw new AppError("gemini_failed");
  onStage?.("gemini_processing");

  try {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (file.state === FileState.PROCESSING || file.state === undefined) {
      if (Date.now() > deadline) throw new AppError("gemini_failed", undefined, { cause: "poll timeout" });
      await sleep(POLL_INTERVAL_MS, signal);
      file = await ai.files.get({ name, config: { abortSignal: signal } });
    }
    if (file.state !== FileState.ACTIVE) {
      throw new AppError("gemini_failed", undefined, { cause: file.error ?? file.state });
    }
    return { fileName: name, mimeType: file.mimeType ?? mimeType };
  } catch (e) {
    void deleteFile(name).catch(() => {});
    throw e;
  }
}

function thinkingConfig(model: string): GenerateContentConfig["thinkingConfig"] {
  // Gemini 2.x takes a token budget; 3.x takes a level. Low thinking: this is extraction (D5).
  return /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: ThinkingLevel.LOW };
}

function validationMessage(e: unknown): string {
  if (e instanceof ZodError) {
    return e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}

/** One generateContent call → parsed response, or a thrown error for classifyGeminiError. */
async function generateOnce(
  ai: GoogleGenAI,
  model: string,
  contents: Content[],
  signal?: AbortSignal,
): Promise<{ parsed: GeminiResponse; text: string }> {
  const res = await ai.models.generateContent({
    model,
    contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: thinkingConfig(model),
      abortSignal: signal,
    },
  });
  if (res.promptFeedback?.blockReason) throw new FinishReasonError(FinishReason.SAFETY);
  const finishReason = res.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== FinishReason.STOP) throw new FinishReasonError(finishReason);
  const text = res.text?.trim();
  if (!text) throw new FinishReasonError("EMPTY");
  return { parsed: GeminiResponseSchema.parse(JSON.parse(text)), text };
}

/** Invalid JSON, a zod failure or truncation: worth one retry with the error fed back (D5). */
function isRetryableOutput(e: unknown): boolean {
  return (
    e instanceof SyntaxError ||
    e instanceof ZodError ||
    (e instanceof FinishReasonError && e.finishReason === FinishReason.MAX_TOKENS)
  );
}

/** finishReason checks, zod validation, one retry with the error fed back, low thinking. */
export async function generateSteps(fileName: string, signal?: AbortSignal): Promise<GeminiResponse> {
  const ai = getClient();
  const model = modelName();
  try {
    const file = await ai.files.get({ name: fileName, config: { abortSignal: signal } });
    if (file.state === FileState.FAILED) throw new AppError("gemini_failed");
    if (!file.uri) throw new AppError("file_expired");

    const video = { fileData: { fileUri: file.uri, mimeType: file.mimeType } };
    const first: Content[] = [{ role: "user", parts: [video, { text: PROMPT }] }];
    try {
      return (await generateOnce(ai, model, first, signal)).parsed;
    } catch (e) {
      if (!isRetryableOutput(e)) throw e;
      const retry: Content[] = [
        ...first,
        {
          role: "user",
          parts: [
            {
              text:
                `Your previous response was not valid: ${validationMessage(e)}. ` +
                "Reply again with only JSON that matches the response schema exactly. " +
                "Keep each description short.",
            },
          ],
        },
      ];
      return (await generateOnce(ai, model, retry, signal)).parsed;
    }
  } catch (e) {
    throw classifyGeminiError(e);
  }
}

export async function deleteFile(fileName: string): Promise<void> {
  await getClient().files.delete({ name: fileName });
}

/**
 * Stops that mean Gemini declined the content (D10 `gemini_blocked`: retrying won't help).
 * "EMPTY" is our marker for a response with no text. Every other non-STOP reason (OTHER,
 * MALFORMED_RESPONSE, one added in a later SDK…) is `gemini_failed`, which is retryable.
 */
const BLOCKED_REASONS: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.RECITATION,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
  FinishReason.IMAGE_RECITATION,
  FinishReason.MODEL_ARMOR,
  "EMPTY",
]);

function finishReasonKind(reason: string): ErrorKind {
  if (reason === FinishReason.MAX_TOKENS) return "bad_model_output";
  return BLOCKED_REASONS.has(reason) ? "gemini_blocked" : "gemini_failed";
}

const EXPIRED_MESSAGE = /may not exist|not found/i;

export function classifyGeminiError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof FinishReasonError) {
    return new AppError(finishReasonKind(e.finishReason), undefined, { cause: e });
  }
  if (e instanceof SyntaxError || e instanceof ZodError) {
    return new AppError("bad_model_output", undefined, { cause: e });
  }
  if (e instanceof ApiError) {
    if (e.status === 429) return new AppError("rate_limited", undefined, { cause: e });
    // An expired or unknown file comes back as 404, or as 403 "…or it may not exist".
    if (e.status === 404 || (e.status === 403 && EXPIRED_MESSAGE.test(e.message))) {
      return new AppError("file_expired", undefined, { cause: e });
    }
    if (e.status === 401 || /API key not valid/i.test(e.message)) {
      return new AppError("missing_api_key", undefined, { cause: e });
    }
    return new AppError("gemini_failed", undefined, { cause: e });
  }
  const app = toAppError(e);
  // A dropped connection between us and Gemini is a Gemini failure, not the user's network.
  return app.kind === "network" ? new AppError("gemini_failed", undefined, { cause: e }) : app;
}

// ---------- Real or fake, per request ----------

export type GeminiBackend = {
  uploadAndWait: typeof uploadAndWait;
  generateSteps: typeof generateSteps;
  deleteFile: typeof deleteFile;
};

/**
 * The backend for this request. With GEMINI_FAKE=1 it is the fake, using the
 * `fake-scenario` cookie; otherwise the real SDK. Throws `missing_api_key` for the
 * real backend when the key is unset, so routes can reject before doing any work.
 */
export function geminiFor(request: Request): GeminiBackend {
  if (isFakeMode()) {
    const scenario = scenarioFrom(request);
    return {
      uploadAndWait: (_path, mimeType, signal, onStage) =>
        fakeUploadAndWait(scenario, mimeType, signal, onStage),
      generateSteps: (_fileName, signal) => fakeGenerateSteps(scenario, signal),
      deleteFile: fakeDeleteFile,
    };
  }
  getClient();
  return { uploadAndWait, generateSteps, deleteFile };
}
