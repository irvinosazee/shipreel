import { test } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import vm from "node:vm";

import { KITS, renderKit, highlightCode, browserBundle, installKits } from "../skills/shipreel/scripts/kits.mjs";

const theme = { bg: "#120b08", panel: "#1d1410", fg: "#f6eee8", muted: "#b9aaa0", accent: "#ff6a3d", font: "Geist", mono: "Geist Mono" };

function recorder() {
  const calls = [];
  const tl = {};
  for (const method of ["to", "from", "fromTo", "set"]) {
    tl[method] = (...args) => {
      calls.push([method, ...args]);
      return tl;
    };
  }
  return { tl, calls };
}

test("every kit is documented and renders scoped markup, CSS, and a build function", () => {
  assert.deepEqual(Object.keys(KITS).sort(), ["browser-frame", "code-editor", "cursor", "game-hud", "http-card", "phone-frame", "terminal"]);
  for (const [name, kit] of Object.entries(KITS)) {
    assert.ok(kit.description.length > 20, name);
    const out = renderKit(name, { id: `k-${name}`, at: 1, theme, props: kit.example });
    assert.match(out.html, new RegExp(`id="k-${name}"`), name);
    assert.ok(out.css.includes(`#k-${name}`), `${name} CSS is scoped to its id`);
    assert.doesNotMatch(out.html, /<script/, `${name} markup has no inline script`);
    assert.equal(typeof out.build, "function", name);
    const { tl, calls } = recorder();
    out.build(tl);
    assert.ok(calls.length > 0, `${name} adds tweens`);
    for (const call of calls) assert.equal(typeof call.at(-1), "number", `${name} ${call[0]} has an absolute position`);
    assert.ok(out.end > 1, `${name} reports when it finishes`);
  }
});

