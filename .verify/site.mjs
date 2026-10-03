// Проверка маркетингового сайта: ошибки консоли, битые ссылки на секции, адаптив.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = import.meta.dirname;
const profile = mkdtempSync(join(tmpdir(), "forma-site-"));

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
const URL_ = `http://localhost:${PORT}/site/index.html`;

let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  → " + d : ""}`);
  ok ? pass++ : fail++;
};

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=9334", `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let ws, msgId = 0;
const events = [];
const waiters = new Map();

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch("http://127.0.0.1:9334/json/list");
      const tabs = await r.json();
      const pg = tabs.find(t => t.type === "page");
      if (pg) return pg.webSocketDebuggerUrl;
    } catch {}
    await sleep(300);
  }
  throw new Error("CDP не поднялся");
}

try {
  const url = await connect();
  ws = new WebSocket(url, { maxPayload: 256 * 1024 * 1024 });
  await new Promise(r => ws.on("open", r));
  ws.on("message", (d) => {
    const m = JSON.parse(d);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    else if (m.method) events.push(m);
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++msgId;
    waiters.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const evalJs = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || "js error");
    return r.result.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL_ });
  await sleep(3200);

  // 1. Ошибки консоли
  const errs = events
    .filter(e => e.method === "Runtime.exceptionThrown" ||
      (e.method === "Log.entryAdded" && ["error"].includes(e.params.entry.level)))
    .map(e => e.params.exceptionDetails?.exception?.description || e.params.entry?.text || "").slice(0, 5);
  check("Сайт грузится без ошибок консоли", errs.length === 0, errs.join(" | ").slice(0, 200));

  // 2. Ключевые секции на месте
  const secs = await evalJs(`({
    hero: !!document.querySelector('.hero h1'),
    features: document.querySelectorAll('#features .fcard').length,
    ai: !!document.querySelector('#ai h2'),
    steps: document.querySelectorAll('#ai .step').length,
    stories: document.querySelectorAll('.st-rail .st').length,
    posts: document.querySelectorAll('.posts .post').length,
    cmpRows: document.querySelectorAll('.cmp tbody tr').length,
    how: document.querySelectorAll('.how .hc').length,
    pricing: document.querySelectorAll('.plan').length,
    faq: document.querySelectorAll('.qa').length,
    cta: !!document.querySelector('.cta-sec .btn'),
    height: document.body.scrollHeight
  })`);
  check("Все секции отрисованы",
    secs.hero && secs.features >= 10 && secs.ai && secs.steps === 4 && secs.stories === 6 &&
    secs.posts === 2 && secs.cmpRows >= 10 && secs.how === 3 && secs.pricing === 2 && secs.faq >= 6 && secs.cta,
    JSON.stringify(secs).slice(0, 190));
  check("Страница нормальной длины", secs.height > 3000, secs.height + "px");

  // 3. Все якорные ссылки ведут на существующие секции
  const anchors = await evalJs(`(() => {
    const bad = [];
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const id = a.getAttribute('href').slice(1);
      if (id && !document.getElementById(id)) bad.push('#' + id);
    });
    return bad;
  })()`);
  check("Нет битых якорей", anchors.length === 0, anchors.join(", "));

  // 4. Ссылки на приложение
  const appLinks = await evalJs(`[...document.querySelectorAll('a[href$="index.html"]')].map(a=>a.getAttribute('href'))`);
  check("Ссылки на приложение ведут в ../index.html", appLinks.length >= 3 && appLinks.every(h => h === "../index.html"), appLinks.join(", "));

  // 5. Стиль применён (не голый HTML)
  const styled = await evalJs(`(() => {
    const b = getComputedStyle(document.querySelector('.btn.primary'));
    const card = getComputedStyle(document.querySelector('.fcard'));
    return { bg: b.backgroundImage.includes('gradient'), radius: card.borderRadius };
  })()`);
  check("CSS применился", styled.bg === true && parseFloat(styled.radius) >= 12, JSON.stringify(styled));

  // 6. Мобильная вёрстка
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(700);
  const mob = await evalJs(`(() => {
    const burger = getComputedStyle(document.querySelector('.burger')).display;
    const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    return { burger, over };
  })()`);
  check("Мобильная вёрстка: бургер есть, нет горизонтального скролла",
    mob.burger === "block" && mob.over <= 1, JSON.stringify(mob));

  // Скриншоты
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "site-desktop.png"), Buffer.from(shot.data, "base64"));
  await evalJs(`location.hash='#compare'`); await sleep(900);
  const shot2 = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, "site-compare.png"), Buffer.from(shot2.data, "base64"));

  console.log(`\n=== ИТОГ: ${pass}/${pass + fail} проверок пройдено ===`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  console.error((e.stack || "").split("\n").slice(0, 6).join("\n"));
  process.exitCode = 1;
} finally {
  proc.kill();
    server.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
