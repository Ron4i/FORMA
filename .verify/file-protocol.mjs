// Приложение обязано работать по file:// — «открыть index.html двойным щелчком».
// Проверяем в том числе глубокие ссылки и нормализацию неизвестного маршрута:
// для file:// location.pathname — это полный путь к файлу, а не "/",
// поэтому правка роутера могла здесь и сломаться.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP = Number(process.env.CDP_PORT || 9377);
const INDEX = "file:///C:/Users/vyuko/OneDrive/Desktop/Проэкты/Фитнес приложение/index.html";

const profile = mkdtempSync(join(tmpdir(), "forma-file-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--allow-file-access-from-files",
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--no-default-browser-check", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools не поднялся");
}

const ws = new WebSocket(await getWsUrl(), { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
await new Promise((r) => ws.once("open", r));
let msgId = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
});
const cmd = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 20000);
  });

const results = [];
const check = (name, ok, extra) => { results.push([name, ok, extra]); };

try {
  const { targetId } = await cmd("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cmd("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cmd(m, p, sessionId);
  const ev = async (expression) =>
    (await S("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Page.navigate", { url: INDEX });
  await sleep(4000);

  const len = await ev(`(document.querySelector("#view")?.innerHTML||"").length`);
  check("file:// открывается", len > 200, `html=${len}`);

  for (const [route, marker] of [
    ["#/recipes/r1", "#rc-eat"],
    ["#/recipes/r1/%D0%9A%D1%83%D1%80%D0%B8%D0%BD%D0%B0%D1%8F%20%D0%B1%D1%83%D0%BB%D1%8C%D0%BE%D0%BD", "#rc-eat"],
    ["#/feed/new", "#c-post"],
    ["#/feed/u/@masha_fit", "#up-follow"]
  ]) {
    await ev(`location.hash=${JSON.stringify(route)}`);
    await sleep(600);
    const ok = await ev(`!!document.querySelector(${JSON.stringify(marker)})`);
    check(`file:// ${route.slice(0, 34)}`, ok === true, "маркер " + marker);
  }

  await ev(`location.hash="#/nonexistent-route"`);
  await sleep(900);
  const nh = await ev("location.hash");
  check("file:// неизвестный маршрут -> #/", nh === "#/", String(nh));
} finally {
  ws.close();
  proc.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

for (const [name, ok, extra] of results) console.log(`${ok ? "OK  " : "FAIL"}  ${name}${extra ? "  :: " + extra : ""}`);
const bad = results.filter(r => !r[1]).length;
console.log(`\nfile://: ${results.length - bad}/${results.length}`);
if (bad) process.exit(1);