test("block-level lines inside <pre> are not also separated by newlines (no double spacing)", () => {
  for (const name of ["http-card", "code-editor"]) {
    const { html } = renderKit(name, { id: "d", at: 0, theme, props: KITS[name].example });
    assert.doesNotMatch(html, /<\/span>\n<span id="d-(line|code)-/, `${name} lines are adjacent`);
  }
});

test("window chrome text meets the 28px phone minimum", () => {
  for (const name of ["terminal", "http-card", "code-editor", "browser-frame"]) {
    const { css } = renderKit(name, { id: "w", at: 0, theme, props: KITS[name].example });
    const size = Number(css.match(/\.kit-bar \{[^}]*font-size: (\d+)px/)[1]);
    assert.ok(size >= 28, `${name} bar is ${size}px`);
  }
});

test("renderKit escapes content and rejects unknown kits", () => {
  const out = renderKit("terminal", { id: "t", at: 0, theme, props: { lines: [{ command: "echo <b>&" }] } });
  assert.match(out.html, /echo &lt;b&gt;&amp;/);
  assert.throws(() => renderKit("hologram", { id: "h", at: 0, theme, props: {} }), /Unknown kit "hologram"/);
});

test("terminal types each command with stepped width and shows output after it", () => {
  const out = renderKit("terminal", { id: "term", at: 2, theme, props: { lines: [{ command: "npx shipreel", output: ["rendering…", "done in 20s"] }], charSeconds: 0.05 } });
  const { tl, calls } = recorder();
  out.build(tl);
  const typing = calls.find((c) => c[0] === "fromTo" && c[1] === "#term-cmd-0");
  assert.deepEqual(typing[2], { width: "0ch" });
  assert.equal(typing[3].width, "12ch");
  assert.equal(typing[3].ease, "steps(12)");
  assert.equal(typing[4], 2.4, "typing starts after the window settles");
  const output = calls.find((c) => c[1] === "#term-out-0-0");
  assert.ok(output.at(-1) >= 2.4 + 8 * 0.05, "output appears after the command is typed");
});

test("http-card reveals the JSON response line by line and highlights the chosen key", () => {
  const out = renderKit("http-card", { id: "api", at: 0, theme, props: { method: "POST", path: "/v1/shipreel", status: 201, response: { id: "brg_42", url: "https://x.dev/v/42" }, highlight: "url" } });
  assert.match(out.html, /POST/);
  assert.match(out.html, /\/v1\/shipreel/);
  assert.match(out.html, /201/);
  assert.match(out.html, /class="kit-json-line kit-hl"[^>]*>[\s\S]*?&quot;url&quot;/);
  const { tl, calls } = recorder();
  out.build(tl);
  const lines = calls.filter((c) => /^#api-line-\d+$/.test(c[1]));
  assert.equal(lines.length, 4, "{ , id, url, }");
  const times = lines.map((c) => c.at(-1));
  assert.deepEqual(times, [...times].sort((a, b) => a - b), "lines reveal in order");
});

test("highlightCode colours strings, numbers, keywords, and comments without touching escaping", () => {
  const html = highlightCode(`const n = 42; // answer\nlog("a<b")`);
  assert.match(html, /<span class="kw">const<\/span>/);
  assert.match(html, /<span class="num">42<\/span>/);
  assert.match(html, /<span class="com">\/\/ answer<\/span>/);
  assert.match(html, /<span class="str">"a&lt;b"<\/span>/);
});

test("cursor moves between points with eased tweens and a ripple at each click", () => {
  const out = renderKit("cursor", { id: "cur", at: 1, theme, props: { points: [{ x: 100, y: 200 }, { x: 500, y: 900, click: true }, { x: 520, y: 1200, click: true }], moveSeconds: 0.6 } });
  const { tl, calls } = recorder();
  out.build(tl);
  const moves = calls.filter((c) => c[1] === "#cur" && c[0] === "to");
  assert.equal(moves.length, 2);
  assert.deepEqual([moves[0][2].x, moves[0][2].y], [500, 900]);
  assert.match(moves[0][2].ease, /^power2\.inOut$/);
  const ripples = calls.filter((c) => /^#cur-ripple-\d$/.test(c[1]));
  assert.equal(ripples.length, 2);
});

test("game-hud counts the score up with a seekable tween that writes whole numbers", () => {
  const out = renderKit("game-hud", { id: "hud", at: 0, theme, props: { score: 12450, health: 0.35, combo: "x12 COMBO" } });
  const { tl, calls } = recorder();
  out.build(tl);
  const count = calls.find((c) => c[1]?.__kitCounter);
  assert.ok(count, "counts through a plain object target");
  assert.equal(count[2].value, 12450);
  assert.equal(typeof count[2].onUpdate, "function");
  const el = { textContent: "" };
  globalThis.document = { getElementById: () => el };
  try {
    count[1].value = 6225.4;
    count[2].onUpdate();
    assert.equal(el.textContent, "6,225");
  } finally {
    delete globalThis.document;
  }
});

test("the installed browser bundle defines ShipreelKits and mounts a kit into a slot", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "shipreel-kits-"));
  try {
    const file = installKits(dir);
    assert.equal(file, path.join(dir, "assets", "shipreel-kits.js"));
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /^\s*(import|export)\b/m, "classic script, loadable from file://");

    const appended = [];
    const slot = { innerHTML: "" };
    const document = { head: { appendChild: (el) => appended.push(el) }, createElement: () => ({ textContent: "" }), getElementById: (id) => (id === "slot" ? slot : null) };
    const window = {};
    vm.runInNewContext(source, { window, document });
    assert.deepEqual(Object.keys(window.ShipreelKits).sort(), ["KITS", "highlightCode", "mount", "render"]);

    const { tl, calls } = recorder();
    const out = window.ShipreelKits.mount(tl, "slot", "terminal", { id: "t1", at: 1, theme, props: { lines: [{ command: "ls" }] } });
    assert.match(slot.innerHTML, /id="t1"/);
    assert.match(appended[0].textContent, /#t1/);
    assert.ok(calls.length > 0);
    assert.ok(out.end > 1);
    assert.throws(() => window.ShipreelKits.mount(tl, "missing", "terminal", { id: "x", at: 0, theme, props: {} }), /No element with id "missing"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("browserBundle refuses a core that imports modules", () => {
  assert.throws(() => browserBundle('import x from "y";\nexport const a = 1;'), /must not import/);
});
