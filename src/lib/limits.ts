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

export function isLongVideo(sec: number): boolean {
  return sec > SOFT_DURATION_SEC;
}
