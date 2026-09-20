import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parseSceneCuts, segmentsFromCuts, pickMoments, slidingWindows, analyzeFootage, trimClip } from "../skills/shipreel/scripts/footage.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("parseSceneCuts reads pts_time from showinfo output", () => {
  const stderr = "[Parsed_showinfo_1 @ 0x1] n:   0 pts:  90000 pts_time:3.00000 duration:\n[Parsed_showinfo_1 @ 0x1] n:   1 pts: 150000 pts_time:5.0 duration:";
  assert.deepEqual(parseSceneCuts(stderr), [3, 5]);
});

test("segmentsFromCuts splits the recording and ignores cuts too close together", () => {
  assert.deepEqual(segmentsFromCuts([3, 3.2, 5, 8], 12.5), [
    { start: 0, end: 3 },
    { start: 3, end: 5 },
    { start: 5, end: 8 },
    { start: 8, end: 12.5 },
  ]);
});

test("pickMoments keeps the most active windows, skips idle, blank, and overlapping ones, and returns them in order", () => {
  // activity is the fraction of pixels that changed between frames (0-1)
  const candidates = [
    { start: 0, end: 3, activity: 0.0005, peak: 1, blank: false },
    { start: 3, end: 5, activity: 0.05, peak: 4.2, blank: false },
    { start: 4, end: 6, activity: 0.04, peak: 5, blank: false },
    { start: 5, end: 8, activity: 0.0001, peak: 6, blank: false },
    { start: 8, end: 10.5, activity: 0.08, peak: 9, blank: false },
    { start: 10.5, end: 12.5, activity: 0.3, peak: 11, blank: true },
  ];
  const moments = pickMoments(candidates, { count: 3, seconds: 2 });
  assert.deepEqual(moments.map((m) => [m.start, m.end]), [[3.2, 5], [8, 10]], "the 4-6 window overlaps the 3.2-5 pick, and idle windows never qualify");
  assert.ok(moments.every((m) => m.end - m.start <= 2 + 1e-9));
});

test("slidingWindows covers a long uncut segment with moment-length windows scored by changed pixels", () => {
  const frames = Array.from({ length: 200 }, (_, i) => ({ t: i / 20, value: i >= 120 && i < 160 ? 0.2 : 0 }));
  const windows = slidingWindows({ start: 0, end: 10 }, frames, { seconds: 2, step: 0.25 });
  assert.equal(windows[0].start, 0);
  assert.ok(windows.every((w) => w.end - w.start === 2 && w.end <= 10));
  const best = windows.reduce((a, b) => (b.activity > a.activity ? b : a));
  assert.equal(best.start, 6, "the window over the busy 6-8s stretch scores highest");
});

test("analyzeFootage finds the moving parts of a real recording", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-footage-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  try {
    const video = path.join(dir, "demo.mp4");
    // idle 3s -> moving 2s -> idle 3s -> moving 2.5s -> black 2s
    ff(
      "-f", "lavfi", "-i", "color=gray:size=640x360:rate=30:duration=3",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=2",
      "-f", "lavfi", "-i", "color=white:size=640x360:rate=30:duration=3",
      "-f", "lavfi", "-i", "mandelbrot=size=640x360:rate=30,trim=duration=2.5",
      "-f", "lavfi", "-i", "color=black:size=640x360:rate=30:duration=2",
      "-filter_complex", "[0:v]setsar=1[a];[1:v]setsar=1[b];[2:v]setsar=1[c];[3:v]setsar=1,format=yuv420p[d];[4:v]setsar=1[e];[a][b][c][d][e]concat=n=5:v=1[v]",
      "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
    );
    const result = analyzeFootage(video, { count: 2, seconds: 2 });
    assert.ok(Math.abs(result.duration - 12.5) < 0.2, String(result.duration));
    assert.equal(result.moments.length, 2);
    const [first, second] = result.moments;
    assert.ok(first.start >= 2.9 && first.end <= 5.1, JSON.stringify(first));
    assert.ok(second.start >= 7.9 && second.end <= 10.6, JSON.stringify(second));

    const uncut = path.join(dir, "uncut.mp4");
    // One continuous shot: a static screen with a busy stretch from 4s to 6s (no hard cuts to find).
    ff(
      "-f", "lavfi", "-i", "color=white:size=640x360:rate=30:duration=10",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30:duration=10",
      "-filter_complex", "[0:v][1:v]overlay=240:130:enable='between(t,4,6)'[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", uncut,
    );
    const shot = analyzeFootage(uncut, { count: 1, seconds: 2 });
    assert.equal(shot.moments.length, 1, "finds a moment even without scene cuts");
    assert.ok(shot.moments[0].start >= 3.5 && shot.moments[0].end <= 6.5, JSON.stringify(shot.moments[0]));

    const clip = path.join(dir, "moment-1.mp4");
    trimClip(video, first, clip);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", clip], { encoding: "utf8" }));
    assert.ok(Math.abs(Number(probe.format.duration) - (first.end - first.start)) < 0.15);
    assert.equal(probe.streams.filter((s) => s.codec_type === "audio").length, 0, "clips are muted; audio lives in <audio> elements");
    assert.equal(probe.streams[0].pix_fmt, "yuv420p");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
