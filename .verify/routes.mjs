// Проверка всех маршрутов FORMA через headless Chrome (CDP)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");
const CDP = Number(process.env.CDP_PORT || 9344);

// Свой статический сервер: тест не должен зависеть от того, запущен ли
// сервер на 8899 снаружи (иначе «упавшие» маршруты означают лишь
// отсутствие чужого процесса, а не поломку приложения).
const PORT = 8899;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const BASE = `http://localhost:${PORT}/index.html`;
const ROUTES = [
  "/", "/scan", "/nutrition", "/routines", "/feed", "/coach", "/activity",
  "/exercises", "/progress", "/challenges", "/recipes", "/profile", "/settings",
  "/feed/new", "/feed/u/@masha_fit", "/recipes/r1", "/nonexistent-route"
];

// Маршруты, у которых есть конкретный ожидаемый маркер в DOM.
// Без этого проверки неисправный маршрут молча «проходил»: renderTo
// откатывается на главную, а главная непустая.
const EXPECT = {
  "/recipes/r1": "#rc-eat",
  "/recipes/r99": null, // неизвестный рецепт -> список
  "/feed/new": "#c-post",
  "/feed/u/@masha_fit": "#up-follow"
};

const profile = mkdtempSync(join(tmpdir(), "forma-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=1400,1000", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP}/json/version`);
      const j = await res.json();
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
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 20000);
      });
    }
  };
}

try {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const cdp = makeCdp(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Log.enable");

  const rows = [];
    for (const route of [...ROUTES, "/recipes/r99"]) {
    cdp.events.length = 0;
    await S("Page.navigate", { url: BASE + "#" + route });
    await sleep(1000);
    const res = await S("Runtime.evaluate", {
      expression: `(() => {
        const v = document.querySelector('#view');
          const want = ${JSON.stringify(EXPECT[route] ?? null)};
          return {
            viewLen: v ? v.innerText.trim().length : -1,
            first: v ? v.innerText.trim().split('\\n')[0].slice(0,44) : 'NO #view',
            hash: decodeURIComponent(location.hash),
            markerOk: want === null ? true : !!document.querySelector(want),
            marker: want
          };
        })()`,
        returnByValue: true
      });
      const v = res.result.value;
      const errs = cdp.events
        .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
        .map((e) => e.params.entry.text.slice(0, 160));
      const ex = cdp.events
        .filter((e) => e.method === "Runtime.exceptionThrown")
        .map((e) => {
          const d = e.params.exceptionDetails;
          const desc = d.exception?.description || d.text || "";
          const frames = (d.stackTrace?.callFrames || []).slice(0, 5)
            .map((f) => `${f.functionName || "?"}@${(f.url || "").split("/").pop()}:${f.lineNumber + 1}`);
          return [desc.split("\n")[0].slice(0, 160), ...frames.map((f) => "    at " + f)].join("\n");
        });
      rows.push({ route, ...v, errors: [...ex, ...errs] });
    }

    const bad = (r) => r.viewLen <= 0 || r.errors.length || !r.markerOk;

    console.log("\n=== FORMA — проверка маршрутов ===");
    for (const r of rows) {
      const flag = bad(r) ? "FAIL " : "ok   ";
      const mark = r.marker ? (r.markerOk ? " ✓маркер" : ` ✗нет ${r.marker}`) : "";
      console.log(`${flag} ${r.route.padEnd(22)} ${String(r.viewLen).padStart(5)}ch${mark} :: ${r.first}`);
      r.errors.forEach((e) => console.log(`        ! ${e}`));
    }
    const failed = rows.filter(bad);
    console.log(`\nИтого: ${rows.length} маршрутов, проблемных: ${failed.length}`);
    if (failed.length) {
      console.log(failed.map((r) => "  - " + r.route).join("\n"));
    }

    for (const route of ["/", "/scan", "/feed", "/coach", "/plan", "/challenges"]) {
      await S("Page.navigate", { url: BASE + "#" + route });
      await sleep(1000);
      const { data } = await S("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(import.meta.dirname, `shot-${route === "/" ? "home" : route.slice(1)}.png`), Buffer.from(data, "base64"));
    }
    console.log("Скриншоты сохранены в .verify/");
    ws.close();
    process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
