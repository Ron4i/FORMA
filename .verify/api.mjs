/* Проверка моста к бэкенду: два режима.
   1) Адрес Worker'а НЕ задан — приложение не делает ни одного fetch
      и продолжает работать на localStorage.
   2) Адрес задан, но сервер отдаёт 500 — интерфейс не ломается,
      ошибки проглатываются, локальные данные целы.
   3) Адрес задан и сервер живой — локальные действия зеркалятся на него.
   Запуск: node api.mjs
*/

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const PORT = 8899;
const CDP = 9341;
const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

let pass = 0,
  fail = 0;
const failures = [];
async function t(name, fn) {
  try {
    await fn();
    pass++;
    console.log("  ✓ " + name);
  } catch (e) {
    fail++;
    failures.push(name + " — " + e.message);
    console.log("  ✗ " + name + "\n      " + e.message);
  }
}
const ok = (v, m) => {
  if (!v) throw new Error(m || "ожидалось истинное значение");
};
const eq = (a, b, m) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((m || "") + " ожидалось " + JSON.stringify(b) + ", получено " + JSON.stringify(a));
  }
};

/* ---------- Статика приложения ---------- */
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const staticServer = createServer((req, res) => {
  const u = req.url.split("?")[0];
  const p = join(root, u === "/" ? "index.html" : decodeURIComponent(u));
  if (!p.startsWith(root) || !existsSync(p)) {
    res.writeHead(404);
    res.end("nope");
    return;
  }
  const ext = p.slice(p.lastIndexOf("."));
  res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
  res.end(readFileSync(p));
});

/* ---------- Подставной «Worker» ---------- */
const hits = [];           // все запросы, дошедшие до сервера
let workerMode = "dead";   // dead | ok

const apiServer = createServer((req, res) => {
  hits.push(req.method + " " + req.url.split("?")[0]);
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type, x-user-id");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (workerMode === "dead") {
    res.writeHead(500, { "content-type": "application/json" });
    res.end('{"error":"упал"}');
    return;
  }
  if (req.url.startsWith("/api/health")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true,"app":"FORMA"}');
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end('{"ok":true}');
});

/* ---------- Chrome через CDP ---------- */
let chrome, ws, msgId = 0;
const pending = new Map();
let sessionId = null;

function send(method, params = {}) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rej(new Error("CDP timeout: " + method));
      }
    }, 30000);
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (r.exceptionDetails) {
    const e = r.exceptionDetails;
    throw new Error("JS: " + (e.exception && e.exception.description ? e.exception.description.split("\n")[0] : e.text));
  }
  return r.result.value;
}

async function openPage(workerUrl) {
  await send("Page.enable");
  await send("Runtime.enable");
  if (workerUrl) {
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: "window.FORMA_WORKER_URL=" + JSON.stringify(workerUrl) + ";"
    });
  }
  // Меняем query, а не hash: переход только по хешу не перезагружает
  // документ, и api.js не выполнился бы заново с новым FORMA_WORKER_URL.
  openPage.n = (openPage.n || 0) + 1;
  await send("Page.navigate", {
    url: `http://127.0.0.1:${PORT}/index.html?m=${openPage.n}#/feed`
  });
  await new Promise((r) => setTimeout(r, 2500));
}

/* ============================ Запуск ============================ */

await new Promise((r) => staticServer.listen(PORT, r));
await new Promise((r) => apiServer.listen(8898, r));

const profile = mkdtempSync(join(tmpdir(), "forma-api-"));
const logs = [];

