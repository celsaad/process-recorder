// POST /api/analyze { fileName } → AnalyzeResponse (D4, D5). See IMPLEMENTATION.md, "HTTP behaviour".
import { AppError } from "@/lib/errors";
import { cleanText, normalizeSteps } from "@/lib/normalize";
import { classifyGeminiError, geminiFor } from "@/server/gemini";
import { UNTITLED_PROCESS, analyzeError, analyzeJson, isValidFileName } from "@/server/http";

export async function POST(request: Request): Promise<Response> {
  let fileName: unknown;
  try {
    fileName = ((await request.json()) as { fileName?: unknown } | null)?.fileName;
  } catch {
    fileName = undefined;
  }
  // A name we can't use means the client has to upload again, which is what file_expired does.
  if (!isValidFileName(fileName)) return analyzeError(new AppError("file_expired"), 400);

  try {
    const gemini = geminiFor(request);
    const parsed = await gemini.generateSteps(fileName, request.signal);
    if (!parsed.isScreenRecording) {
      const reason = parsed.rejectionReason.trim();
      return analyzeError(new AppError("not_screen_recording", reason || undefined));
    }
    return analyzeJson({
      ok: true,
      processTitle: cleanText(parsed.processTitle) || UNTITLED_PROCESS,
      steps: normalizeSteps(parsed),
    });
  } catch (e) {
    const error = request.signal.aborted ? new AppError("cancelled") : classifyGeminiError(e);
    return analyzeError(error);
  }
}
