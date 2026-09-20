/**
 * Headless Chrome for /shipreel scripts: find a Chrome or Chromium binary, open a page,
 * and talk to it over the DevTools protocol using Node's built-in WebSocket.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return null;
}

/** Minimal Chrome DevTools Protocol session over Node's built-in WebSocket. */
export async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id != null && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    } else if (message.method && listeners.has(message.method)) {
      for (const listener of listeners.get(message.method)) listener(message.params);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
  const once = (method) => new Promise((resolve) => listeners.set(method, [...(listeners.get(method) ?? []), resolve]));
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  return { send, once, evaluate, close: () => socket.close() };
}

/**
 * Launch headless Chrome, run `beforeLoad` scripts on every new document, navigate to `url`,
 * wait for load, and call `fn(session)`. Chrome is always shut down and its profile removed.
 */
export async function withPage(url, fn, { beforeLoad = [], chromePath = findChrome(), timeoutMs = 120_000, extraArgs = [] } = {}) {
  if (!chromePath) throw new Error("Chrome or Chromium not found; set CHROME_PATH.");
  const profile = mkdtempSync(path.join(tmpdir(), "shipreel-chrome-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
    "--allow-file-access-from-files", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=4000,4000",
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ...extraArgs,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Chrome did not start")), timeoutMs);
      let buffer = "";
      chrome.stderr.on("data", (chunk) => {
        buffer += chunk;
        const match = buffer.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
        if (match) {
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      chrome.on("exit", (code) => reject(new Error(`Chrome exited (${code})`)));
    });

    let page;
    for (let attempt = 0; attempt < 50 && !page; attempt += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find((t) => t.type === "page");
      if (!page) await new Promise((r) => setTimeout(r, 100));
    }
    if (!page) throw new Error("Chrome opened no page.");

    const session = await connect(page.webSocketDebuggerUrl);
    try {
      await session.send("Page.enable");
      for (const source of beforeLoad) await session.send("Page.addScriptToEvaluateOnNewDocument", { source });
      const loaded = session.once("Page.loadEventFired");
      await session.send("Page.navigate", { url });
      await loaded;
      return await fn(session);
    } finally {
      session.close();
    }
  } finally {
    // Chrome keeps writing to its profile until it has exited; remove the profile only after that,
    // and never let cleanup fail work that already finished.
    const exited = chrome.exitCode !== null || chrome.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill("SIGKILL");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5000))]);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // A leftover temp profile is harmless; the OS cleans its temp directory.
    }
  }
}