try {
  chrome = spawn(CHROME, [
    "--headless=new",
    "--remote-debugging-port=" + CDP,
    "--user-data-dir=" + profile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1400,1000",
    "about:blank"
  ], { stdio: "ignore" });

  // ждём отладочный порт
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      if (list.length) {
        ws = new WebSocket(list[0].webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.on("open", res);
          ws.on("error", rej);
        });
        ws.on("message", (m) => {
          const msg = JSON.parse(m.toString());
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) p.rej(new Error(msg.error.message));
            else p.res(msg.result);
          } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
            logs.push(msg.params.args.map((a) => a.value || a.description || "").join(" "));
          } else if (msg.method === "Runtime.exceptionThrown") {
            logs.push("EXCEPTION: " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
          }
        });
        const t = await send("Target.createTarget", { url: "about:blank" });
        const at = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
        sessionId = at.sessionId;
        ready = true;
        break;
      }
    } catch (e) {
      /* ещё не поднялся */
    }
  }
  if (!ready) throw new Error("Chrome не запустился");

  console.log("\nFORMA — мост к бэкенду\n");

  /* ============================ Режим 1: бэкенда нет ============================ */

  await openPage(null);

  await t("api.js загружен и Fit.api существует", async () => {
    ok(await evaluate("typeof window.Fit.api === 'object'"), "Fit.api не создан");
  });

  await t("Без заданного адреса api.enabled() === false", async () => {
    eq(await evaluate("window.Fit.api.enabled()"), false);
  });

  await t("Без адреса НИ ОДНОГО сетевого запроса к api (0 fetch)", async () => {
    // перехватываем fetch и считаем обращения к /api/
    await evaluate(`
      window.__apiCalls = 0;
      const of = window.fetch;
      window.fetch = function (u, o) {
        const url = String(u && u.url ? u.url : u);
        if (url.indexOf('/api/') !== -1) window.__apiCalls++;
        return of.apply(this, arguments);
      };
      true;
    `);
    await evaluate("window.Fit.store.addPost({user:'@x',avatar:'X',grad:'g1',text:'без сети',tags:[],likes:[],likeCount:0}); true");
    await evaluate("window.Fit.store.addStory({user:'@x',avatar:'X',grad:'g1',type:'result',from:90,to:85,text:'локально'}); true");
    await new Promise((r) => setTimeout(r, 600));
    eq(await evaluate("window.__apiCalls"), 0, "приложение дёрнуло сеть без настроенного бэкенда");
  });

  await t("Локальные данные записались несмотря на отсутствие сети", async () => {
    const r = await evaluate("({posts: window.Fit.store.getPosts().filter(p=>p.text==='без сети').length, stories: window.Fit.store.getStories().filter(s=>s.text==='локально').length})");
    eq(r.posts, 1, "пост не сохранился локально");
    eq(r.stories, 1, "сторис не сохранился локально");
  });

  await t("Лента и сторис рендерятся при выключенном бэкенде", async () => {
    await evaluate("location.hash = '#/feed'; true");
    await new Promise((r) => setTimeout(r, 900));
    const n = await evaluate("document.querySelectorAll('.post, [data-post], .feed-post, article').length");
    ok(n > 0, "в ленте нет ни одного поста: " + n);
  });

  /* ============================ Режим 2: бэкенд настроен, но падает ============================ */

  workerMode = "dead";
  hits.length = 0;
  await openPage("http://127.0.0.1:8898");

  await t("Адрес распознан: api.enabled() === true", async () => {
    eq(await evaluate("window.Fit.api.enabled()"), true);
  });

  await t("При упавшем сервере ping() возвращает false, не бросая", async () => {
    eq(await evaluate("window.Fit.api.ping()"), false);
  });

  await t("При упавшем сервере pull() возвращает null, не бросая", async () => {
    eq(await evaluate("window.Fit.api.pull()"), null);
  });

  await t("При упавшем сервере публикация всё равно сохраняется локально", async () => {
    await evaluate("window.Fit.store.addPost({user:'@me',avatar:'🙂',grad:'gMe',text:'при упавшем сервере',tags:[],likes:[],likeCount:0}); true");
    await new Promise((r) => setTimeout(r, 400));
    eq(await evaluate("window.Fit.store.getPosts().filter(p=>p.text==='при упавшем сервере').length"), 1, "пост потерялся");
    ok(hits.length > 0, "сервер вообще не был опрошен — зеркалирование не работает");
  });

  console.log("      [DBG] hits после режима 2:", JSON.stringify(hits));

  await t("Приложение осталось живым после сетевых ошибок (маршруты грузятся)", async () => {
    const res = await evaluate(`
      (async function () {
        const routes = ['#/feed','#/stories','#/leaderboard','#/challenges','#/home'];
        for (const r of routes) { location.hash = r; await new Promise(r=>setTimeout(r,260)); }
        return document.getElementById('root').children.length > 0;
      })()
    `);
    eq(res, true, "приложение перестало рендериться после сетевых сбоев");
  });

  /* ============================ Режим 3: бэкенд живой ============================ */

  workerMode = "ok";
  hits.length = 0;
  await openPage("http://127.0.0.1:8898");

  await t("Живой сервер: ping() === true", async () => {
    const r = await evaluate(`(async function () {
      const s = [];
      s.push('href=' + location.href);
      s.push('wu=' + window.Fit.api.WORKER_URL);
      s.push('typeofFetch=' + typeof window.fetch);
      s.push('fetchSrc=' + String(window.fetch).slice(0, 90));
      s.push('myHandle=' + window.Fit.api.myHandle());
      try { const raw = await fetch(window.Fit.api.WORKER_URL + '/api/health'); s.push('raw=' + raw.status); }
      catch (e) { s.push('rawERR=' + e.name + ':' + e.message); }
      try { const h = await window.Fit.api.pull(); s.push('pull=' + JSON.stringify(h)); }
      catch (e) { s.push('pullERR=' + e.name + ':' + e.message); }
      s.push('ping=' + await window.Fit.api.ping());
      return s.join(' | ');
    })()`);
    if (r.indexOf("ping=true") === -1) throw new Error(r);
  });

  await t("Новый пост зеркалится на сервер (POST /api/posts)", async () => {
    await evaluate("window.Fit.store.addPost({user:'@me',avatar:'🙂',grad:'gMe',text:'зеркало работает',tags:['тест'],likes:[],likeCount:0}); true");
    await new Promise((r) => setTimeout(r, 700));
    ok(hits.some((h) => h === "POST /api/posts"), "запроса POST /api/posts не было: " + JSON.stringify(hits));
  });

  await t("Новая сторис зеркалится на сервер (POST /api/stories)", async () => {
    await evaluate("window.Fit.store.addStory({user:'@me',avatar:'🙂',grad:'gMe',type:'result',from:90,to:86,text:'зеркало сторис'}); true");
    await new Promise((r) => setTimeout(r, 700));
    ok(hits.some((h) => h === "POST /api/stories"), "запроса POST /api/stories не было");
  });

  await t("Лайк зеркалится на сервер (POST /api/posts/:id/like)", async () => {
    const r = await evaluate(`
      (function () {
        const p = window.Fit.store.getPosts().find(x => x.text === 'зеркало работает');
        if (!p) return 'нет поста';
        window.Fit.store.toggleLike(p.id, '@me');
        return p.id;
      })()
    `);
    ok(r !== "нет поста", "пост для лайка не найден");
    await new Promise((r2) => setTimeout(r2, 700));
    ok(hits.some((h) => h.startsWith("POST /api/posts/") && h.endsWith("/like")), "лайк не ушёл: " + JSON.stringify(hits));
  });

  await t("Комментарий зеркалится на сервер (POST /api/posts/:id/comments)", async () => {
    await evaluate(`
      (function () {
        const p = window.Fit.store.getPosts().find(x => x.text === 'зеркало работает');
        window.Fit.store.addComment(p.id, {user:'@me',name:'Я',avatar:'🙂',text:'комментарий в сеть'});
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 700));
    ok(hits.some((h) => h.endsWith("/comments")), "комментарий не ушёл");
  });

  await t("Просмотр сторис зеркалится (POST /api/stories/:id/seen)", async () => {
    await evaluate(`
      (function () {
        const s = window.Fit.store.getStories().find(x => x.text === 'зеркало сторис');
        if (s) window.Fit.store.markStoryViewed(s.id);
        return true;
      })()
    `);
    await new Promise((r) => setTimeout(r, 700));
    ok(hits.some((h) => h.startsWith("POST /api/stories/") && h.endsWith("/seen")), "просмотр не ушёл");
  });

  await t("При живом сервере локальные лайки и комментарии не теряются", async () => {
    const r = await evaluate(`
      (function () {
        const p = window.Fit.store.getPosts().find(x => x.text === 'зеркало работает');
        return { likes: p.likes.length, comments: p.comments.length };
      })()
    `);
    ok(r.likes >= 1, "лайк потерялся при синхронизации");
    ok(r.comments >= 1, "комментарий потерялся при синхронизации");
  });

  await t("Нет необработанных JS-ошибок за всю сессию", async () => {
    const errs = logs.filter((l) => l && !/Failed to load resource|net::ERR|favicon/i.test(l));
    eq(errs, [], "ошибки в консоли: " + JSON.stringify(errs.slice(0, 3)));
  });

  await t("Хук не дублирует запись при повторной установке", async () => {
    const before = await evaluate("String(window.Fit.store.addPost)");
    await evaluate("window.Fit.api.hook(); window.Fit.api.hook(); true");
    await new Promise((r) => setTimeout(r, 400));
    const after = await evaluate("String(window.Fit.store.addPost)");
    eq(after, before, "метод обёрнут повторно — будет двойная отправка");
  });

  await t("Запись уходит на сервер ровно один раз (без дублей)", async () => {
    hits.length = 0;
    await evaluate("window.Fit.store.addPost({user:'@me',avatar:'🙂',grad:'gMe',text:'ровно один раз',tags:[],likes:[],likeCount:0}); true");
    await new Promise((r) => setTimeout(r, 800));
    eq(hits.filter((h) => h === "POST /api/posts").length, 1, "пост ушёл " + hits.filter((h) => h === "POST /api/posts").length + " раз(а)");
  });
} finally {
  try { ws && ws.close(); } catch (e) {}
  try { chrome && chrome.kill(); } catch (e) {}
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  staticServer.close();
  apiServer.close();
}

console.log("\n" + "─".repeat(50));
console.log(`  Пройдено: ${pass}   Провалено: ${fail}`);
if (fail) {
  console.log("\nПровалы:");
  failures.forEach((f) => console.log("  • " + f));
}
console.log("─".repeat(50) + "\n");
process.exit(fail ? 1 : 0);
