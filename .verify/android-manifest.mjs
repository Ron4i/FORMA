// Проверяет, что в ИТОГОВОМ манифесте Android есть всё, без чего приложение
// молча деградирует на реальном телефоне. Шаблон Capacitor объявляет только
// INTERNET, поэтому камера, геолокация и уведомления без ручного дописывания
// просто не работают — и никакой браузерный тест этого не поймает.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC = join(ROOT, "phone/android/app/src/main/AndroidManifest.xml");

// Шаблон Capacitor + то, что приложение реально вызывает в коде.
const REQUIRED = [
  ["android.permission.INTERNET", "сеть: ИИ-фото и бэкенд"],
  ["android.permission.CAMERA", "камера: съёмка еды (capture=environment)"],
  ["android.permission.ACCESS_FINE_LOCATION", "GPS: точная геолокация на карте"],
  ["android.permission.ACCESS_COARSE_LOCATION", "GPS: приблизительная геолокация"],
  ["android.permission.POST_NOTIFICATIONS", "push: Notification.requestPermission на Android 13+"],
];

let pass = 0;
const fail = [];

if (!existsSync(SRC)) {
  console.error("Нет исходного AndroidManifest.xml — запустите `npx cap add android`.");
  process.exit(1);
}
const xml = readFileSync(SRC, "utf8");

for (const [perm, why] of REQUIRED) {
  const re = new RegExp(`uses-permission\\s+android:name\\s*=\\s*"${perm.replace(/\./g, "\\.")}"`);
  if (re.test(xml)) { pass++; console.log(`OK   ${perm} — ${why}`); }
  else { fail.push(`${perm} (${why})`); console.log(`FAIL ${perm} — ${why}`); }
}

// Камера и GPS должны быть необязательными, иначе приложение не встанет
// на устройства без них. Имена фич — канонические из документации Android:
// камера это android.hardware.camera, спутниковый GPS — android.hardware.location.gps.
for (const feature of ["android.hardware.camera", "android.hardware.location.gps"]) {
  const re = new RegExp(`uses-feature[^>]*android:name\\s*=\\s*"${feature.replace(/\./g, "\\.")}"[^>]*required\\s*=\\s*"false"`);
  if (re.test(xml)) { pass++; console.log(`OK   ${feature} required="false" — не блокирует установку`); }
  else { fail.push(`${feature} не объявлен optional`); console.log(`FAIL ${feature} required="false"`); }
}

// Если есть собранный манифест — сверяем с ним: правится на этапе mergeManifest.
const merged = join(ROOT, "phone/android/app/build/intermediates/merged_manifest/release/AndroidManifest.xml");
if (existsSync(merged)) {
  const mxml = readFileSync(merged, "utf8");
  for (const [perm] of REQUIRED) {
    if (mxml.includes(perm)) { pass++; console.log(`OK   merged: ${perm}`); }
    else { fail.push(`в собранном манифесте потерялось: ${perm}`); console.log(`FAIL merged: ${perm}`); }
  }
} else {
  console.log("— собранный манифест не найден, проверен только исходный (запустите npm run apk:release)");
}

console.log(`\nИтог: ${pass} проверок пройдено`);
if (fail.length) {
  console.error(`\nПроблемы (${fail.length}):\n- ` + fail.join("\n- "));
  process.exit(1);
}
console.log("Манифест Android содержит все нужные разрешения.");