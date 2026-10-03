// Вложенные маршруты (параметры после корневого раздела) на устройстве.
// Проверяем не «отрисуется что-то», а конкретный маркер в DOM: иначе
// несуществующий маршрут проходит проверку, потому что роутер молча
// показывает главную.
import { launch, sleep } from "./device.mjs";

const dev = await launch();
await sleep(2000);

const CASES = [
  { route: "/feed/new", marker: "#c-post" },
  { route: "/feed/u/@masha_fit", marker: "#up-follow" },
  { route: "/recipes/r1", marker: "#rc-eat" },
  { route: "/recipes/r1/%D0%9A%D1%83%D1%80%D0%B8%D0%BD%D0%B0%D1%8F%20%D0%B1%D1%83%D0%BB%D1%8C%D0%BE%D0%BD", marker: "#rc-eat" },
  { route: "/routines/new", marker: null },
  { route: "/nonexistent-route", marker: null, fallbackHome: true }
];

let ok = 0;
const fails = [];

for (const c of CASES) {
  await dev.evaluate(`location.hash=${JSON.stringify("#" + c.route)}`);
  await sleep(700);
  const info = await dev.evaluate(`({
    hash: location.hash,
    len: (document.querySelector("#view")?.innerHTML || "").length,
    text: (document.body.innerText || "").trim().length,
    markerOk: ${c.marker ? `!!document.querySelector(${JSON.stringify(c.marker)})` : "null"}
  })`);
    // Несуществующий маршрут роутер переписывает на #/ — даём ему время.
    if (c.fallbackHome && info?.hash !== "#/") {
      await sleep(600);
      info.hash = await dev.evaluate("location.hash");
    }

  const applied = c.fallbackHome ? info?.hash === "#/" : info?.hash === "#" + c.route;
    let good = applied && info.len > 150 && info.text > 10;
    if (c.marker && !info.markerOk) good = false;

  if (good) ok++; else fails.push(c.route);
  console.log(`${good ? "OK  " : "FAIL"} ${c.route.slice(0, 46).padEnd(48)} html=${info?.len} текст=${info?.text}${c.marker ? (info?.markerOk ? " ✓" : " ✗нет " + c.marker) : ""}`);
}

dev.ws.close();
console.log(`\nВложенные маршруты: ${ok}/${CASES.length}`);
if (fails.length) {
  console.error("ПРОБЛЕМЫ: " + fails.join(", "));
  process.exit(1);
}