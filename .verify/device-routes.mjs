// Навигация по маршрутам внутри WebView установленного APK.
// Проверяет то, чего не видит ни один браузерный тест: что загруженные ассеты
// реально маршрутизируются в нативном WebView на Android.
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.CDP_PORT || 9333;
const ROUTES = (process.env.ROUTES || "#home,#scan,#feed,#progress,#profile").split(",");

const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
const page = (await res.json()).find((t) => t.type === "page" && t.url.includes("localhost"));
if (!page) throw new Error("страница FORMA не найдена");

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r, j) => {
  ws.addEventListener("open", r, { once: true });
  ws.addEventListener("error", j, { once: true });
});

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((r) => { pending.set(msgId, r); ws.send(JSON.stringify({ id: msgId, method, params })); });
}

async function evalIn(expr) {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return { __error: r.result.exceptionDetails.text };
  return r.result?.result?.value;
}

// Собираем ошибки, которые ловятся уже во время работы — их не видно по логам Android.
await evalIn(`
  window.__formaErrors = [];
  window.addEventListener("error", (e) => window.__formaErrors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__formaErrors.push("rejection: " + e.reason));
  "armed"
`);

let pass = 0;
const fails = [];

const navCount = await evalIn(`document.querySelectorAll(".nav-link, .m-bottom-nav a").length`);
console.log(`Навигационных ссылок в DOM: ${navCount}`);
if (!navCount) fails.push("в навигации нет ни одной ссылки — нижнее меню не отрисовалось");

for (const route of ROUTES) {
  await evalIn(`location.hash = "${route}"`);
  await sleep(500);
  const info = await evalIn(`({
    hash: location.hash,
    len: (document.querySelector("#view")?.innerHTML || document.body.innerHTML).length,
    text: (document.body.innerText || "").trim().length,
    err: /Ошибка|Error 5|не найден/i.test(document.body.innerText || "") ? "виден текст ошибки" : null,
  })`);
  const ok = info && info.len > 200 && info.text > 20 && !info.err;
  if (ok) pass++;
  else fails.push(`${route}: ${JSON.stringify(info)}`);
  console.log(`${ok ? "OK  " : "FAIL"} ${route}  html=${info?.len} текст=${info?.text}`);
}

const errs = await evalIn(`window.__formaErrors`);
if (errs?.length) fails.push(`JS-ошибки в рантайме: ${errs.join(" | ")}`);

ws.close();

console.log(`\nИтог: ${pass}/${ROUTES.length} маршрутов работают в WebView на устройстве`);
if (fails.length) {
  console.error("ПРОБЛЕМЫ:\n- " + fails.join("\n- "));
  process.exit(1);
}