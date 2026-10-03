// Глубокая ссылка на рецепт на настоящем Android.
// Раньше карточка рецепта была недостижима вообще: обработчик требовал
// в хэше и id, и название блюда, а Android WebView кодирует кириллицу.
import { launch, sleep } from "./device.mjs";

const dev = await launch({ fresh: true });
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  → " + detail : ""}`);
};

await dev.evaluate(`location.hash="#/recipes"`);
// Холодный старт: первый кадр рисуется не сразу, а список рецептов
// появляется после инициализации — ждём осмысленного состояния.
for (let i = 0; i < 20 && !(await dev.evaluate(`!!document.querySelector("a.recipe")`)); i++) await sleep(500);

// Ссылка берётся из DOM — так же, как нажимает человек.
const href = await dev.evaluate(`document.querySelector("a.recipe")?.getAttribute("href") || null`);
check("в списке есть ссылка на рецепт", !!href, href);

await dev.evaluate(`document.querySelector("a.recipe").click()`);
await sleep(1200);

const info = await dev.evaluate(`({
  hash: decodeURIComponent(location.hash),
  hasEat: !!document.querySelector("#rc-eat"),
  back: !!document.querySelector('a[href="#/recipes"]'),
  isList: !!document.querySelector("a.recipe")
})`);
check("клик открыл карточку, а не список", info.hasEat && !info.isList, info.hash);
// Ссылка содержит только id — сравниваем именно его.
check("хэш остался глубокой ссылкой", /^#\/recipes\/[^/]+$/.test(info.hash), info.hash);
check("есть возврат к списку", info.back);

// Все 10 рецептов должны открываться, а не только первый.
const all = await dev.evaluate(`
  (async () => {
    const out = [];
    for (const rec of Fit.RECIPES) {
      location.hash = "#/recipes/" + encodeURIComponent(rec.id);
      await new Promise(r => setTimeout(r, 260));
      out.push({ id: rec.id, ok: !!document.querySelector("#rc-eat"),
                 name: (document.querySelector("#view h1")?.innerText || "").trim() });
    }
    return out;
  })()
`);
const broken = all.filter((x) => !x.ok);
check(`открываются все ${all.length} рецептов`, broken.length === 0,
  broken.length ? broken.map((b) => b.id).join(",") : all[0].name);

// Кнопка должна реально писать в дневник — проверяем через публичный
// API хранилища, а не через внутренний ключ (он может переехать).
await dev.evaluate(`location.hash="#/recipes"`); await sleep(1200);
for (let i = 0; i < 20 && !(await dev.evaluate(`!!document.querySelector("a.recipe")`)); i++) await sleep(500);
await dev.evaluate(`document.querySelector("a.recipe").click()`); await sleep(1200);
const snap = () => dev.evaluate(`Fit.store.getNutrition(Fit.today()).length`);
const before = await snap();
await dev.evaluate(`document.querySelector("#rc-eat")?.click()`);
await sleep(900);
const after = await snap();
check("«Добавить в дневник» пишет запись", after === before + 1, `${before} → ${after}`);

// Неизвестный рецепт должен возвращать на список, а не падать.
await dev.evaluate(`location.hash="#/recipes/r-does-not-exist"`); await sleep(900);
const fallback = await dev.evaluate(`({ list: !!document.querySelector("a.recipe"), hash: location.hash })`);
check("неизвестный рецепт -> список", fallback.list && fallback.hash === "#/recipes");

dev.ws.close();
console.log(`\nИТОГ: ${checks.filter(Boolean).length}/${checks.length} на устройстве Android`);
process.exit(checks.every(Boolean) ? 0 : 1);