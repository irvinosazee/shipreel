import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORMAT_SIZES,
  parseFps,
  parseVolumedetect,
  parseEbur128,
  parseSignalstats,
  parsePsnr,
  atomOrder,
  evaluate,
  probeVideo,
  verifyRender,
} from "../skills/brag/scripts/verify_render.mjs";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test("parsers read ffmpeg and ffprobe output", () => {
  assert.equal(parseFps("30000/1001").toFixed(2), "29.97");
  assert.equal(parseFps("0/0"), null);
  assert.deepEqual(parseVolumedetect("[Parsed_volumedetect_0] mean_volume: -31.4 dB\n[x] max_volume: -8.0 dB"), {
    meanDb: -31.4,
    maxDb: -8,
  });
  assert.equal(parseEbur128("  Integrated loudness:\n    I:         -27.2 LUFS\n    Threshold: -37.2 LUFS"), -27.2);
  assert.equal(parseEbur128("no audio"), null);
  assert.deepEqual(parseSignalstats("lavfi.signalstats.YMIN=33\nlavfi.signalstats.YAVG=36.1\nlavfi.signalstats.YMAX=44"), {
    ymin: 33,
    yavg: 36.1,
    ymax: 44,
  });
  assert.equal(parsePsnr("[Parsed_psnr_2] PSNR y:44.1 u:49.2 v:50.0 average:44.756619 min:44.7 max:44.7"), 44.756619);
  assert.equal(parsePsnr("[Parsed_psnr_2] PSNR y:inf u:inf v:inf average:inf min:inf max:inf"), Infinity);
  assert.equal(parsePsnr("nothing"), null);
});

function atom(type, size = 16) {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(size, 0);
  buf.write(type, 4, "latin1");
  return buf;
}

test("atomOrder reports whether moov precedes mdat (faststart)", () => {
  assert.deepEqual(atomOrder(Buffer.concat([atom("ftyp"), atom("moov"), atom("mdat")])), ["ftyp", "moov"]);
  assert.deepEqual(atomOrder(Buffer.concat([atom("ftyp"), atom("free"), atom("mdat")])), ["ftyp", "free", "mdat"]);
});

const goodFacts = {
  sizeBytes: 3_000_000,
  duration: 21.02,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: "h264",
  pixFmt: "yuv420p",
  hasAudio: true,
  faststart: true,
  maxVolumeDb: -3,
  integratedLufs: -14.5,
  frame0: { ymin: 0, yavg: 80, ymax: 255 },
  posterPsnr: 48,
};

