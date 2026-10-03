// Считает реальные объёмы данных, загруженных в приложение.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = import.meta.dirname;
const profile = mkdtempSync(join(tmpdir(), "forma-cnt-"));

// Свой статический сервер: тест не должен зависеть от постороннего
// процесса на 8899 (иначе падение означает лишь его отсутствие).
const ROOT = join(import.meta.dirname, "..");
const PORT = 8899;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run",
  "--remote-debugging-port=9337", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

let ws, msgId = 0; const waiters = new Map();
try {
  let url;
  for (let i = 0; i < 40 && !url; i++) {
    try {
      const t = await (await fetch("http://127.0.0.1:9337/json/list")).json();
      url = t.find(x => x.type === "page")?.webSocketDebuggerUrl;
    } catch {}
    if (!url) await sleep(300);
  }
  ws = new WebSocket(url, { maxPayload: 64 * 1024 * 1024 });
  await new Promise(r => ws.on("open", r));
  ws.on("message", d => { const m = JSON.parse(d); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++msgId; waiters.set(i, x => x.error ? rej(new Error(JSON.stringify(x.error))) : res(x.result)); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const evalJs = async e => {
    const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || "js error");
    return r.result.value;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", { url: `http://localhost:${PORT}/index.html` });
  await sleep(3000);

  const stats = await evalJs(`({
      exercises: (window.Fit.EXERCISES||[]).length,
      routines: (window.Fit.PRESET_ROUTINES||[]).length,
      foods: (window.Fit.FOODS||[]).length,
      recipes: (window.Fit.RECIPES||[]).length,
      badges: (window.Fit.BADGES||[]).length,
      challenges: (window.Fit.CHALLENGES||[]).length,
      notifyTemplates: (window.Fit.NOTIFY_TEMPLATES||[]).length,
      cheerSets: (window.Fit.CHEERS||[]).length,
      reactionTypes: Object.keys(window.Fit.STORY_REACTIONS||{}).length,
      navItems: (window.Fit.NAV||[]).length,
      fitKeys: Object.keys(window.Fit).length,
      hasSocial: !!window.Fit.social,
      storeApiMethods: window.Fit.store ? Object.keys(window.Fit.store).length : 0
  })`);
  console.log(JSON.stringify(stats, null, 1));
  ws.close();
} catch (e) { console.error("ERR:", e.message); } finally { proc.kill(); server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }