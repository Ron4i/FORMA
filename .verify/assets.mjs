// Сверяет три независимых списка ассетов, которые обязаны совпадать:
//   1) index.html          — что реально грузит страница
//   2. sw.js ASSETS        — что кэширует сервис-воркер (офлайн/PWA)
//   3) manifest.webmanifest— иконки приложения
// Расхождение не роняет страницу сразу, но тихо ломает офлайн и установку PWA,
// поэтому ловим его здесь, а не на устройстве. Сверка делается по index.html,
// который считается единственным источником правды (его же проверяет phone/prepare.mjs).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

let pass = 0;
const fail = [];
const check = (name, ok, detail = "") => {
  if (ok) { pass++; console.log(`OK   ${name}`); }
  else { fail.push(`${name}${detail ? " — " + detail : ""}`); console.log(`FAIL ${name}${detail ? " — " + detail : ""}`); }
};

/* 1. Ссылки из index.html */
const html = read("index.html");
const refs = new Set();
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = m[1];
  if (/^(https?:|data:|#|mailto:|\/\/)/.test(url)) continue;
  refs.add(url.replace(/^\.\//, ""));
}
refs.delete("");

/* 2. Список ASSETS из sw.js */
const sw = read("sw.js");
const block = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
if (!block) {
  console.error("FAIL список ASSETS в sw.js не найден — sw.js переписан?");
  process.exit(1);
}
const swAssets = new Set(
  block[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1).replace(/^\.\//, "")).filter(Boolean)
);
swAssets.add("index.html"); // "./" в списке — это он же

/* 3. Иконки манифеста */
const manifest = read("manifest.webmanifest");
const icons = new Set(
  [...manifest.matchAll(/"src"\s*:\s*"([^"]+)"/g)].map((m) => m[1].replace(/^\.\//, ""))
);

/* --- проверки --- */
for (const r of [...refs].sort()) {
  check(`index.html → sw.js: ${r}`, swAssets.has(r), "есть в странице, но нет в офлайн-кэше");
}
for (const a of [...swAssets].sort()) {
  // Иконки приходят из манифеста, а не из разметки страницы, — это законно.
  const wired = refs.has(a) || icons.has(a) || a === "index.html";
  check(`sw.js подключён: ${a}`, wired, "кэшируется, но не подключено ни в index.html, ни в манифесте");
}
for (const i of [...icons].sort()) {
  check(`манифест → sw.js: ${i}`, swAssets.has(i), "иконка есть в манифесте, но не в кэше");
}

/* Файлы из списков должны физически существовать */
for (const a of [...swAssets, ...icons].sort()) {
  check(`файл на диске: ${a}`, existsSync(normalize(join(ROOT, a))));
}

console.log(`\nИтог: ${pass} проверок пройдено`);
if (fail.length) {
  console.error(`\nРасхождения (${fail.length}):\n- ` + fail.join("\n- "));
  process.exit(1);
}
console.log("Списки ассетов синхронизированы: index.html ≡ sw.js ≡ manifest.");