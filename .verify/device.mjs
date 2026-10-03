// Общая обвязка для проверок на живом устройстве: сама поднимает приложение,
// находит процесс, пробрасывает порт DevTools и подключается к странице.
// Эмулятор периодически убивает процесс приложения, поэтому переподключение
// должно быть частью инструмента, а не ручной работой в каждом тесте.
import { spawnSync } from "node:child_process";

const ADB = process.env.ADB || "C:\\Android\\platform-tools\\adb.exe";
const PORT = Number(process.env.CDP_PORT || 9333);
const PKG = "app.forma.fit";
const ACTIVITY = `${PKG}/.MainActivity`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adb(args, quiet = true) {
  const r = spawnSync(ADB, args, { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 && !quiet) console.error(r.stderr || "");
  return (r.stdout || "").trim();
}

/** Запускает приложение (или перезапускает) и ждёт появления страницы. */
export async function launch({ fresh = false } = {}) {
  if (fresh) {
    adb(["shell", "am", "force-stop", PKG]);
    await sleep(1200);
  }
  adb(["shell", "am", "start", "-W", "-n", ACTIVITY]);

  // Холодный старт на эмуляторе занимает до 10 c, а сокет DevTools
  // поднимается позже — ждём терпеливо и перечитываем pid каждый раз.
  let lastPid = "";
  for (let i = 0; i < 60; i++) {
    await sleep(1500);
    const pid = adb(["shell", "pidof", PKG]);
    if (!pid) {
      // Процесс умер — перезапускаем ещё раз, не сдаваясь с первого раза.
      if (i > 6 && i % 8 === 0) adb(["shell", "am", "start", "-n", ACTIVITY]);
      continue;
    }
    const sockets = adb(["shell", "cat", "/proc/net/unix"]);
    const m = sockets.match(/@webview_devtools_remote_(\d+)/);
    if (!m) continue;
    lastPid = m[1];
    const ok = await connect(+m[1]);
    if (ok) return ok;
  }
  throw new Error(
    `не удалось подключиться к WebView (pid=${lastPid || "нет процесса"}) — приложение не стартовало?`
  );
}

/** Пробрасывает порт и открывает WebSocket к странице FORMA. */
async function connect(pid) {
  adb(["forward", "--remove", `tcp:${PORT}`]);
  adb(["forward", `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`]);
  await sleep(800);

  let pages;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      pages = await res.json();
      break;
    } catch {
      await sleep(1200);
    }
  }
  const page = pages?.find((t) => t.type === "page" && t.url.includes("localhost"));
  if (!page) return null;

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  });
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  const evaluate = (expression) =>
    new Promise((res) => {
      const i = ++id;
      pend.set(i, (m) => res(m.result?.result?.value));
      ws.send(JSON.stringify({
        id: i, method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });

  return { ws, evaluate, title: page.title, sleep };
}

export { sleep, adb };