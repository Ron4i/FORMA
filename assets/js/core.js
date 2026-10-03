(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function qs(s, r) {
    return (r || document).querySelector(s);
  }
  function qsa(s, r) {
    return Array.from((r || document).querySelectorAll(s));
  }
  function money(n) {
    return (n || 0).toLocaleString("ru-RU");
  }
  function fmtDate(d) {
    try {
      return new Date(d).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return d;
    }
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  }
  Fit.esc = esc;

  function toast(msg, type) {
    // Делегируем в мобильный тост, если модуль уже загружен.
    if (Fit.mToast) return Fit.mToast(msg, type);
    let t = qs("#toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "toast show " + (type || "");
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.className = "toast"), 2600);
  }

  function confirmDialog(msg) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.innerHTML =
        '<div class="modal"><p>' + esc(msg) + '</p><div class="modal-actions">' +
        '<button class="btn ghost" data-no>Отмена</button>' +
        '<button class="btn danger" data-yes>Да</button></div></div>';
      document.body.appendChild(overlay);
      qs("[data-yes]", overlay).onclick = () => {
        overlay.remove();
        resolve(true);
      };
      qs("[data-no]", overlay).onclick = () => {
        overlay.remove();
        resolve(false);
      };
    });
  }
  Fit.confirmDialog = confirmDialog;

  function muscleLabel(id) {
    const m = Fit.MUSCLE_GROUPS.find((x) => x.id === id);
    return m ? m.label : id;
  }
  function equipLabel(id) {
    const m = Fit.EQUIPMENT.find((x) => x.id === id);
    return m ? m.label : id;
  }
  Fit.muscleLabel = muscleLabel;
  Fit.equipLabel = equipLabel;

  function calcMetrics(p) {
    if (!p || !p.weight || !p.height || !p.age) return null;
    const w = +p.weight,
      h = +p.height / 100,
      age = +p.age;
    const bmi = w / (h * h);
    let bmr;
    if (p.sex === "female") bmr = 10 * w + 6.25 * (+p.height) - 5 * age - 161;
    else bmr = 10 * w + 6.25 * (+p.height) - 5 * age + 5;
    const factors = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, athlete: 1.9 };
    const tdee = bmr * (factors[p.activity] || 1.2);
    let target = tdee;
    if (p.goal === "lose") target = tdee - 400;
    else if (p.goal === "gain") target = tdee + 300;
    return { bmi: Math.round(bmi * 10) / 10, bmr: Math.round(bmr), tdee: Math.round(tdee), target: Math.round(target) };
  }
  Fit.calcMetrics = calcMetrics;

  function workoutVolume(w) {
    let v = 0;
    (w.exercises || []).forEach((ex) => {
      (ex.sets || []).forEach((s) => {
        v += (+s.reps || 0) * (+s.weight || 0);
      });
    });
    return v;
  }
  Fit.workoutVolume = workoutVolume;

  function streak() {
    const days = store
      .getWorkouts()
      .map((w) => w.date.slice(0, 10))
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();
    if (!days.length) return 0;
    let s = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const a = new Date(days[i]);
      const b = new Date(days[i - 1]);
      const diff = (a - b) / 86400000;
      if (diff === 1) s++;
      else break;
    }
    const last = new Date(days[days.length - 1]);
    const today = new Date(Fit.today());
    if ((today - last) / 86400000 > 1) return 0;
    return s;
  }

  const routes = {};
  const binds = {};
  Fit.register = function (path, fn, bind) {
    routes[path] = fn;
    if (bind) binds[path] = bind;
  };
  Fit.VIEW_BINDS = binds;

  function parseHash() {
    let h = location.hash.replace(/^#/, "");
    if (!h || h === "/") return { path: "/", parts: [] };
    const parts = h.split("/").filter(Boolean);
    return { path: "/" + parts[0], parts };
  }
  Fit.parseHash = parseHash;

  function navigate(hash) {
    if (location.hash === hash) renderTo();
    else location.hash = hash;
  }
  Fit.navigate = navigate;

  Fit.bind = function (fn) {
    const v = qs("#view");
    if (v) v._bind = fn;
  };

  function setActiveNav() {
    const r = parseHash();
    // Вложенные маршруты (/activity/route/:id) подсвечиваем по корню раздела.
    qsa(".nav-link, .m-bottom-nav a, .bottom-nav a").forEach((a) => {
      const target = a.getAttribute("data-route");
      a.classList.toggle("active", target === r.path || (target && r.path.indexOf(target + "/") === 0));
    });
  }

  const NAV = [
    { route: "/", icon: "home", label: "Главная" },
    { route: "/routines", icon: "routines", label: "Тренировки" },
    { route: "/activity", icon: "activity", label: "Активность" },
    { route: "/scan", icon: "scan", label: "Скан" },
    { route: "/nutrition", icon: "nutrition", label: "Питание" },
    { route: "/feed", icon: "feed", label: "Лента" },
    { route: "/coach", icon: "coach", label: "ИИ-тренер" },
    { route: "/exercises", icon: "exercises", label: "Упражнения" },
    { route: "/progress", icon: "progress", label: "Прогресс" },
    { route: "/challenges", icon: "challenges", label: "Челленджи" },
    { route: "/recipes", icon: "recipes", label: "Рецепты" },
    { route: "/profile", icon: "profile", label: "Профиль" },
    { route: "/settings", icon: "settings", label: "Настройки" }
  ];
  Fit.NAV = NAV;

  // Пять главных вкладок мобильной навигации. Остальные экраны живут
  // внутри разделов и доступны с них — чтобы не прятать действия в меню.
  const TABS = [
    { route: "/", icon: "home", label: "Главная" },
    { route: "/routines", icon: "routines", label: "Тренировки" },
    { route: "/activity", icon: "activity", label: "Активность" },
    { route: "/progress", icon: "progress", label: "Прогресс" },
    { route: "/profile", icon: "profile", label: "Профиль" }
  ];
  Fit.TABS = TABS;

  function layout(inner) {
    return (
      '<aside class="sidebar">' +
      '<a class="brand" href="#/"><span class="brand-mark">F</span><span>FOR<b>MA</b></span></a>' +
      '<div class="brand-tag">Сфоткай еду. Похудей на результат.</div>' +
      "<nav>" +
      NAV.map(navLink).join("") +
      "</nav>" +
      '<div class="side-foot"><button class="btn btn-ghost btn-sm" data-act="install" hidden>📲 Установить</button></div>' +
      "</aside>" +
      '<main class="main m-main" id="app-inner">' + inner + "</main>"
    );
  }
  function navLink(n) {
    return (
      '<a class="nav-link" data-route="' + n.route + '" href="#' + n.route + '">' +
      '<span class="ni">' + iconSvg(n.icon) + "</span>" + n.label + "</a>"
    );
  }

  /* Инлайновые SVG-иконки: работают офлайн, не тянут шрифты. */
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>',
    scan: '<path d="M3 8V5a2 2 0 0 1 2-2h3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M21 16v3a2 2 0 0 1-2 2h-3"/><path d="M3.5 12h17"/>',
    nutrition: '<path d="M12 21c5-3 7-6.5 7-10a5 5 0 0 0-9.5-2A5 5 0 0 0 5 11c0 3.5 2 7 7 10Z"/>',
    routines: '<path d="M4 9h16"/><path d="M4 9v6"/><path d="M20 9v6"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6 6h12"/>',
    feed: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="9" cy="9" r="1.6"/><path d="m4 17 4.5-4.5 3 3L16 11l4 4"/>',
    coach: '<rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 7V4"/><circle cx="9" cy="13" r="1.2"/><circle cx="15" cy="13" r="1.2"/><path d="M9.5 16.5h5"/>',
    activity: '<path d="M3 13.5 8 8l4 4 4-5 5 6"/><path d="M3 20h18"/>',
    exercises: '<path d="M3 12h3"/><path d="M18 12h3"/><path d="M6 9v6"/><path d="M15 9v6"/><path d="M6 12h9"/>',
    progress: '<path d="M4 20V6"/><path d="M4 20h16"/><path d="m7 15 3-4 3 2 4-6"/>',
    challenges: '<path d="M12 3 4 7v6c0 4.5 3.4 7.5 8 8.5 4.6-1 8-4 8-8.5V7Z"/><path d="m9 12 2 2 4-4"/>',
    recipes: '<path d="M6 3v8a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2V3"/><path d="M6 3v8"/><path d="M8 3v8"/><path d="M10 3v8"/><path d="M17 3c-1.5 3-2 5-2 7s.8 3 2 3v8"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"/>',
    water: '<path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    check: '<path d="m5 13 4 4L19 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7c0 4.9-7 9.3-7 9.3Z"/>',
    chat: '<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4Z"/>',
    back: '<path d="m14 6-6 6 6 6"/>',
    share: '<path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/>',
    fire: '<path d="M12 3s.5 3-1.5 5.5S8 13 8 15a4 4 0 0 0 8 0c0-2-1-3-1-3s.5 2 1.5 2.5c1.5 1 2 2.5 2 4a6.5 6.5 0 0 1-13 0C5.5 12 12 10 12 3Z"/>',
    bell: '<path d="M6 16V10a6 6 0 0 1 12 0v6l1.5 2.5h-15Z"/><path d="M10 20a2 2 0 0 0 4 0"/>'
  };
  function iconSvg(name) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.home) +
      "</svg>"
    );
  }
  Fit.iconSvg = iconSvg;

  function emptyState(text, action) {
    return '<div class="empty">' + esc(text) + (action ? "<div>" + action + "</div>" : "") + "</div>";
  }

  Fit.emptyState = emptyState;
  Fit.layout = layout;

  /* Цвета берём из CSS-переменных, а не из констант: тогда графики
     следуют за темой и не остаются неоновыми после смены палитры.
     Canvas не знает про CSS, поэтому читаем токен с documentElement. */
  function chartInk(name, fallback) {
    try {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v || "").trim() || fallback;
    } catch (e) {
      return fallback;
    }
  }
  Fit.chartInk = chartInk;

  function lineChart(canvas, points, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const hgt = canvas.clientHeight || 180;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    if (!points.length) {
      ctx.fillStyle = chartInk("--muted", "#9ca3af");
      ctx.font = "13px sans-serif";
      ctx.fillText("Нет данных", 10, hgt / 2);
      return;
    }
    const pad = 36;
    const vals = points.map((p) => p.v);
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (min === max) {
      min -= 1;
      max += 1;
    }
    const range = max - min;
    const x = (i) => pad + (i * (w - pad - 10)) / (points.length - 1 || 1);
    const y = (v) => hgt - pad - ((v - min) / range) * (hgt - pad - 18);
    ctx.strokeStyle = chartInk("--line", "#374151");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, hgt - pad);
    ctx.lineTo(w - 10, hgt - pad);
    ctx.moveTo(pad, 14);
    ctx.lineTo(pad, hgt - pad);
    ctx.stroke();
    ctx.fillStyle = chartInk("--muted", "#6b7280");
    ctx.font = "11px sans-serif";
    ctx.fillText(String(max), 4, 16);
    ctx.fillText(String(min), 4, hgt - pad);
    ctx.strokeStyle = chartInk("--accent", "#22c55e");
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = x(i),
        py = y(p.v);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
    ctx.fillStyle = chartInk("--accent", "#22c55e");
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(p.v), 3, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = chartInk("--muted", "#9ca3af");
    ctx.font = "10px sans-serif";
    points.forEach((p, i) => {
      if (points.length <= 12 || i % Math.ceil(points.length / 8) === 0)
        ctx.fillText(p.l, x(i) - 8, hgt - pad + 14);
    });
  }

  function barChart(canvas, bars, opts) {
    opts = opts || {};
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const hgt = canvas.clientHeight || 180;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, hgt);
    if (!bars.length) {
      ctx.fillStyle = chartInk("--muted", "#9ca3af");
      ctx.font = "13px sans-serif";
      ctx.fillText("Нет данных", 10, hgt / 2);
      return;
    }
    const pad = 28;
    const max = Math.max.apply(null, bars.map((b) => b.v)) || 1;
    const bw = (w - pad - 10) / bars.length;
    ctx.strokeStyle = chartInk("--line", "#374151");
    ctx.beginPath();
    ctx.moveTo(pad, 14);
    ctx.lineTo(pad, hgt - pad);
    ctx.lineTo(w - 10, hgt - pad);
    ctx.stroke();
    bars.forEach((b, i) => {
      const bh = (b.v / max) * (hgt - pad - 18);
      const bx = pad + i * bw + bw * 0.15;
      const by = hgt - pad - bh;
      ctx.fillStyle = b.v ? chartInk("--accent", "#22c55e") : chartInk("--line-soft", "#374151");
      ctx.fillRect(bx, by, bw * 0.7, bh);
      ctx.fillStyle = chartInk("--muted", "#9ca3af");
      ctx.font = "9px sans-serif";
      ctx.fillText(b.l, bx - 2, hgt - pad + 12);
      if (b.v) {
        ctx.fillStyle = chartInk("--text", "#e5e7eb");
        ctx.font = "10px sans-serif";
        ctx.fillText(String(b.v), bx, by - 3);
      }
    });
  }

  Fit.lineChart = lineChart;
  Fit.barChart = barChart;
  Fit.qs = qs;
  Fit.qsa = qsa;
  Fit.toast = toast;
  Fit.streak = streak;
  Fit.fmtDate = fmtDate;
  Fit.fmtTime = fmtTime;

  function drawCharts() {
    qsa("canvas[data-chart]").forEach((cv) => {
      const name = cv.getAttribute("data-chart");
      if (name === "weight") {
        const ms = store.getMeasurements().filter((m) => m.weight);
        lineChart(
          cv,
          ms.map((m) => ({ l: m.date.slice(5), v: +m.weight }))
        );
      } else if (name === "weekly") {
        const weeks = lastWeeks(8);
        barChart(
          cv,
          weeks.map((wk) => ({
            l: wk.label,
            v: store.getWorkouts().filter((w) => w.date >= wk.start && w.date <= wk.end).length
          }))
        );
      }
    });
  }
  Fit.drawCharts = drawCharts;

  function lastWeeks(n) {
    const out = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      out.push({
        label: start.getDate() + "." + (start.getMonth() + 1),
        start: start.toISOString().slice(0, 10),
        end: end.toISOString().slice(0, 10)
      });
    }
    return out;
  }
  Fit.lastWeeks = lastWeeks;

  document.addEventListener("DOMContentLoaded", () => {
    store.ensurePresets();
    if (Fit.social) Fit.social.seed();
    applyTheme();
    const root = qs("#root");
    root.innerHTML =
      '<div class="app-shell">' +
      layout('<div id="view"></div>') +
      "</div>" +
      '<nav class="m-bottom-nav" aria-label="Основная навигация">' +
      TABS.map(
        (t) =>
          '<a href="#' + t.route + '" data-route="' + t.route + '">' +
          iconSvg(t.icon) +
          "<span>" + t.label + "</span></a>"
      ).join("") +
      "</nav>";

    // Мобильные примитивы: тосты, шторки, баннер активной GPS-записи.
    if (Fit.initGpsBanner) Fit.initGpsBanner();
    Fit.enablePullToRefresh(qs("#view"));

    window.addEventListener("hashchange", () => {
      renderTo();
    });
    renderTo();

    // PWA: регистрация service worker + локальный планировщик уведомлений
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("./sw.js").catch(() => null);
      });
    }
    if (Fit.push) Fit.push.start();

    // Кнопка «Установить приложение» (Chrome/Edge/Android)
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      qsa('[data-act="install"]').forEach((b) => (b.hidden = false));
    });
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-act="install"]');
      if (!btn || !deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });

    // Перерисовка карты при повороте экрана / смене темы.
    window.addEventListener("resize", () => {
      if (Fit.gpsView && Fit.gpsView.ensureMap) {
        const el = qs("#act-map") || qs("#rt-map");
        if (el) Fit.gpsView.ensureMap(el);
      }
    });
  });

  function renderTo() {
    const r = parseHash();
    let view = routes[r.path];
    if (!view) view = routes["/"];
    const inner = qs("#view");
    inner.innerHTML = "";
    inner._bind = binds[r.path] || null;
    const out = view(r);
    if (typeof out === "string") inner.innerHTML = out;
    else if (out) inner.appendChild(out);
    if (inner._bind) inner._bind(inner);
    setActiveNav();
    drawCharts();
    window.scrollTo(0, 0);
  }
  Fit.renderTo = renderTo;

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", store.getTheme());
  }
  Fit.applyTheme = applyTheme;
})();
