// Проверяет, что установленный APK действительно рисует приложение,
// а не пустой экран. Идёт по DevTools-сокету, прокинутому через adb.
import { launch, sleep } from "./device.mjs";

const dev = await launch();
await sleep(2500);

const value = await dev.evaluate(`(async () => {
  const q = (s) => document.querySelector(s);
  return {
    title: document.title,
    url: location.href,
    fitStore: typeof window.Fit?.store === "object",
    hash: location.hash,
    appHtmlLen: (q("#app")?.innerHTML || q("main")?.innerHTML || "").length,
    h1: (q("h1")?.textContent || "").trim(),
    navLinks: document.querySelectorAll(".nav-link, .m-bottom-nav a").length,
    bg: getComputedStyle(document.body).backgroundColor,
    scriptErrors: window.__formaErrors || null,
    // Признак пустой страницы: нет ни одного текстового узла в body
    textNodes: (document.body.innerText || "").trim().length
  };
})()`);

if (!value) {
  console.error("Ответ без значения — страница не отвечает.");
  dev.ws.close();
  process.exit(1);
}

console.log(JSON.stringify(value, null, 2));
dev.ws.close();

const problems = [];
if (!value.fitStore) problems.push("Fit.store отсутствует — скрипты не выполнились");
if (!value.textNodes) problems.push("body пустой — белый экран");
if (!value.appHtmlLen) problems.push("#app пуст — роутер ничего не отрендерил");
if (!value.navLinks) problems.push("нет ссылок навигации — layout не отрисовался");

if (problems.length) {
  console.error("\nПРОБЛЕМЫ:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log("\nWebView отрисовывает приложение.");