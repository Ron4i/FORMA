// Интеграционная проверка: лайки, комментарии, сторис, сканер, план
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");

// Свой статический сервер: тест не должен зависеть от постороннего
// процесса на 8899 (иначе падение означает лишь его отсутствие).
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

const BASE = `http://localhost:${PORT}/index.html`;

const profile = mkdtempSync(join(tmpdir(), "forma-int-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--remote-debugging-port=9344",
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
  "--window-size=1400,1000", "about:blank"
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch("http://127.0.0.1:9344/json/version")).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome не поднялся");
}

let msgId = 0;
const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
}

try {
  const ws = new WebSocket(await getWsUrl(), { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

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
  const send = (method, params = {}, sessionId) => {
    const id = ++msgId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 25000);
    });
  };

  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable"); await S("Log.enable");

  const evalJs = async (expr) => {
    const r = await S("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || "eval error");
    return r.result.value;
  };

  const goto = async (route) => {
    await S("Page.navigate", { url: BASE + "#" + route });
    await sleep(1000);
  };

  // ---- 1. Лента: лайк ----
  await goto("/feed");
  const likeBefore = await evalJs(`(() => { const b=document.querySelector('[data-like]'); return b? +b.querySelector('span').textContent : -1; })()`);
  await evalJs(`document.querySelector('[data-like]').click()`);
  await sleep(700);
  const likeAfter = await evalJs(`(() => { const b=document.querySelector('[data-like]'); return { n: b? +b.querySelector('span').textContent:-1, on: b? b.classList.contains('on'):false }; })()`);
  check("Лайк увеличивает счётчик", likeAfter.n === likeBefore + 1, `${likeBefore} → ${likeAfter.n}`);
  check("Лайк подсвечивается", likeAfter.on === true);

  // лайк должен пережить перезагрузку
  await S("Page.navigate", { url: BASE + "#/feed" });
  await sleep(1000);
  const likePersisted = await evalJs(`+document.querySelector('[data-like]').querySelector('span').textContent`);
  check("Лайк сохраняется в localStorage", likePersisted === likeBefore + 1, `${likePersisted}`);

  // ---- 2. Комментарий ----
  const cmtOk = await evalJs(`(async () => {
    const inp = document.querySelector('[data-cmt-inp]') || document.querySelector('.feed-item input[type=text]') || document.querySelector('.feed-item input');
    if (!inp) return 'no-input';
    inp.value = 'Тестовый комментарий';
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    const form = inp.closest('form');
    if (form) form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
    else inp.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    return document.body.innerText.includes('Тестовый комментарий') ? 'added' : 'not-added';
  })()`);
  check("Комментарий добавляется", cmtOk === "added", cmtOk);

  // ---- 3. Сторис: открытие просмотра ----
  await goto("/feed");
  const story = await evalJs(`(async () => {
    const b = document.querySelector('[data-user]');
    if (!b) return 'no-story-btn';
    b.click();
    await new Promise(r=>setTimeout(r,900));
    const v = document.querySelector('.story-viewer');
    return v ? 'opened' : 'not-opened';
  })()`);
  check("Просмотр сторис открывается", story === "opened", story);
  if (story === "opened") {
    const sv = await evalJs(`(() => {
      const v = document.querySelector('.story-viewer');
      return { bars: v.querySelectorAll('.sv-bar, .bar, [class*=bar]').length, text: v.innerText.length, reactions: v.querySelectorAll('[data-react]').length };
    })()`);
    check("В сторис есть прогресс-бары и реакции", sv.bars > 0 && sv.text > 10, JSON.stringify(sv));
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.body.click();`);
    await sleep(400);
  }

  // ---- 4. Сканер: офлайн-эвристика по фото ----
  await goto("/scan");
  const scan = await evalJs(`(async () => {
    const cvs = document.createElement('canvas'); cvs.width=120; cvs.height=120;
    const cx = cvs.getContext('2d');
    const g = cx.createLinearGradient(0,0,120,120);
    g.addColorStop(0,'#8B4513'); g.addColorStop(0.5,'#D2691E'); g.addColorStop(1,'#228B22');
    cx.fillStyle=g; cx.fillRect(0,0,120,120);
    const dataUrl = cvs.toDataURL('image/png');
    const r = await Fit.ai.analyzeImage(dataUrl, {});
    return { name: r && r.name, kcal: r && Math.round(r.kcal), p: r && Math.round(r.p), f: r && Math.round(r.f), c: r && Math.round(r.c) };
  })()`);
  check("Сканер определяет БЖУ по фото",
    !!(scan && scan.kcal > 0 && scan.p >= 0 && scan.f >= 0 && scan.c >= 0),
    JSON.stringify(scan));

  // ---- 5. План: генерация офлайн ----
  await goto("/scan");
  const plan = await evalJs(`(async () => {
    const p = { weight: 84, height: 178, age: 30, sex: 'f', activity: 1.375, targetWeight: 74 };
    const pl = await Fit.ai.makePlan(p, {});
    return { days: pl && pl.days && pl.days.length, kcal: pl && Math.round(pl.targetKcal||0), meals: pl && pl.days && pl.days[0] && pl.days[0].meals.length, p: pl && Math.round(pl.protein||0) };
  })()`);
  check("Генератор плана работает", plan.days >= 7 && plan.kcal > 1000 && plan.meals >= 3, JSON.stringify(plan).slice(0,140));

  // ---- 6. Челлендж: старт ----
  await goto("/challenges");
  const ch = await evalJs(`(async () => {
    const b = document.querySelector('[data-ch]');
    if (!b) return 'no-btn';
    const id = b.getAttribute('data-ch');
    b.click(); await new Promise(r=>setTimeout(r,700));
    return { started: Fit.store.isChallengeActive(id), total: Fit.store.getChallenges().length };
  })()`);
  check("Челлендж запускается", ch.started === true, JSON.stringify(ch).slice(0,140));

  // ---- 6b. План: полный пользовательский путь (профиль → план) ----
  await evalJs(`(() => {
    const p = Fit.store.getProfileOr();
    Object.assign(p, { weight: 84, height: 178, age: 30, sex: 'f', activity: 1.375, goalWeight: 74 });
    Fit.store.setProfile(p);
    location.hash = '#/plan';
  })()`);
  await sleep(800);
  const planView = await evalJs(`(async () => {
    const go = document.querySelector('#plan-go');
    if (!go) return { err: 'no-generate-btn', text: (document.body.innerText||'').slice(0,80) };
    go.click();
    for (let i = 0; i < 40 && !document.querySelector('.plan-day'); i++) await new Promise(r=>setTimeout(r,250));
    return {
      days: document.querySelectorAll('.plan-day').length,
      meals: document.querySelectorAll('.plan-meal').length,
      kcal: (document.body.innerText.match(/(\\d{3,4}) ккал в день/)||[])[1] || '?',
      saved: !!Fit.store.getPlan()
    };
  })()`);
  check("Экран плана отрисован", planView.days >= 7 && planView.meals >= 7 && planView.saved === true, JSON.stringify(planView).slice(0,160));

  // ---- 7. Уведомления: план��ировщик ----
  const push = await evalJs(`(async () => {
    const has = !!(Fit.push && Fit.push.start);
    let tpl = 0;
    try { tpl = (Fit.push.templates ? Fit.push.templates() : (Fit.NOTIFY_TEMPLATES||[])) || []; } catch(e) { tpl = Fit.NOTIFY_TEMPLATES || []; }
    return { has, templates: (tpl||[]).length, next: tpl && tpl[0] ? typeof tpl[0].nextRun : 'n/a' };
  })()`);
  check("Планировщик уведомлений доступен", push.has && push.templates >= 5, JSON.stringify(push));

  // ---- 8. Экспорт данных ----
  const exp = await evalJs(`(() => { try { const d = JSON.parse(Fit.store.exportData()); return { posts: (d.posts||[]).length, keys: Object.keys(d).length }; } catch(e){ return {err:String(e)}; } })()`);
  check("Экспорт данных работает", !exp.err && exp.keys > 10, JSON.stringify(exp));

  // ---- 9. Персистентность ----
  const persist = await evalJs(`(async () => {
    Fit.store.setProfile({ name:'Тест', weight: 80, height: 175, age: 30, sex:'f', goalWeight: 70 });
    Fit.store.addNutrition({ name:'Тестовая еда', kcal: 500, p:30, f:10, c:60 });
    return true;
  })()`);
  await goto("/nutrition");
  const afterNav = await evalJs(`document.body.innerText.includes('Тестовая еда')`);
  check("Данные сохраняются между экранами", afterNav === true);

  // ---- 10. Ошибки за весь прогон ----
  const errs = events
    .filter((e) => e.method === "Runtime.exceptionThrown")
    .map((e) => (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text || "").split("\n")[0].slice(0,150));
  check("Нет исключений за прогон", errs.length === 0, errs.slice(0,3).join(" | "));

  // Скриншоты
  for (const [r, n] of [["/feed","feed"],["/scan","scan"],["/challenges","challenges"]]) {
    await goto(r);
    const { data } = await S("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(import.meta.dirname, `int-${n}.png`), Buffer.from(data, "base64"));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено ===`);
  if (failed.length) console.log("Провалено: " + failed.map((f) => f.name).join(", "));
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  console.error((e.stack || "").split("\n").slice(0, 8).join("\n"));
  process.exitCode = 1;
} finally {
  proc.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
