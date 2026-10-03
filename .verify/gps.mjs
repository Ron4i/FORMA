// Функциональный тест GPS-модуля: подменяем Geolocation API и гоним
// синтетический маршрут, затем проверяем метрики, сплиты и приватность.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

// Свой статический сервер: тест не должен зависеть от постороннего
// процесса на 8899 (иначе падение означает лишь его отсутствие).
// HTTP_PORT отличается от PORT — последний занят портом отладки Chrome.
const ROOT = join(import.meta.dirname, "..");
const HTTP_PORT = 8899;
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
await new Promise((r) => server.listen(HTTP_PORT, r));

const BASE = `http://127.0.0.1:${HTTP_PORT}/index.html`;
const PORT = 9336;

const profile = mkdtempSync(join(tmpdir(), "forma-gps-"));
const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("no cdp");
}

let msgId = 0;
function makeCdp(ws) {
  const pending = new Map();
  const loadErrors = [];
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      loadErrors.push(m.params.entry.text.slice(0, 200));
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      loadErrors.push((d.exception?.description || d.text || "").split("\n")[0].slice(0, 200));
    }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return {
    loadErrors,
    send(method, params = {}, sessionId) {
      const id = ++msgId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
        setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("timeout " + method)); } }, 60000);
      });
    }
  };
}