test("evaluate passes a well-formed landscape render", () => {
  const { errors, warnings } = evaluate(goodFacts, { format: "landscape", poster: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
});

test("evaluate flags duration, size, silence, and missing audio as errors", () => {
  const { errors } = evaluate(
    { ...goodFacts, duration: 31, width: 1280, height: 720, maxVolumeDb: -91 },
    { format: "landscape" },
  );
  assert.equal(errors.length, 3);
  assert.match(errors.join("\n"), /31\.0s/);
  assert.match(errors.join("\n"), /1280x720/);
  assert.match(errors.join("\n"), /silent/);

  const noAudio = evaluate({ ...goodFacts, hasAudio: false, maxVolumeDb: null, integratedLufs: null }, {});
  assert.match(noAudio.errors.join("\n"), /no audio stream/);
  assert.deepEqual(evaluate({ ...goodFacts, hasAudio: false }, { audio: false }).errors, []);
});

test("evaluate: poster not baked into frame 0 is an error when a poster exists", () => {
  // Measured on real brags: unbaked frame 0 vs poster scored 10.5–21.7 dB, baked 44.8–52.3 dB.
  const { errors, errorCodes } = evaluate({ ...goodFacts, posterPsnr: 21.7 }, { poster: true });
  assert.match(errors.join("\n"), /frame 0/);
  assert.deepEqual(errorCodes, ["poster-not-baked"]);
});

test("evaluate warns about audio sample rates above 48 kHz", () => {
  const { warnings, warningCodes } = evaluate({ ...goodFacts, audioSampleRate: 96000 }, {});
  assert.deepEqual(warningCodes, ["audio-sample-rate"]);
  assert.match(warnings[0], /96 kHz/);
  assert.deepEqual(evaluate({ ...goodFacts, audioSampleRate: 48000 }, {}).warningCodes, []);
});

test("evaluate returns one stable code per message", () => {
  const result = evaluate({ ...goodFacts, duration: 40, integratedLufs: -30, faststart: false }, {});
  assert.deepEqual(result.errorCodes, ["duration"]);
  assert.deepEqual(result.warningCodes, ["loudness", "no-faststart"]);
  assert.equal(result.errors.length, result.errorCodes.length);
  assert.equal(result.warnings.length, result.warningCodes.length);
});

test("evaluate: blank frame 0, quiet mix, and delivery issues are warnings", () => {
  const { errors, warnings } = evaluate(
    {
      ...goodFacts,
      frame0: { ymin: 222, yavg: 222, ymax: 222 },
      posterPsnr: null,
      integratedLufs: -27.2,
      faststart: false,
      pixFmt: "yuv444p",
      fps: 23.5,
      sizeBytes: 12 * 1024 * 1024,
    },
    { maxMb: 10 },
  );
  assert.deepEqual(errors, [`File is 12.0 MB, over the 10 MB budget.`]);
  const text = warnings.join("\n");
  assert.match(text, /Frame 0 is a flat/);
  assert.match(text, /-27\.2 LUFS/);
  assert.match(text, /faststart/);
  assert.match(text, /yuv444p/);
  assert.match(text, /23\.5 fps/);
});

test("format sizes cover landscape, vertical, square, and feed", () => {
  assert.deepEqual(FORMAT_SIZES.vertical, [1080, 1920]);
  assert.deepEqual(FORMAT_SIZES.feed, [1080, 1350]);
});

test("verifyRender end to end on generated clips", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-verify-"));
  const ff = (...args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
  try {
    const good = path.join(dir, "good.mp4");
    ff(
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", good,
    );
    const poster = path.join(dir, "brag.jpg");
    ff("-ss", "1", "-i", good, "-frames:v", "1", "-q:v", "2", poster);

    const expect = { minDuration: 1, maxDuration: 3, width: 320, height: 180 };
    const unbaked = verifyRender(good, { ...expect, posterPath: poster });
    assert.equal(unbaked.facts.hasAudio, true);
    assert.equal(unbaked.facts.audioSampleRate, 44100);
    assert.equal(unbaked.facts.faststart, true);
    assert.match(unbaked.errors.join("\n"), /frame 0/);

    const baked = path.join(dir, "baked.mp4");
    ff(
      "-i", good, "-i", poster,
      "-filter_complex", "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",
      "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", baked,
    );
    const ok = verifyRender(baked, { ...expect, posterPath: poster });
    assert.deepEqual(ok.errors, [], ok.errors.join("\n"));
    assert.ok(ok.facts.posterPsnr > 35, String(ok.facts.posterPsnr));

    const black = path.join(dir, "black.mp4");
    ff("-f", "lavfi", "-i", "color=black:size=320x180:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", black);
    const silent = verifyRender(black, expect);
    assert.match(silent.errors.join("\n"), /no audio stream/);
    assert.match(silent.warnings.join("\n"), /Frame 0 is a flat/);
    assert.equal(probeVideo(black).hasAudio, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI writes a JSON report", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "brag-verify-cli-"));
  try {
    const clip = path.join(dir, "clip.mp4");
    execFileSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", clip,
    ]);
    const script = fileURLToPath(new URL("../skills/brag/scripts/verify_render.mjs", import.meta.url));
    let status = 0;
    let stdout = "";
    try {
      stdout = execFileSync("node", [script, clip, "--json", "--no-audio", "--min", "0.5", "--max", "2", "--size", "320x180"], {
        encoding: "utf8",
      });
    } catch (error) {
      status = error.status;
      stdout = error.stdout;
    }
    const report = JSON.parse(stdout);
    assert.equal(status, 0, stdout);
    assert.equal(report.ok, true);
    writeFileSync(path.join(dir, "report.json"), stdout);
    assert.ok(readFileSync(path.join(dir, "report.json"), "utf8").includes('"facts"'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
