/**
 * Scene kits core: pure and browser-safe (no imports), shared by the kits.mjs CLI and the
 * assets/shipreel-kits.js script that `kits.mjs install` writes into a composition.
 *
 * Each kit renders { html, css, build(tl), end }: markup scoped to its id, CSS scoped to that id,
 * and a build function that places every tween at an absolute time on the composition's own
 * paused GSAP timeline. kit theme: { bg, panel, fg, muted, accent, font, mono }.
 */

const escapeHtml = (text) => String(text ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// Element text only needs &, <, > escaped; attribute values use escapeHtml.
const escapeText = (text) => String(text ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const round = (n) => Math.round(n * 1000) / 1000;
const SETTLE = 0.4;

const KEYWORDS = /^(?:const|let|var|function|return|if|else|for|while|import|export|from|await|async|new|class|def|fn|pub|use|true|false|null|undefined|None|True|False)$/;

/** Minimal, language-agnostic syntax colouring; every text piece is escaped. */
export function highlightCode(code) {
  const token = /(\/\/[^\n]*|#[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)\b/g;
  let out = "";
  let last = 0;
  for (const match of code.matchAll(token)) {
    out += escapeText(code.slice(last, match.index));
    const [text, comment, string, number, word] = match;
    if (comment) out += `<span class="com">${escapeText(comment)}</span>`;
    else if (string) out += `<span class="str">${escapeText(string)}</span>`;
    else if (number) out += `<span class="num">${number}</span>`;
    else if (word && KEYWORDS.test(word)) out += `<span class="kw">${word}</span>`;
    else out += escapeText(text);
    last = match.index + text.length;
  }
  return out + escapeText(code.slice(last));
}

const fadeUp = (tl, selector, at, distance = 24) =>
  tl.fromTo(selector, { opacity: 0, y: distance }, { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, round(at));

const windowCss = (id, theme) => `
#${id} { display: block; width: 100%; background: ${theme.panel}; color: ${theme.fg}; border: 2px solid ${theme.muted}33; border-radius: 18px; overflow: hidden; }
#${id} .kit-bar { display: flex; align-items: center; gap: 12px; padding: 18px 24px; border-bottom: 2px solid ${theme.muted}33; font-family: "${theme.mono}", monospace; font-size: 30px; color: ${theme.muted}; }
#${id} .kit-dots { display: flex; gap: 10px; } #${id} .kit-dots i { display: block; width: 14px; height: 14px; border-radius: 50%; background: ${theme.muted}66; } #${id} .kit-dots i:first-child { background: ${theme.accent}; }`;
const dots = `<span class="kit-dots"><i></i><i></i><i></i></span>`;

export const KITS = {
  terminal: {
    description: "A terminal window that types real commands character by character, then prints their output.",
    example: { title: "zsh", lines: [{ command: "/shipreel --for vertical", output: ["✓ rendered shipreel-vertical.mp4"] }], charSeconds: 0.04 },
    render({ id, at, theme, props }) {
      const lines = props.lines ?? [];
      const charSeconds = props.charSeconds ?? 0.04;
      const html = `<div id="${id}" class="kit-terminal"><div class="kit-bar">${dots}<span>${escapeHtml(props.title ?? "terminal")}</span></div><div class="kit-body">${lines
        .map((line, i) => `<div class="kit-line"><span class="kit-prompt">$ </span><span id="${id}-cmd-${i}" class="kit-type">${escapeHtml(line.command)}</span></div>${(line.output ?? [])
          .map((text, j) => `<div id="${id}-out-${i}-${j}" class="kit-out">${escapeHtml(text)}</div>`)
          .join("")}`)
        .join("")}</div></div>`;
      const css = `${windowCss(id, theme)}
#${id} .kit-body { padding: 28px 30px 34px; font-family: "${theme.mono}", monospace; font-size: ${props.fontSize ?? 40}px; line-height: 1.5; }
#${id} .kit-line { display: flex; white-space: pre; } #${id} .kit-prompt { color: ${theme.accent}; }
#${id} .kit-type { display: inline-block; overflow: hidden; white-space: pre; width: 0ch; vertical-align: bottom; }
#${id} .kit-out { color: ${theme.muted}; opacity: 0; }`;
      let t = at + SETTLE;
      const steps = [];
      lines.forEach((line, i) => {
        const chars = line.command.length;
        // Capture this line's start now: the steps run later, after `t` has moved on.
        const start = t;
        steps.push((tl) => tl.fromTo(`#${id}-cmd-${i}`, { width: "0ch" }, { width: `${chars}ch`, duration: round(chars * charSeconds), ease: `steps(${chars})` }, round(start)));
        const typedEnd = start + chars * charSeconds;
        (line.output ?? []).forEach((_, j) => {
          const when = typedEnd + 0.15 + j * 0.25;
          steps.push((tl) => tl.fromTo(`#${id}-out-${i}-${j}`, { opacity: 0 }, { opacity: 1, duration: 0.15 }, round(when)));
        });
        t = typedEnd + 0.15 + (line.output ?? []).length * 0.25 + 0.3;
      });
      return {
        html,
        css,
        end: round(t),
        build(tl) {
          fadeUp(tl, `#${id}`, at);
          for (const step of steps) step(tl);
        },
      };
    },
  },

  "http-card": {
    description: "An API request card (method, path, status) whose JSON response reveals line by line with one key highlighted.",
    example: { method: "POST", path: "/v1/videos", status: 201, response: { id: "vid_42", url: "https://shipreel.dev/v/42", seconds: 20 }, highlight: "url" },
    render({ id, at, theme, props }) {
      const lines = JSON.stringify(props.response ?? {}, null, 2).split("\n");
      const html = `<div id="${id}" class="kit-http"><div class="kit-bar"><span class="kit-method">${escapeHtml(props.method ?? "GET")}</span><span class="kit-path">${escapeHtml(props.path ?? "/")}</span><span id="${id}-status" class="kit-status">${escapeHtml(props.status ?? 200)}</span></div><pre class="kit-json">${lines
        .map((line, k) => {
          const hl = props.highlight && line.trimStart().startsWith(`"${props.highlight}":`);
          return `<span id="${id}-line-${k}" class="kit-json-line${hl ? " kit-hl" : ""}">${escapeHtml(line)}</span>`;
        })
        .join("")}</pre></div>`;
      const css = `${windowCss(id, theme)}
#${id} .kit-method { color: ${theme.bg}; background: ${theme.accent}; border-radius: 8px; padding: 2px 12px; font-weight: 700; }
#${id} .kit-path { color: ${theme.fg}; flex: 1; } #${id} .kit-status { color: ${theme.accent}; opacity: 0; }
#${id} .kit-json { margin: 0; padding: 26px 30px 32px; font-family: "${theme.mono}", monospace; font-size: ${props.fontSize ?? 36}px; line-height: 1.5; white-space: pre; }
#${id} .kit-json-line { display: block; opacity: 0; } #${id} .kit-hl { color: ${theme.bg}; background: ${theme.accent}; border-radius: 6px; }`;
      const bodyStart = at + SETTLE + 0.35;
      return {
        html,
        css,
        end: round(bodyStart + lines.length * 0.18 + 0.4),
        build(tl) {
          fadeUp(tl, `#${id}`, at);
          tl.fromTo(`#${id}-status`, { opacity: 0 }, { opacity: 1, duration: 0.2 }, round(at + SETTLE + 0.1));
          lines.forEach((_, k) => tl.fromTo(`#${id}-line-${k}`, { opacity: 0, x: -12 }, { opacity: 1, x: 0, duration: 0.2, ease: "power2.out" }, round(bodyStart + k * 0.18)));
        },
      };
    },
  },

  "code-editor": {
    description: "An editor window with a filename tab and syntax-coloured code whose lines appear in order.",
    example: { filename: "shipreel.config.js", code: 'export default {\n  tone: "yc-parody",\n  seconds: 20, // short on purpose\n};' },
    render({ id, at, theme, props }) {
      const lines = String(props.code ?? "").split("\n");
      const html = `<div id="${id}" class="kit-editor"><div class="kit-bar">${dots}<span class="kit-tab">${escapeHtml(props.filename ?? "index.js")}</span></div><pre class="kit-code">${lines
        .map((line, k) => `<span id="${id}-code-${k}" class="kit-code-line"><span class="kit-ln">${k + 1}</span>${highlightCode(line) || " "}</span>`)
        .join("")}</pre></div>`;
      const css = `${windowCss(id, theme)}
#${id} .kit-tab { color: ${theme.fg}; }
#${id} .kit-code { margin: 0; padding: 24px 28px 30px; font-family: "${theme.mono}", monospace; font-size: ${props.fontSize ?? 36}px; line-height: 1.55; white-space: pre; }
#${id} .kit-code-line { display: block; opacity: 0; } #${id} .kit-ln { display: inline-block; width: 2.5ch; margin-right: 1ch; color: ${theme.muted}88; text-align: right; }
#${id} .kw { color: ${theme.accent}; } #${id} .str { color: #9fd18b; } #${id} .num { color: #f2c76b; } #${id} .com { color: ${theme.muted}; font-style: italic; }`;
      const start = at + SETTLE;
      return {
        html,
        css,
        end: round(start + lines.length * 0.22 + 0.3),
        build(tl) {
          fadeUp(tl, `#${id}`, at);
          lines.forEach((_, k) => tl.fromTo(`#${id}-code-${k}`, { opacity: 0 }, { opacity: 1, duration: 0.18 }, round(start + k * 0.22)));
        },
      };
    },
  },

  "phone-frame": {
    description: "A phone bezel around a screen of your own markup, with an optional swipe of a card off the screen.",
    example: { width: 460, screen: '<div id="k-phone-frame-card" style="margin:40px;height:520px;border-radius:24px;background:#ff6a3d"></div>', swipe: { selector: "#k-phone-frame-card", at: 1.2, direction: "right" } },
    render({ id, at, theme, props }) {
      const width = props.width ?? 460;
      // `screen` is the composition author's own markup, inserted as-is.
      const html = `<div id="${id}" class="kit-phone"><div class="kit-screen">${props.screen ?? ""}</div></div>`;
      const css = `
#${id} { display: block; width: ${width}px; height: ${Math.round(width * 2.16)}px; padding: 18px; border-radius: ${Math.round(width * 0.14)}px; background: #0c0c0e; box-shadow: 0 0 0 3px ${theme.muted}44, 0 40px 80px #0008; }
#${id} .kit-screen { position: relative; width: 100%; height: 100%; overflow: hidden; border-radius: ${Math.round(width * 0.11)}px; background: ${theme.bg}; color: ${theme.fg}; font-family: "${theme.font}", sans-serif; }`;
      const swipe = props.swipe;
      const sign = swipe?.direction === "left" ? -1 : 1;
      return {
        html,
        css,
        end: round(at + SETTLE + (swipe ? swipe.at + 0.5 : 0.3)),
        build(tl) {
          fadeUp(tl, `#${id}`, at, 40);
          if (swipe) {
            tl.to(swipe.selector, { x: sign * width * 1.3, rotation: sign * 18, opacity: 0, duration: 0.45, ease: "power2.in" }, round(at + SETTLE + swipe.at));
          }
        },
      };
    },
  },

  "browser-frame": {
    description: "A browser window with a URL bar around a screen of your own markup, for showing a real page or app screen.",
    example: { url: "horsetinder.app", screen: '<div style="padding:40px;font-size:48px">Swipe right on Thunder</div>', height: 620 },
    render({ id, at, theme, props }) {
      const html = `<div id="${id}" class="kit-browser"><div class="kit-bar">${dots}<span id="${id}-url" class="kit-url">${escapeHtml(props.url ?? "")}</span></div><div class="kit-page">${props.screen ?? ""}</div></div>`;
      const css = `${windowCss(id, theme)}
#${id} .kit-url { flex: 1; padding: 6px 16px; border-radius: 999px; background: ${theme.bg}; color: ${theme.fg}; opacity: 0; }
#${id} .kit-page { position: relative; height: ${props.height ?? 620}px; overflow: hidden; background: ${theme.bg}; color: ${theme.fg}; font-family: "${theme.font}", sans-serif; }`;
      return {
        html,
        css,
        end: round(at + SETTLE + 0.5),
        build(tl) {
          fadeUp(tl, `#${id}`, at);
          tl.fromTo(`#${id}-url`, { opacity: 0 }, { opacity: 1, duration: 0.25 }, round(at + SETTLE));
        },
      };
    },
  },

  cursor: {
    description: "A pointer that glides between points in frame coordinates, with a click ripple where it clicks.",
    example: { points: [{ x: 200, y: 400 }, { x: 540, y: 960, click: true }], moveSeconds: 0.6, holdSeconds: 0.25 },
    render({ id, at, theme, props }) {
      const points = props.points ?? [];
      const clicks = points.filter((p) => p.click);
      const html = `<div id="${id}" class="kit-cursor"><svg viewBox="0 0 32 32" width="56" height="56" aria-hidden="true"><path d="M5 3l20 12-9 2-4 9z" fill="${theme.fg}" stroke="${theme.bg}" stroke-width="2" stroke-linejoin="round"/></svg></div><div id="${id}-ripples" class="kit-ripples">${clicks
        .map((p, n) => `<span id="${id}-ripple-${n}" class="kit-ripple" style="left:${p.x - 40}px;top:${p.y - 40}px"></span>`)
        .join("")}</div>`;
      const css = `
#${id} { position: absolute; left: 0; top: 0; z-index: 70; width: 56px; height: 56px; }
#${id}-ripples { position: absolute; inset: 0; z-index: 69; pointer-events: none; }
#${id}-ripples .kit-ripple { position: absolute; display: block; width: 80px; height: 80px; border-radius: 50%; border: 6px solid ${theme.accent}; opacity: 0; }`;
      const move = props.moveSeconds ?? 0.6;
      const hold = props.holdSeconds ?? 0.25;
      return {
        html,
        css,
        end: round(at + (points.length - 1) * (move + hold) + 0.5),
        build(tl) {
          if (!points.length) return;
          tl.set(`#${id}`, { x: points[0].x, y: points[0].y }, round(at));
          let t = at;
          let ripple = 0;
          points.slice(1).forEach((point) => {
            tl.to(`#${id}`, { x: point.x, y: point.y, duration: move, ease: "power2.inOut" }, round(t));
            t += move;
            if (point.click) {
              tl.fromTo(`#${id}-ripple-${ripple}`, { scale: 0.2, opacity: 0.7 }, { scale: 1.6, opacity: 0, duration: 0.45, ease: "power2.out" }, round(t));
              ripple += 1;
            }
            t += hold;
          });
        },
      };
    },
  },

  "game-hud": {
    description: "A game HUD with a score that counts up, a health bar, and a combo callout.",
    example: { score: 12450, health: 0.35, combo: "x12 COMBO", label: "SCORE" },
    render({ id, at, theme, props }) {
      const html = `<div id="${id}" class="kit-hud"><div class="kit-score"><span class="kit-label">${escapeHtml(props.label ?? "SCORE")}</span><span id="${id}-score" class="kit-num">0</span></div><div class="kit-health"><span id="${id}-health" class="kit-fill"></span></div><div id="${id}-combo" class="kit-combo">${escapeHtml(props.combo ?? "")}</div></div>`;
      const css = `
#${id} { display: block; width: 100%; font-family: "${theme.mono}", monospace; color: ${theme.fg}; }
#${id} .kit-score { display: flex; align-items: baseline; gap: 18px; } #${id} .kit-label { font-size: 32px; color: ${theme.muted}; letter-spacing: 0.12em; }
#${id} .kit-num { font-size: 88px; font-weight: 700; font-variant-numeric: tabular-nums; }
#${id} .kit-health { display: block; width: 100%; height: 26px; margin-top: 18px; border-radius: 13px; background: ${theme.muted}44; overflow: hidden; }
#${id} .kit-fill { display: block; width: 100%; height: 100%; background: ${theme.accent}; transform-origin: 0 50%; }
#${id} .kit-combo { margin-top: 22px; font-size: 64px; font-weight: 800; color: ${theme.accent}; opacity: 0; }`;
      const counter = { value: 0, __kitCounter: true };
      return {
        html,
        css,
        end: round(at + 1.9),
        build(tl) {
          fadeUp(tl, `#${id}`, at);
          tl.to(counter, {
            value: props.score ?? 0,
            duration: 1.2,
            ease: "power1.out",
            onUpdate() {
              document.getElementById(`${id}-score`).textContent = Math.floor(counter.value).toLocaleString("en-US");
            },
          }, round(at + 0.3));
          tl.fromTo(`#${id}-health`, { scaleX: 1 }, { scaleX: props.health ?? 1, duration: 0.8, ease: "power2.inOut" }, round(at + 0.5));
          tl.fromTo(`#${id}-combo`, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, round(at + 1.5));
        },
      };
    },
  },
};

export function renderKit(name, { id, at, theme, props = {} }) {
  const kit = KITS[name];
  if (!kit) throw new Error(`Unknown kit "${name}". Kits: ${Object.keys(KITS).join(", ")}.`);
  return kit.render({ id, at, theme, props });
}

/**
 * Render a kit into an existing element and add its motion to the timeline. Call it inside the
 * composition's timeline script, before the timeline is registered.
 */
export function mountKit(tl, slotId, name, options, doc = document) {
  const slot = doc.getElementById(slotId);
  if (!slot) throw new Error(`No element with id "${slotId}" to mount kit "${name}" into.`);
  const out = renderKit(name, options);
  slot.innerHTML = out.html;
  const style = doc.createElement("style");
  style.textContent = out.css;
  doc.head.appendChild(style);
  out.build(tl);
  return out;
}

