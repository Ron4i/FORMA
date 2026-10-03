// Проверка бандла phone/www — ровно тех файлов, которые попадают в APK.
//
// Зачем отдельный харнесс, а не запуск routes.mjs: собранный бандл — это
// другой набор файлов, чем корень репозитория. Ошибка в prepare.mjs
// (пропущенный скрипт, неверный путь CSS, незакрытый кавычка) не видна
// в исходниках и проявится только на телефоне — как белый экран.
//
// Отличие от routes.mjs: здесь нет service worker, поэтому проверять надо
// ещё и то, что приложение грузится без него, и что в консоли нет 404.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Каталог собранного бандла, а не корень проекта.
const WWW = join(import.meta.dirname, "..", "phone", "www");

if (!existsSync(join(WWW, "index.html"))) {
  console.error("Нет phone/www/index.html. Сначала: cd phone && npm run bundle");
  process.exit(1);
}

const PORT = 8907;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = join(WWW, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(WWW) || !existsSync(file)) {
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
  "/feed/new", "/recipes/r1"
];

const profile = mkdtempSync(join(tmpdir(), "forma-bundle-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9341",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=412,915", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9341/json/version");
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

let pass = 0;
const failures = [];
function check(ok, label, detail = "") {
  if (ok) pass++;
  else failures.push(label + (detail ? " — " + detail : ""));
  console.log(`${ok ? "ok   " : "FAIL "} ${label}${detail && !ok ? " — " + detail : ""}`);
}

function dirSize(dir) {
  let total = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
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
  await S("Network.enable");

  console.log("\n=== FORMA — проверка бандла phone/www ===\n");

  // --- 1. Состав бандла ---
  check(existsSync(join(WWW, "index.html")), "index.html на месте");
  check(!existsSync(join(WWW, "sw.js")), "sw.js НЕ попал в бандл", "service worker не нужен в WebView");
  check(
    readFileSync(join(WWW, "assets/js/core.js"), "utf8").includes("service worker не нужен в нативной обёртке"),
    "регистрация service worker заглушена в core.js"
  );

  // --- 2. Ни одного запроса, который не нашёл файл (это и есть белый экран) ---
  cdp.events.length = 0;
  await S("Page.navigate", { url: BASE });
  await sleep(1500);

  const failedReqs = cdp.events
    .filter((e) => e.method === "Network.loadingFailed")
    .map((e) => e.params.errorText)
    .filter((t) => t !== "net::ERR_ABORTED");
  const badStatus = cdp.events
    .filter((e) => e.method === "Network.responseReceived" && e.params.response.status >= 400)
    .map((e) => `${e.params.response.status} ${e.params.response.url.split("/").slice(3).join("/")}`);
  check(badStatus.length === 0, "нет ответов 4xx/5xx на ресурсы", badStatus.join(", "));
  check(failedReqs.length === 0, "нет неудавшихся загрузок", failedReqs.join(", "));

  // --- 3. Приложение реально смонтировалось ---
  const boot = await S("Runtime.evaluate", {
    expression: `(() => ({
      view: document.querySelector('#view') ? document.querySelector('#view').innerText.trim().length : -1,
      nav: document.querySelectorAll('.nav-item, nav a, .bottom-nav a').length,
      store: typeof window.Fit === 'object' && !!window.Fit.store,
      css: getComputedStyle(document.body).backgroundColor
    }))()`,
    returnByValue: true
  });
  check(boot.result.value.view > 100, "домашний экран отрисован", boot.result.value.view + " символов");
  check(boot.result.value.store, "Fit.store доступен (скрипты в правильном порядке)");
  check(boot.result.value.nav > 3, "нижняя навигация отрисована", boot.result.value.nav + " пунктов");

  // classic.css обязан применяться — это «классический» дизайн из ТЗ
  check(
    boot.result.value.css !== "rgba(0, 0, 0, 0)" && boot.result.value.css !== "rgb(255, 255, 255)",
    "classic.css применился (фон не дефолтный)", boot.result.value.css
  );

  // --- 4. Каждый маршрут рендерится в бандле без ошибок ---
  const routeRows = [];
  for (const route of ROUTES) {
    cdp.events.length = 0;
    await S("Page.navigate", { url: BASE + "#" + route });
    await sleep(700);
    const r = await S("Runtime.evaluate", {
      expression: `(() => {
        const v = document.querySelector('#view');
        return { len: v ? v.innerText.trim().length : -1, first: v ? v.innerText.trim().split('\\n')[0].slice(0,40) : 'NO #view' };
      })()`,
      returnByValue: true
    });
    const errs = cdp.events
      .filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => {
        const d = e.params.exceptionDetails;
        return (d.exception?.description || d.text || "").split("\n")[0].slice(0, 120);
      })
      .concat(
        cdp.events
          .filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
          .map((e) => e.params.entry.text.slice(0, 120))
      );
    routeRows.push({ route, ...r.result.value, errs });
  }
  console.log("");
  for (const r of routeRows) {
    const ok = r.len > 0 && r.errs.length === 0;
      if (ok) pass++;
      else failures.push(`маршрут ${r.route} — ${r.errs.join("; ") || "пустой #view"}`);
      console.log(`${ok ? "ok   " : "FAIL "} ${r.route.padEnd(16)} ${String(r.len).padStart(5)}ch :: ${r.first}`);
      r.errs.forEach((e) => console.log(`        ! ${e}`));
    }

  // --- 5. Ключевые обещания ТЗ должны работать и в бандле ---
  cdp.events.length = 0;
  await S("Page.navigate", { url: BASE + "#/scan" });
  await sleep(700);
  const scan = await S("Runtime.evaluate", {
    expression: `document.querySelector('#view').innerText`,
    returnByValue: true
  });
  check(/без лимита/i.test(scan.result.value), "на /scan обещана бесплатность без лимита");
  check(
    (await S("Runtime.evaluate", {
      expression: `String(window.Fit.store.aiLimit())`,
      returnByValue: true
    })).result.value === "Infinity",
    "aiLimit() безлимитен и в бандле"
  );

  console.log(`\nИтого: ${pass} проверок пройдено, ${failures.length} провалено`);
  console.log(`Размер бандла: ${Math.round(dirSize(WWW) / 1024)} КБ`);
  ws.close();
  if (failures.length) process.exitCode = 1;
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  proc.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}