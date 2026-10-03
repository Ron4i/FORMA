/* FORMA — Push-уведомления.
   Работает в два режима:
   1) Нативный Web Push (Service Worker + PushManager) — работает в закрытом приложении.
   2) Фолбэк: локальный планировщик через Notification API + таймер, пока вкладка открыта.
   VAPID-ключи генерируются локально и хранятся; сервер отправки подключается позже. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  function urlB64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function supported() {
    return typeof Notification !== "undefined";
  }

  function permission() {
    return supported() ? Notification.permission : "unsupported";
  }

  async function requestPermission() {
    if (!supported()) return "unsupported";
    try {
      const p = await Notification.requestPermission();
      store.setNotifyCfg({ permission: p, enabled: p === "granted" });
      return p;
    } catch (e) {
      return "error";
    }
  }

  // Показать уведомление (через SW, если доступен, иначе напрямую).
  async function show(title, opts) {
    if (permission() !== "granted") return false;
    opts = opts || {};
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg && reg.showNotification) {
          await reg.showNotification(title, {
            body: opts.body || "",
            icon: opts.icon || "icons/icon-192.png",
            badge: opts.badge || "icons/icon-192.png",
            tag: opts.tag || "forma",
            data: { url: opts.url || "#/" },
            requireInteraction: !!opts.sticky
          });
          return true;
        }
      }
      new Notification(title, {
        body: opts.body || "",
        icon: opts.icon || "icons/icon-192.png",
        tag: opts.tag || "forma"
      });
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---- Планировщик: вызывает show() по расписанию, пока открыта вкладка ----
  let timer = null;

  function nextRun(tpl, now) {
    const cur = now.getHours() * 60 + now.getMinutes();
    const lo = tpl.min * 60;
    const hi = tpl.max * 60;
    if (cur >= hi) {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      d.setHours(tpl.min, 0, 0, 0);
      return d.getTime();
    }
    if (cur < lo) {
      const d = new Date(now);
      d.setHours(tpl.min, 0, 0, 0);
      return d.getTime();
    }
    return now.getTime() + tpl.every * 60 * 1000;
  }

  function check() {
    const cfg = store.getNotifyCfg();
    if (permission() !== "granted") return;
    const now = new Date();
    Fit.NOTIFY_TEMPLATES.forEach((tpl) => {
      if (!store.isScheduleOn(tpl.id)) return;
      const last = store.lastSent(tpl.id) || 0;
      const due =
        now.getHours() >= tpl.min &&
        now.getHours() <= tpl.max &&
        now - last >= tpl.every * 60 * 1000;
      if (due) {
        show(tpl.e + " " + tpl.n, { body: personalize(tpl), tag: "forma-" + tpl.id, url: urlFor(tpl.id) });
        store.noteSent(tpl.id);
      }
    });
  }

  function personalize(tpl) {
    const p = store.getProfile() || store.getProfileOr();
    const m = Fit.calcMetrics(p);
    const total = store.nutritionTotals(Fit.today());
    switch (tpl.id) {
      case "water": {
        const goal = p.waterGoal || 2000;
        const cur = store.getWater();
        return cur >= goal ? "Цель по воде выполнена! 💧" : "Выпито " + cur + " из " + goal + " мл. Ещё " + (goal - cur) + " мл.";
      }
      case "weigh": {
        const ms = store.getMeasurements();
        const last = ms.length ? ms[ms.length - 1].weight : p && p.weight;
        return last ? "Прошлый вес: " + last + " кг. Запишите новый ⚖️" : "Первое взвешивание — начните отсчёт ⚖️";
      }
      case "meal": {
        if (!m) return "Настройте профиль — получите персональную норму.";
        return "Сегодня: " + Math.round(total.kcal) + " / " + m.target + " ккал. Осталось " + Math.max(0, m.target - total.kcal) + " 🥗";
      }
      case "workout": {
        const s = Fit.streak ? Fit.streak() : 0;
        return s ? "Серия: " + s + " дн. Не прерывайте! 🔥" : "Тренировка 15 минут лучше, чем ничего 💪";
      }
      case "scancap":
        return "Сфотографируйте еду — 30 секунд на подсчёт 📸";
      case "streak": {
        const s = Fit.streak ? Fit.streak() : 0;
        return s > 1 ? "Серия " + s + " дней! Ещё один — и рекорд 🔥" : "Начните серию сегодня 🔥";
      }
      case "inactive":
        return "5 минут прогулки = 20–40 ккал. Встаньте прямо сейчас 🚶";
      default:
        return tpl.d;
    }
  }

  function urlFor(id) {
    switch (id) {
      case "water": return "#/nutrition";
      case "weigh": return "#/progress";
      case "meal": return "#/nutrition";
      case "workout": return "#/routines";
      case "scancap": return "#/scan";
      case "streak": return "#/";
      case "inactive": return "#/activity";
      default: return "#/";
    }
  }

  function start() {
    stop();
    check();
    timer = setInterval(check, 60 * 1000);
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  // Тестовое уведомление из настроек
  async function test() {
    const p = store.getProfile();
    return show("FORMA на связи 🔔", {
      body: "Так выглядят ваши уведомления. Настройте расписание ниже.",
      tag: "forma-test",
      sticky: false
    });
  }

  // ---- Web Push (настоящие фоновые пуши, требуют сервера) ----
  async function subscribePush(vapidPublic) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return { ok: false, error: "Браузер не поддерживает Web Push" };
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(vapidPublic)
    });
    return { ok: true, sub };
  }

  Fit.push = {
    supported,
    permission,
    requestPermission,
    show,
    test,
    start,
    stop,
    check,
    nextRun,
    subscribePush,
    personalize,
    urlFor
  };
})();