try {
  const ws = new WebSocket(await getWsUrl(), { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });
  const cdp = makeCdp(ws);

  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const S = (m, p) => cdp.send(m, p, sessionId);
  const evalJs = async (e) => {
    const r = await S("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  await S("Page.enable");
  await S("Runtime.enable");
  await S("Log.enable");
  await S("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

  // Ставим заглушку Geolocation ДО загрузки приложения, иначе запрос
  // разрешения уйдёт в реальный диалог и зависнет.
  await S("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      window.__fix = [];
      const g = { lat: 55.751244, lng: 37.618423, alt: 140 };
      const pos = () => ({ coords: { latitude: g.lat, longitude: g.lng, altitude: g.alt, accuracy: 8 }, timestamp: Date.now() });
      const stub = {
        getCurrentPosition: (ok) => setTimeout(() => ok(pos()), 10),
        watchPosition: (ok) => setInterval(() => {
          const f = window.__fix.shift();
          if (f) { g.lat = f.lat; g.lng = f.lng; if (f.alt != null) g.alt = f.alt; }
          ok(pos());
            }, 400),
        clearWatch: (id) => clearInterval(id)
      };
      // navigator.geolocation — read-only accessor на прототипе, присваивание молча игнорируется.
      Object.defineProperty(Navigator.prototype, "geolocation", { get: () => stub, configurable: true });
      Object.defineProperty(navigator, "geolocation", { get: () => stub, configurable: true });
          })();`
        });

  await S("Page.navigate", { url: BASE + "#/activity" });
  await sleep(2500);

  console.log("\n=== FORMA — функциональный тест GPS ===\n");
  if (cdp.loadErrors.length) {
    console.log("Ошибки загрузки:");
    [...new Set(cdp.loadErrors)].forEach((e) => console.log("  ! " + e));
    console.log("");
  }

  const init = await evalJs(`(() => ({
    privacy: Fit.gps.getPrivacyMode(),
    types: Object.keys(Fit.gps.ACTIVITY_TYPES).join(','),
    hasStoreRoutes: Array.isArray(Fit.store.getState().routes),
    hasCsv: typeof Fit.store.exportRoutesCsv === 'function',
    hasMSheet: typeof Fit.mSheet === 'object',
    hasToast: typeof Fit.mToast === 'function',
    hasBanner: typeof Fit.initGpsBanner === 'function',
    leaflet: typeof L !== 'undefined'
  }))()`);
  console.log("1. Инициализация:", JSON.stringify(init));
  console.log("   → GPS по умолчанию выключен:", init.privacy === "off" ? "ДА" : "НЕТ");
  console.log("   → Leaflet подключён:", init.leaflet ? "ДА" : "НЕТ");

  // Без явного режима приватности запись стартовать не должна.
  const refused = await evalJs(`(async () => {
    const r = await Fit.gps.start();
    return { reason: r.reason, recording: Fit.gps.isRecording() };
  })()`);
  console.log(`\n2. Старт без согласия: отказ="${refused.reason}", запись=${refused.recording}`);
  console.log("   → GPS не включается молча:", refused.reason === "no-consent" ? "ДА" : "НЕТ");

  await evalJs(`(() => {
    window.__fix = [];
      const lat0 = 55.751244, step = 0.00002; // ~2.2 м на шаг, интервал 400 мс → ~20 км/ч
      for (let i = 0; i < 70; i++) window.__fix.push({ lat: lat0 + i * step, lng: 37.618423, alt: 140 + i * 0.4 });
    Fit.gps.setPrivacyMode('while-using');
  })()`);

  const rec = await evalJs(`(async () => {
    const started = await Fit.gps.start();
      await new Promise(r => setTimeout(r, 25000));
    const snap = Fit.gps.snapshot();
      const draft = Fit.store.getState().gpsDraft;
      return {
        ok: !!started.ok, reason: started.reason || null,
        recording: Fit.gps.isRecording(), perm: Fit.gps.getPermission(),
        dist: snap ? snap.distance : 0, spd: snap ? snap.speed : 0,
        kcal: snap ? snap.kcal : 0, elev: snap ? snap.elevGain : 0,
        pts: snap ? snap.points : 0, splits: snap ? snap.splits.length : 0,
        draft: draft ? draft.points.length : -1, draftDist: draft ? draft.distance : -1
      };
    })()`);
    console.log(`\n3. Запись: ok=${rec.ok} reason=${rec.reason} perm=${rec.perm} recording=${rec.recording}`);
    console.log(`   точек=${rec.pts} (черновик=${rec.draft} / ${rec.draftDist} м), дистанция=${(rec.dist / 1000).toFixed(3)} км, темп=${rec.spd.toFixed(1)} км/ч, набор=${rec.elev} м, ккал=${rec.kcal}`);
    console.log("   → distance растёт:", rec.dist > 1000 ? "ДА" : "НЕТ (" + Math.round(rec.dist) + " м)");
    console.log("   → точки накапливаются:", rec.pts > 50 ? "ДА" : "НЕТ (" + rec.pts + ")");
    console.log("   → сплиты считаются:", rec.splits > 1 ? "ДА (" + rec.splits + ")" : "НЕТ");
    console.log("   → черновик сохраняется:", rec.draft > 0 ? "ДА" : "НЕТ");
    console.log("   → сходится с черновиком:", Math.abs(rec.draftDist - rec.dist) < 30 ? "ДА" : `НЕТ (${rec.draftDist} vs ${Math.round(rec.dist)})`);

  const saved = await evalJs(`(async () => {
    Fit.gps.stop();
    await new Promise(r => setTimeout(r, 600));
    const routes = Fit.gps.getRoutes();
    const f = routes[0] || null;
        const sp = f ? Fit.gps.splitsForRoute(f.id) : [];
        return {
          count: routes.length,
          km: f ? f.distance / 1000 : 0,
          pts: f ? f.points.length : 0,
          splits: sp.length,
          fullSplits: sp.filter((s) => !s.partial).length,
          firstKm: sp[0] ? +sp[0].pace.toFixed(2) : null,
          type: f ? f.type : null,
          src: f ? f.source : null,
          elev: f ? f.elevGain : null,
          kcal: f ? f.kcal : null,
          gaps: f ? f.gaps : null,
          rejected: f ? f.rejected : null,
          inActivities: f ? Fit.store.getState().activities.some((a) => a.routeId === f.id) : false,
          stillRecording: Fit.gps.isRecording(),
          csv: (function () {
            try { return Fit.store.exportRoutesCsv().length; } catch (e) { return 'ERR:' + e.message; }
          })()
        };
      })()`);
  console.log(`\n4. Сохранено маршрутов: ${saved.count}`);
    console.log(`   → ${saved.km.toFixed(3)} км, точек ${saved.pts}, сплитов ${saved.splits} (полных ${saved.fullSplits}), тип "${saved.type}"/${saved.src}`);
    console.log(`   → набор ${saved.elev} м, ${saved.kcal} ккал, отброшено точек ${saved.rejected}, разрывов ${saved.gaps}`);
    console.log("   → попал в журнал:", saved.inActivities ? "ДА" : "НЕТ");
    console.log("   → запись остановлена:", !saved.stillRecording ? "ДА" : "НЕТ");
    console.log("   → CSV экспорт:", typeof saved.csv === "number" ? saved.csv + " симв." : saved.csv);

  const priv = await evalJs(`(async () => {
    const before = Fit.gps.getRoutes().length;
    Fit.gps.setPrivacyMode('while-using');
    const m1 = Fit.gps.getPrivacyMode();
    Fit.gps.setPrivacyMode('off');
    Fit.gps.forgetAllLocationData();
    await new Promise(r => setTimeout(r, 400));
    return { before, after: Fit.gps.getRoutes().length, mode1: m1,
             draft: Fit.store.getState().gpsDraft, lastKnown: Fit.store.getState().geoLastKnown };
  })()`);
  console.log(`\n5. Очистка геоданных: маршрутов ${priv.before} → ${priv.after}`);
  console.log("   → режим переключается:", priv.mode1 === "while-using" ? "ДА" : "НЕТ");
  console.log("   → черновик удалён:", priv.draft == null ? "ДА" : "НЕТ");
  console.log("   → метка последней позиции удалена:", priv.lastKnown == null ? "ДА" : "НЕТ");

  const manual = await evalJs(`(async () => {
    Fit.gps.startManual();
    Fit.gps.addManualDistance(500);
    await new Promise(r => setTimeout(r, 300));
    const live = Fit.gps.snapshot().distance;
    Fit.gps.stop();
    await new Promise(r => setTimeout(r, 400));
    const routes = Fit.gps.getRoutes();
    const last = routes[routes.length - 1];
    return { live, km: last ? last.distance / 1000 : 0, src: last ? last.source : null };
  })()`);
  console.log(`\n6. Ручной режим: live=${manual.live} м, сохранено=${manual.km.toFixed(2)} км, source="${manual.src}"`);
  console.log("   → работает без GPS:", manual.live === 500 ? "ДА" : "НЕТ");

  // Экран деталей маршрута должен открываться без ошибок.
  const detail = await evalJs(`(async () => {
    const r = Fit.gps.getRoutes()[0];
    if (!r) return { ok: false, len: 0, map: false };
    location.hash = '#/activity/route/' + r.id;
    await new Promise(res => setTimeout(res, 1400));
    const v = document.querySelector('#view');
        const hasMapEl = !!document.querySelector('#rt-map');
        return { ok: v.innerText.trim().length > 100, len: v.innerText.trim().length,
                 mapEl: hasMapEl, map: !!document.querySelector('.leaflet-container'),
                 poly: document.querySelectorAll('#rt-map path').length };
  })()`);
  console.log(`\n7. Экран маршрута: рендер=${detail.ok} (${detail.len} симв.), контейнер карты=${detail.mapEl}, Leaflet=${detail.map}, линий=${detail.poly}`);

  ws.close();
} catch (e) {
  console.error("FAILED:", e.message);
} finally {
  proc.kill();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
