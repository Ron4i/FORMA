// Проверка оформления: применяется ли слой classic.css и какие значения
// реально вычислены браузером (а не просто объявлены в файле).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const ROOT = join(import.meta.dirname, "..");
const PORT = 8899, CDP = 9351;
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png",
  ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split("?")[0]);
  const file = join(ROOT, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end("nf"); return; }
  res.writeHead(200, { "content-type": MIME[file.slice(file.lastIndexOf("."))] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));
const BASE = `http://localhost:${PORT}/index.html`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, d = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? "  → " + d : ""}`);
};

// mkdtemp, а не фиксированный путь: иначе прогон наследует Cache Storage
// прошлого и проверяет старые social.js/classic.css вместо текущих.
const profile = mkdtempSync(join(tmpdir(), "forma-theme-"));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${CDP}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });

try {
  let wsUrl;
  for (let i = 0; i < 60; i++) {
    try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; if (wsUrl) break; } catch {}
    await sleep(250);
  }
  if (!wsUrl) throw new Error("Chrome не поднялся");

  const ws = new WebSocket(wsUrl, { perMessageDeflate: false });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const pending = new Map();
  let mid = 0;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id); pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++mid; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 25000);
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => send(m, p, sessionId);
  await S("Page.enable"); await S("Runtime.enable");
  // Без этого Chrome отдаёт из дискового кеша старые social.js/classic.css
  // и тест «проверяет» файл, которого уже нет.
  await S("Network.enable"); await S("Network.setCacheDisabled", { cacheDisabled: true });
  const evalJs = async (e) => {
    const r = await S("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception?.description || "").split("\n")[0]);
    return r.result.value;
  };
  const goto = async (route) => { await S("Page.navigate", { url: BASE + "#" + route }); await sleep(1200); };

  await goto("/");

  // 1. Файл подключён и распарсен
  const sheets = await evalJs(`[...document.styleSheets].map(s=>(s.href||'').split('/').pop())`);
  check("classic.css подключён", sheets.includes("classic.css"), sheets.join(","));
  const rules = await evalJs(`(()=>{const s=[...document.styleSheets].find(x=>(x.href||'').includes('classic'));return s?s.cssRules.length:0})()`);
  check("classic.css разобран", rules > 100, `${rules} правил`);

  // 2. Акцент действительно золотой, а не зелёный
  const accent = await evalJs("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()");
  check("Акцент — золото, не неон", /^#d9b26a$/i.test(accent), accent);
  const oldGreen = await evalJs("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()");
  check("Фон переопределён", !/^#070b12$/i.test(oldGreen), oldGreen);

  // 3. Реальные вычисленные стили поверхности и кнопки.
    // На главной карточек нет — они живут на /nutrition, /profile, /settings.
    await goto("/nutrition");
    // box-shadow не режем: браузер ставит "inset" в конце тени,
// и короткий срез обрезал именно его.
const card = await evalJs(`(()=>{const e=document.querySelector('.card');if(!e)return null;const s=getComputedStyle(e);return {r:s.borderRadius,bg:s.backgroundColor,bd:s.borderTopColor,sh:s.boxShadow}})()`);
    check("Карточка перерисована", !!card && card.r === "16px", card ? `radius ${card.r}, bg ${card.bg}` : "нет .card");
    check("У карточки мягкая тень", !!card && /inset/.test(card.sh), card ? card.sh : "—");

    await goto("/");
    const btn = await evalJs(`(()=>{const e=document.querySelector('.btn.primary');if(!e)return null;const s=getComputedStyle(e);return {bg:s.backgroundImage.slice(0,46),c:s.color,r:s.borderRadius}})()`);
    check("Главная кнопка — золотой градиент", !!btn && /gradient/.test(btn.bg), btn ? btn.bg : "нет .btn.primary");
    check("Текст кнопки тёмный на золоте", !!btn && btn.c === "rgb(20, 16, 10)", btn ? btn.c : "—");

    // 4. Типографическая шкала
    const h1 = await evalJs(`(()=>{const e=document.querySelector('.hero h1');if(!e)return null;const s=getComputedStyle(e);return {fs:s.fontSize,fw:s.fontWeight,ls:s.letterSpacing}})()`);
    check("Заголовок героя крупный и жирный", !!h1 && parseFloat(h1.fs) >= 24 && +h1.fw >= 700, h1 ? `${h1.fs} / ${h1.fw} / ${h1.ls}` : "нет .hero h1");

    // 5. Поля ввода (есть на /profile, /settings, /routines)
    await goto("/profile");
    const inp = await evalJs(`(()=>{const e=document.querySelector('input,select,textarea');if(!e)return null;const s=getComputedStyle(e);return {r:s.borderRadius,bg:s.backgroundColor}})()`);
    check("Поля ввода скруглены и на токенной подложке", !!inp && inp.r === "11px", inp ? `${inp.r} / ${inp.bg}` : "нет полей");

    // 6. Кольца. Концентрические — на /challenges, а на /nutrition их нет:
    //    там отдельный компонент .water-ring (стакан воды), см. styles.css:691.
    await goto("/challenges");
    const ring = await evalJs(`(()=>{const e=document.querySelector('.ring');if(!e)return null;return {bg:getComputedStyle(e).backgroundImage.slice(0,70)}})()`);
    check("Кольцо концентрации в новой палитре", !!ring && /157, 142, 199/.test(ring.bg), ring ? ring.bg : "нет .ring");

    await goto("/nutrition");
    const water = await evalJs(`(()=>{const e=document.querySelector('.water-ring');if(!e)return null;const s=getComputedStyle(e);const f=e.querySelector('.water-fill');return {bd:s.borderTopColor,bg:f?getComputedStyle(f).backgroundImage.slice(0,60):null}})()`);
    check("Стакан воды перекрашен (не кислотный циан)", !!water && water.bd === "rgb(30, 35, 45)" && !/56, 189, 248/.test(water.bg || ""), water ? `${water.bd} / ${water.bg}` : "нет .water-ring");

    // 7. Аватарки — приглушённые. Регресс: поле называлось cover,
    //    а читался grad → в class попадал "undefined" и градиент не рисовался.
    await goto("/feed");
    const avaState = await evalJs(`(()=>{
      const all=[...document.querySelectorAll('[class*="ava"]')];
      const bad=all.filter(e=>/\\bundefined\\b/.test(e.className));
      const p=document.querySelector('.ava.g1,.ava.g2,.ava.g3');
      return {n:all.length,bad:bad.map(e=>e.className).slice(0,3),grad:p?getComputedStyle(p).backgroundImage.slice(0,80):null};
    })()`);
    check("В аватарках нет класса undefined", avaState.bad.length === 0, avaState.bad.join(" | ") || `${avaState.n} шт. чисто`);
    check("Градиент аватарки приглушён", !!avaState.grad && /180, 103, 111|201, 154, 99|91, 110, 163/.test(avaState.grad), avaState.grad || "нет .ava.gN");

  // 8. Лента: карточка и кнопка лайка (уже на /feed из шага 7)
    const feed = await evalJs(`(()=>{const e=document.querySelector('.feed-item');if(!e)return null;const s=getComputedStyle(e);return {r:s.borderRadius,bg:s.backgroundColor,bd:s.borderTopColor}})()`);
  check("Карточка ленты перерисована", !!feed && feed.r === "16px", feed ? `${feed.r} / ${feed.bg}` : "нет .feed-item");
  const like = await evalJs(`(()=>{const e=document.querySelector('.act');if(!e)return null;return {fw:getComputedStyle(e).fontWeight,c:getComputedStyle(e).color}})()`);
  check("Действия ленты не кричат", !!like && +like.fw >= 600, like ? `${like.fw} / ${like.c}` : "нет .act");

  // 9. Мобильное меню
  await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await goto("/");
  const mob = await evalJs(`(()=>{const e=document.querySelector('.m-bottom-nav');if(!e)return null;const s=getComputedStyle(e);return {d:s.display,bg:s.backgroundColor,bd:s.borderTopColor,bf:s.backdropFilter}})()`);
  check("Мобильное меню стеклянное", !!mob && /blur/.test(mob.bf), mob ? `${mob.d} / ${mob.bf}` : "нет .m-bottom-nav");

    // 10. FORMA обещает «бесплатно и без лимита» на лендинге, в meta-описании
    //     и в таблице сравнения с конкурентами. Регресс: в коде возвращался
    //     paywall (5 сканов/неделю + кнопка «Активировать Premium»), который
    //     прямо противоречил этому обещанию. Проверяем и логику, и тексты.
    await S("Emulation.clearDeviceMetricsOverride");
    // Infinity не переживёт returnByValue, поэтому сравниваем внутри страницы.
    const limit = await evalJs("(function(){var v=Fit.store.aiLimit();return typeof v==='number'&&v===Infinity?'Infinity':String(v)})()");
    check("ИИ-сканер без лимита", limit === "Infinity", limit);
    check("ИИ всегда доступен", (await evalJs("Fit.store.canUseAi()")) === true);

    await goto("/scan");
    const scanTxt = await evalJs("(document.body.innerText||'')");
    check("На сканере нет счётчика вида «N / 5»", !/\d+\s*\/\s*\d+/.test(scanTxt), (scanTxt.match(/\d+\s*\/\s*\d+/) || ["—"])[0]);
    check("На сканере написано про бесплатность", /бесплат/i.test(scanTxt) && /без лимита/i.test(scanTxt));

    await goto("/profile");
    const profTxt = await evalJs("(document.body.innerText||'')");
    check("В профиле нет тарифа и Premium", !/premium/i.test(profTxt) && !/тариф/i.test(profTxt));

    await goto("/nutrition");
    const nutTxt = await evalJs("(document.body.innerText||'')");
    check("В питании нет упоминаний Premium/лимита", !/premium/i.test(nutTxt) && !/лимит/i.test(nutTxt.replace(/без лимита|без ограничений/gi, "")));

    console.log(`\n=== ИТОГ: ${pass}/${pass + fail} проверок пройдено ===`);
  if (fail) process.exitCode = 1;
  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  proc.kill(); server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}