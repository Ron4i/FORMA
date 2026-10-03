// Собирает самодостаточный бандл приложения в phone/www.
//
// Зачем отдельная папка, а не webDir: ".":
//   1. В корень проекта попадают site/, worker/, phone/, README и 75 МБ
//      чужих файлов — всё это не должно ехать в APK.
//   2. Capacitor требует, чтобы webDir был отдельным каталогом.
//
// Скрипт копирует ровно те файлы, на которые ссылается index.html,
// плюс манифест и иконки. Никакой минификации и сборки: порядок
// подключения скриптов в index.html значим и менять его нельзя.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const WWW = join(HERE, "www");

// Файлы, которые Capacitor кладёт в assets/public и отдаёт из WebView.
// sw.js здесь намеренно нет: внутри APK офлайн обеспечивает сам нативный
// слой, а регистрация service worker на capacitor:// не проходит.
const EXTRA = [
  "index.html",
  "manifest.webmanifest",
  "icons",
  "assets/css",
  "assets/js",
  "assets/vendor/leaflet",
];

rmSync(WWW, { recursive: true, force: true });
mkdirSync(WWW, { recursive: true });

let copied = 0;

// Копируем файлы по одному, а не каталогами через cpSync(..., {recursive}):
// на этом томе (OneDrive поверх NTFS) рекурсивный cpSync падает с
// 0xC0000409 (STATUS_STACK_BUFFER_OVERRUN) без стектрейса.
function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyTree(src, dst);
    else {
      copyFileSync(src, dst);
      copied++;
    }
  }
}

for (const entry of EXTRA) {
  const from = join(ROOT, entry);
  if (!existsSync(from)) {
    console.error("НЕТ ФАЙЛА: " + entry);
    process.exit(1);
  }
  if (statSync(from).isDirectory()) copyTree(from, join(WWW, entry));
  else {
    copyFileSync(from, join(WWW, entry));
    copied++;
  }
}

// Страховка от тихой рассинхронизации: если index.html ссылается на файл,
// которого в бандле нет, APK будет белым — и это выяснится уже на телефоне.
const html = readFileSync(join(WWW, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
const missing = refs.filter((r) => !/^https?:/.test(r) && !existsSync(join(WWW, r)));
if (missing.length) {
  console.error("В бандле не хватает файлов, на которые ссылается index.html:\n  " + missing.join("\n  "));
  process.exit(1);
}

// Внутри APK нет sw.js, поэтому регистрация service worker даст 404 и
// console-ошибку на каждом запуске. Гасим её на уровне navigator.
let coreJs = readFileSync(join(WWW, "assets/js/core.js"), "utf8");
const patched = coreJs.replace(
  '"serviceWorker" in navigator',
  "false /* service worker не нужен в нативной обёртке */"
);
if (patched === coreJs) {
  console.error("Не нашли регистрацию service worker в core.js — проверь вручную.");
  process.exit(1);
}
writeFileSync(join(WWW, "assets/js/core.js"), patched);

// Считаем, чтобы размер APK было видно сразу.
function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : statSync(p).size;
  }
  return total;
}

console.log(
  "Бандл собран: phone/www (" +
    Math.round(dirSize(WWW) / 1024) +
    " КБ, " +
    copied +
    " файлов, " +
    refs.length +
    " ссылок из index.html проверено)"
);