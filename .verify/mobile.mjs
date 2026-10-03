// FORMA — мобильная проверка: iPhone-12-подобный вьюпорт 390x844, touch, safe-area.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Свой статический сервер: тест не должен зависеть от постороннего
// процесса на 8899 (иначе падение означает лишь его отсутствие).
// HTTP_PORT отличается от PORT — последний занят портом отладки Chrome.
const ROOT = join(import.meta.dirname, "..");
const HTTP_PORT = 8899;
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
await new Promise((r) => server.listen(HTTP_PORT, r));

const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html`;
const PORT = 9334;
const ROUTES = [
  "/", "/activity", "/routines", "/progress", "/profile",
  "/scan", "/nutrition", "/feed", "/coach", "/exercises",
  "/challenges", "/recipes", "/settings", "/feed/new", "/nonexistent-route"
];
const SHOT = process.argv.includes("--shots");
const OUT = join(import.meta.dirname, "m-shots");

const profile = mkdtempSync(join(tmpdir(), "forma-m-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools не поднялся");
}

let msgId = 0;
function makeCdp(ws) {
  const pending = new Map();
  const events = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    } else if (m.method) events.push(m);
  });
  return {
    events,
    send(method, params = {}, sessionId) {
      const id = ++msgId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); }
        }, 20000);
      });
    }
  };
}

try {
  const ws = new WebSocket(await getWsUrl(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const cdp = makeCdp(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Log.enable");
  await S("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 3, mobile: true
  });
  await S("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await S("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });

  // Первый заход сжигает кэш service worker, повторный — реальное состояние.
  await S("Page.navigate", { url: BASE });
  await sleep(1800);

  const rows = [];
  for (const route of ROUTES) {
    cdp.events.length = 0;
    await S("Runtime.evaluate", { expression: `location.hash = '#${route}'` });
    await sleep(1100);
    const res = await S("Runtime.evaluate", {
      expression: `(() => {
        const v = document.querySelector('#view');
        const nav = document.querySelector('.m-bottom-nav');
        const tabs = nav ? nav.querySelectorAll('a').length : 0;
        const cs = nav ? getComputedStyle(nav) : null;
        const de = document.documentElement;
        return {
          viewLen: v ? v.innerText.trim().length : -1,
          first: v ? v.innerText.trim().split('\\n')[0].slice(0,40) : 'NO #view',
          tabs,
          navVisible: cs ? cs.display !== 'none' : false,
          navPos: cs ? cs.position : '',
          scrollW: de.scrollWidth,
          clientW: de.clientWidth,
          hOverflow: de.scrollWidth - de.clientWidth,
          sidebar: getComputedStyle(document.querySelector('.sidebar') || document.body).display,
          map: !!document.querySelector('.leaflet-container'),
          banner: !!document.querySelector('.gps-rec-banner')
        };
      })()`,
      returnByValue: true
    });
    const v = res.result.value;
    const errs = cdp.events
      .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
      .map((e) => e.params.entry.text.slice(0, 150));
    const ex = cdp.events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => {
        const d = e.params.exceptionDetails;
        const desc = d.exception?.description || d.text || "";
        const frames = (d.stackTrace?.callFrames || []).slice(0, 4)
          .map((f) => `    at ${f.functionName || "?"}@${(f.url || "").split("/").pop()}:${f.lineNumber + 1}`);
        return [desc.split("\n")[0].slice(0, 150), ...frames].join("\n");
      });
    rows.push({ route, ...v, errors: [...ex, ...errs] });
  }

  console.log("\n=== FORMA — мобильная проверка (390x844) ===");
  for (const r of rows) {
    const bad = r.viewLen <= 0 || r.errors.length || r.hOverflow > 2 || !r.navVisible || r.tabs !== 5;
    console.log(
      `${bad ? "FAIL" : "ok  "} ${r.route.padEnd(20)} ${String(r.viewLen).padStart(5)}ch ` +
      `tabs=${r.tabs}/${r.navVisible ? "vis" : "HID"} sb=${r.sidebar} of=${r.hOverflow}ch` +
      `${r.map ? " map" : ""} :: ${r.first}`
    );
    r.errors.forEach((e) => console.log(`        ! ${e}`));
  }
  const bad = rows.filter((r) => r.viewLen <= 0 || r.errors.length || r.hOverflow > 2 || !r.navVisible || r.tabs !== 5);
  console.log(`\nИтого: ${rows.length} маршрутов, проблемных: ${bad.length}`);

  if (SHOT) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(OUT, { recursive: true });
    for (const route of ["/", "/activity", "/routines", "/progress", "/profile", "/settings"]) {
      await S("Runtime.evaluate", { expression: `location.hash = '#${route}'` });
      await sleep(1300);
      const { data } = await S("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(OUT, `m-${route === "/" ? "home" : route.slice(1)}.png`), Buffer.from(data, "base64"));
    }
    console.log("Мобильные скриншоты: .verify/m-shots/");
  }
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  proc.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
