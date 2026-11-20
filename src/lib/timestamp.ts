const SS = /^(\d+)(\.\d+)?$/;
const M_SS = /^(\d{1,2}):([0-5]\d)(\.\d+)?$/;
const H_MM_SS = /^(\d+):([0-5]\d):([0-5]\d)(\.\d+)?$/;

/** Parses `SS`, `M:SS`, `MM:SS`, `MM:SS.s` and `H:MM:SS` into seconds. Anything else → null. */
export function parseTimestamp(s: string): number | null {
  const t = s.trim();
  let m: RegExpExecArray | null;
  if ((m = SS.exec(t))) return Number(m[1] + (m[2] ?? ""));
  if ((m = M_SS.exec(t))) return Number(m[1]) * 60 + Number(m[2] + (m[3] ?? ""));
  if ((m = H_MM_SS.exec(t))) {
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] + (m[4] ?? ""));
  }
  return null;
}

/** 65 → "1:05", (65.34, 1) → "1:05.3", 3723 → "1:02:03". Negative / NaN → 0. */
export function formatTimestamp(sec: number, precision: 0 | 1 = 0): string {
  const safe = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const scale = precision === 1 ? 10 : 1;
  const units = Math.round(safe * scale); // whole seconds, or tenths
  const whole = Math.floor(units / scale);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const ss = String(s).padStart(2, "0") + (precision === 1 ? `.${units % 10}` : "");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Binary units, so MAX_BYTES (500 × 1024²) prints as "500 MB". 1.5 × 1024³ → "1.5 GB". */
export function formatBytes(n: number): string {
  let value = Number.isFinite(n) && n > 0 ? n : 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  let rounded = value < 10 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value);
  if (rounded >= 1024 && unit < UNITS.length - 1) {
    rounded = 1;
    unit++;
  }
  return `${rounded} ${UNITS[unit]}`;
}
