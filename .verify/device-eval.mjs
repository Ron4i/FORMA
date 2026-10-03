// Evaluates expressions inside the FORMA WebView over the adb-forwarded DevTools socket.
// Used to verify the installed APK really renders the app, not just a splash screen.
import { setTimeout as sleep } from "node:timers/promises";

const PORT = process.env.CDP_PORT || 9333;

async function target() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const page = list.find((t) => t.type === "page" && t.url.includes("localhost"));
  if (!page) throw new Error("страница FORMA не найдена в списке целей DevTools");
  return page;
}

const probe = `(async () => {
  const q = (s) => document.querySelector(s);
  return {
    title: document.title,
    url: location.href,
    fitStore: typeof window.Fit?.store === "object",
    screens: window.Fit?.screens?.length ?? null,
    hash: location.hash,
    appHtmlLen: (q("#app")?.innerHTML || q("main")?.innerHTML || "").length,
    h1: (q("h1")?.textContent || "").trim(),
    navButtons: document.querySelectorAll("nav button, .nav button, [data-nav]").length,
    bg: getComputedStyle(document.body).backgroundColor,
    scriptErrors: window.__formaErrors || null,
    // признак пустой страницы: нет ни одного текстового узла в body
    textNodes: (document.body.innerText || "").trim().length,
  };
})()`;

const page = await target();
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});

function send(method, params = {}) {
  const msgId = ++id;
  return new Promise((res) => {
    pending.set(msgId, res);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

const result = await send("Runtime.evaluate", {
  expression: probe,
  awaitPromise: true,
  returnByValue: true,
});

ws.close();

const value = result.result?.result?.value;
if (!value) {
  console.error("Ответ без значения:", JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(value, null, 2));

const problems = [];
if (!value.fitStore) problems.push("Fit.store отсутствует — скрипты не выполнились");
if (!value.textNodes) problems.push("body пустой — белый экран");
if (!value.appHtmlLen) problems.push("#app пуст — роутер ничего не отрендерил");

if (problems.length) {
  console.error("\nПРОБЛЕМЫ:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("\nWebView отрисовывает приложение.");