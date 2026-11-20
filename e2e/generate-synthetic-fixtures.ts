// Synthetic fixtures built with ffmpeg (no interviewer material). Run `pnpm e2e:fixture` first for
// tiny.webm, then `pnpm e2e:fixtures:synthetic`. Outputs are committed (about 1 MB in total).
import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const out = (name: string) => join(dir, name);

function ffmpeg(...args: string[]): void {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

// tiny.mp4: H.264 of tiny.webm.
ffmpeg(
  "-i", out("tiny.webm"),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  out("tiny.mp4"),
);

// Long test patterns: 320x180, 1 fps, tiny bitrate.
function pattern(name: string, seconds: number): void {
  ffmpeg(
    "-f", "lavfi", "-i", `testsrc=size=320x180:rate=1:duration=${seconds}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryslow", "-crf", "40",
    "-g", "60", "-movflags", "+faststart",
    out(name),
  );
}
pattern("long-5min.mp4", 300);
pattern("too-long-10m30.mp4", 630);

// corrupt.mp4: the first 4 KB of tiny.mp4, then random bytes.
const head = Buffer.alloc(4096);
const fd = openSync(out("tiny.mp4"), "r");
readSync(fd, head, 0, 4096, 0);
closeSync(fd);
writeFileSync(out("corrupt.mp4"), Buffer.concat([head, randomBytes(60 * 1024)]));
