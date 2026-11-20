// All size and duration limits (D16). Shared by the client and the server.

/** Over this, the video is accepted with a "longer recordings…" notice. */
export const SOFT_DURATION_SEC = 180;
/** Over this, the video is rejected as `too_long`. */
export const MAX_DURATION_SEC = 600;
export const MAX_BYTES = 500 * 1024 ** 2;

export const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type AcceptedType = (typeof ACCEPTED_TYPES)[number];
/** For `<input type="file" accept>`; some OSes report an empty MIME type for .mov. */
export const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".webm"] as const;

export function isAcceptedType(mimeType: string): mimeType is AcceptedType {
  return (ACCEPTED_TYPES as readonly string[]).includes(mimeType);
}

const TYPE_BY_EXTENSION: Record<(typeof ACCEPTED_EXTENSIONS)[number], AcceptedType> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};

/** MIME type for an accepted extension (case-insensitive), or null. */
export function inferVideoType(fileName: string): AcceptedType | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot).toLowerCase() as keyof typeof TYPE_BY_EXTENSION;
  return TYPE_BY_EXTENSION[ext] ?? null;
}

/** Some OSes (notably Windows for .mov) report an empty `File.type`. The server
 *  checks Content-Type, so give such files a type from their extension at the point
 *  they enter the app; the stored copy then re-uploads correctly too (file_expired). */
export function withVideoType(file: File): File {
  if (file.type) return file;
  const type = inferVideoType(file.name);
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file;
}

export function isLongVideo(sec: number): boolean {
  return sec > SOFT_DURATION_SEC;
}
