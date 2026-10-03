// Навигация по маршрутам внутри WebView установленного APK.
// Проверяет то, чего не видит ни один браузерный тест: что загруженные ассеты
// реально маршрутизируются в нативном WebView на Android.
import { launch, sleep } from "./device.mjs";

const dev = await launch({ fresh: true });
await sleep(2000);
const evalIn = dev.evaluate;

// Собираем ошибки, которые ловятся уже во время работы — их не видно по логам Android.
await evalIn(`
  window.__formaErrors = [];
  window.addEventListener("error", (e) => window.__formaErrors.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => window.__formaErrors.push("rejection: " + e.reason));
  "armed"
`);

let pass = 0;
const fails = [];

// Маршруты берём у самого приложения (Fit.NAV), а не пишем руками:
// список в тесте разошёлся бы с кодом тихо, и «проверка» превратилась бы
// в формальность — первая же опечатка давала бы несуществующий маршрут,
// который рендерится как предыдущий экран и молча проходит проверку.
const routes = await evalIn(`(window.Fit?.NAV || []).map((n) => n.route)`);
if (!routes?.length) {
  console.error("Fit.NAV пуст — набор маршрутов получить не удалось.");
  process.exit(1);
}
console.log(`Маршрутов в приложении: ${routes.length}`);

const navCount = await evalIn(`document.querySelectorAll(".nav-link, .m-bottom-nav a").length`);
console.log(`Навигационных ссылок в DOM: ${navCount}`);
if (!navCount) fails.push("в навигации нет ни одной ссылки — нижнее меню не отрисовалось");

/* Каждый маршрут обязан давать свой DOM: сравниваем снимок соседних
   экранов, иначе «успех» означал бы лишь «отрисовалось что-то». */
const snapshots = new Map();

for (const route of routes) {
  await evalIn(`location.hash = ${JSON.stringify("#" + route)}`);
  await sleep(450);
  const info = await evalIn(`({
    hash: location.hash,
    len: (document.querySelector("#view")?.innerHTML || document.body.innerHTML).length,
    text: (document.body.innerText || "").trim().length,
    err: /Ошибка|Error 5|не найден/i.test(document.body.innerText || "") ? "виден текст ошибки" : null,
  })`);
  if (!info || info.hash !== "#" + route) {
    fails.push(`${route}: хеш не применился (${info?.hash})`);
    console.log(`FAIL ${route}  хеш не применился`);
    continue;
  }
  const ok = info.len > 200 && info.text > 20 && !info.err;
  snapshots.set(route, info.len + ":" + info.text);
  if (ok) pass++;
  else fails.push(`${route}: ${JSON.stringify(info)}`);
  console.log(`${ok ? "OK  " : "FAIL"} ${route}  html=${info.len} текст=${info.text}`);
}

// Соседние экраны с одинаковым снимком — это почти всегда «маршрут не найден».
const dupes = new Map();
for (const [r, sig] of snapshots) {
  if (!dupes.has(sig)) dupes.set(sig, []);
  dupes.get(sig).push(r);
}
for (const [sig, rs] of dupes) {
  if (rs.length > 3) {
    fails.push(`подозрительно много маршрутов с одинаковым рендером (${rs.length}): ${rs.join(", ")}`);
    console.log(`WARN одинаковый рендер у ${rs.length}: ${rs.join(", ")}`);
  }
}

const errs = await evalIn(`window.__formaErrors`);
if (errs?.length) fails.push(`JS-ошибки в рантайме: ${errs.join(" | ")}`);

dev.ws.close();

console.log(`\nИтог: ${pass}/${routes.length} маршрутов работают в WebView на устройстве`);
if (fails.length) {
  console.error("ПРОБЛЕМЫ:\n- " + fails.join("\n- "));
  process.exit(1);
}