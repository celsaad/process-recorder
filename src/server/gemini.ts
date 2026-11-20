// Lane A. Gemini Files API + generateContent (D4, D5). Server only.
import type { GoogleGenAI } from "@google/genai";
import type { AppError } from "@/lib/errors";
import type { GeminiResponse } from "@/lib/schema";

export type UploadedFile = { fileName: string; mimeType: string };

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function getClient(): GoogleGenAI {
  return notImplemented();
}

/** Uploads a temp file and polls until ACTIVE (2 min timeout). */
export async function uploadAndWait(
  path: string,
  mimeType: string,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  void path;
  void mimeType;
  void signal;
  return notImplemented();
}

/** finishReason checks, zod validation, one retry with the error fed back, low thinking. */
export async function generateSteps(fileName: string, signal?: AbortSignal): Promise<GeminiResponse> {
  void fileName;
  void signal;
  return notImplemented();
}

export async function deleteFile(fileName: string): Promise<void> {
  void fileName;
  return notImplemented();
}

export function classifyGeminiError(e: unknown): AppError {
  void e;
  return notImplemented();
}
