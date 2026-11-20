// DELETE /api/file?name=<fileName> → 204. Best effort: Gemini also expires files after 48 h (D4).
import { geminiFor } from "@/server/gemini";
import { isValidFileName } from "@/server/http";

export async function DELETE(request: Request): Promise<Response> {
  const name = new URL(request.url).searchParams.get("name");
  if (!isValidFileName(name)) return new Response(null, { status: 400 });
  try {
    await geminiFor(request).deleteFile(name);
  } catch {
    // Already gone, expired, or no key: nothing the client can do about it.
  }
  return new Response(null, { status: 204 });
}
