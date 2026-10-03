// Проверка, что экраны показывают реальный контент, а не пустые оболочки.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = import.meta.dirname;
const profile = mkdtempSync(join(tmpdir(), "forma-txt-"));

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
  "--remote-debugging-port=9338", `--user-data-dir=${profile}`, "--window-size=430,932", "about:blank"], { stdio: "ignore" });

let ws, msgId = 0; const waiters = new Map();
const SCREENS = [
  ["/", "Главная"], ["/scan", "ИИ-сканер"], ["/nutrition", "Питание"], ["/routines", "Тренировки"],
  ["/feed", "Лента"], ["/coach", "ИИ-коуч"], ["/plan", "План"], ["/activity", "Активность"],
  ["/exercises", "Упражнения"], ["/progress", "Прогресс"], ["/challenges", "Челленджи"],
  ["/recipes", "Рецепты"], ["/profile", "Профиль"], ["/settings", "Настройки"], ["/feed/new", "Моя история"]
];

try {
  let url;
  for (let i = 0; i < 40 && !url; i++) {
    try {
      const t = await (await fetch("http://127.0.0.1:9338/json/list")).json();
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
  await send("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: `http://localhost:${PORT}/index.html` });
  await sleep(3000);

  // Заполняем профиль, чтобы /plan был доступен (иначе он корректно просит профиль)
  await evalJs(`(() => {
    const p = window.Fit.store.getProfileOr();
    Object.assign(p, { name: 'Тест', weight: 84, height: 178, age: 30, sex: 'f', activity: 1.375, goalWeight: 74 });
    window.Fit.store.setProfile(p);
    return true;
  })()`);

  let pass = 0, fail = 0;
  for (const [route, name] of SCREENS) {
    await evalJs(`location.hash = '#${route}'`);
    await sleep(650);
    const info = await evalJs(`(() => {
      const v = document.querySelector('#view') || document.body;
      const t = (v.innerText || '').replace(/\\s+/g, ' ').trim();
      return { chars: t.length, head: t.slice(0, 78), cards: v.querySelectorAll('button, a, .card, .surface, li, input, select').length,
               over: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    })()`);
    const ok = info.chars > 120 && info.cards >= 3;
    ok ? pass++ : fail++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(14)} ${String(info.chars).padStart(5)}ch  ${String(info.cards).padStart(3)}эл.  ${info.head}`);
  }
  console.log(`\n=== Контент: ${pass}/${pass + fail} экранов с реальным содержимым ===`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) { console.error("ERR:", e.message); process.exitCode = 1; }
finally { proc.kill(); server.close(); try { rmSync(profile, { recursive: true, force: true }); } catch {} }
