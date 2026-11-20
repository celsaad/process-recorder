import { z } from "zod";
import { ERROR_KINDS } from "./errors";
import type { AnalyzeResponse, Rect, SerializedAppError, UploadEvent } from "./types";

// ---------- Gemini response (D5) ----------

/** `[ymin, xmin, ymax, xmax]` in 0–1000, or `[]`. Any other array becomes `[]`
 *  instead of failing the whole response: a bad box shouldn't cost the user their steps. */
const Box2dSchema = z
  .array(z.unknown())
  .transform((box): number[] =>
    box.length === 4 &&
    box.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000)
      ? (box as number[])
      : [],
  );

export const GeminiStepSchema = z.object({
  action: z.string(),
  description: z.string(),
  expectedResult: z.string(),
  timestamp: z.string(),
  box_2d: Box2dSchema,
});

export const GeminiResponseSchema = z.object({
  isScreenRecording: z.boolean(),
  rejectionReason: z.string(),
  processTitle: z.string(),
  steps: z.array(GeminiStepSchema),
});

export type GeminiStep = z.infer<typeof GeminiStepSchema>;
export type GeminiResponse = z.infer<typeof GeminiResponseSchema>;

// ---------- HTTP contract (D4) ----------

export const SerializedAppErrorSchema = z.object({
  kind: z.enum(ERROR_KINDS),
  detail: z.string().optional(),
}) satisfies z.ZodType<SerializedAppError>;

export const UploadEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.enum(["received", "sending_to_gemini", "gemini_processing"]),
  }),
  z.object({ type: z.literal("ready"), fileName: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal("error"), error: SerializedAppErrorSchema }),
]) satisfies z.ZodType<UploadEvent>;

const unit = z.number().min(0).max(1);
export const RectSchema = z.object({ x: unit, y: unit, w: unit, h: unit }) satisfies z.ZodType<Rect>;

export const RawStepSchema = z.object({
  action: z.string(),
  description: z.string(),
  expectedResult: z.string(),
  timestampSec: z.number().min(0),
  box: RectSchema.nullable(),
});

export const AnalyzeResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), processTitle: z.string(), steps: z.array(RawStepSchema) }),
  z.object({ ok: z.literal(false), error: SerializedAppErrorSchema }),
]) satisfies z.ZodType<AnalyzeResponse>;
