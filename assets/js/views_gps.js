/* FORMA — экран «Активность».
   Карта на Leaflet (тайлы кэшируются service worker'ом, работает офлайн),
   живая статистика, сплиты, история маршрутов и честный экран приватности. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;
  const gps = Fit.gps;
  const esc = Fit.esc;
  const qs = Fit.qs;
  const qsa = Fit.qsa;

  let map = null;
  let polyline = null;
  let marker = null;
  let circle = null;
  let tileLayer = null;
  let unsubscribe = [];
  let followMode = true;

  /* ------------------------------------------------------------------ */
  /* Карта                                                                */
  /* ------------------------------------------------------------------ */

  function tileUrl() {
    // В тёмной теме используем CartoDB dark — читается на улице и не слепит ночью.
    const dark = document.documentElement.getAttribute("data-theme") !== "light";
    return dark
      ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  }

  function ensureMap(el) {
    if (!el) return null;
      // Карта привязана к конкретному DOM-узлу. При переходе на другой экран
      // (список маршрутов → детали) узел предыдущей карты уже удалён из DOM,
      // поэтому invalidateSize() недостаточно — нужно пересоздать карту.
      if (map && map.getContainer() !== el) {
        try {
          map.remove();
        } catch (e) {}
        map = null;
        polyline = null;
        marker = null;
        circle = null;
        tileLayer = null;
      }
      if (map) {
        map.invalidateSize();
        return map;
      }
    if (typeof L === "undefined") {
      el.innerHTML =
        '<div class="m-empty" style="height:100%;display:grid;place-content:center;border:0">' +
        '<div class="ei">🗺️</div><div class="et">Карта недоступна</div>' +
        '<div class="es">Библиотека карты не загрузилась. Маршруты и статистика работают без неё.</div></div>';
      return null;
    }
    map = L.map(el, {
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      tap: true
    }).setView([55.751244, 37.618423], 13);

    tileLayer = L.tileLayer(tileUrl(), {
      maxZoom: 19,
      crossOrigin: true,
      attribution: "© OpenStreetMap, © CARTO"
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);
    circle = L.circle([55.751244, 37.618423], {
      radius: 25,
      color: "#22c55e",
      weight: 1,
      fillColor: "#22c55e",
      fillOpacity: 0.18
    }).addTo(map);
    polyline = L.polyline([], {
      color: "#22c55e",
      weight: 4,
      opacity: 0.95,
      lineJoin: "round"
    }).addTo(map);
    marker = L.circleMarker([55.751244, 37.618423], {
      radius: 6,
      color: "#fff",
      weight: 2,
      fillColor: "#22c55e",
      fillOpacity: 1
    }).addTo(map);
    return map;
  }

  function clearTrack() {
    if (polyline) polyline.setLatLngs([]);
    if (marker) marker.setLatLng([]);
  }

  function fitToPoints(pts, pad) {
    if (!map || !pts || !pts.length) return;
    const latlngs = pts.map((p) => [p.lat, p.lng]);
    try {
      map.fitBounds(L.latLngBounds(latlngs).pad(pad == null ? 0.25 : pad));
    } catch (e) {
      map.setView(latlngs[0], 15);
    }
  }

  function drawRoute(route) {
    if (!map) return;
    const pts = (route && route.points) || [];
    if (!pts.length) return;
    polyline.setLatLngs(pts.map((p) => [p.lat, p.lng]));
    const first = pts[0];
    marker.setLatLng([first.lat, first.lng]);
    circle.setLatLng([first.lat, first.lng]);
    fitToPoints(pts, 0.2);
  }

  function focusLive() {
    const snap = gps.snapshot();
    if (!snap || !map) return;
    const s = store.getState().gpsDraft;
    const live = snap.last || null;
    const p = live || (s && s.points ? s.points[s.points.length - 1] : null);
    if (p) {
      map.setView([p.lat, p.lng], Math.max(map.getZoom(), 16), { animate: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Отрисовка                                                            */
  /* ------------------------------------------------------------------ */

  function metricCard(cls, icon, value, unit, label, onclick) {
    return (
      '<button class="m-metric ' + cls + '"' + (onclick ? ' data-detail="' + onclick + '"' : "") + ">" +
      '<span class="mi">' + icon + "</span>" +
      '<span class="mv">' + esc(value) + (unit ? "<small>" + esc(unit) + "</small>" : "") + "</span>" +
      '<span class="ml">' + esc(label) + "</span></button>"
    );
  }

  function privacyCard() {
    const mode = gps.getPrivacyMode();
    const modes = gps.PRIVACY_MODES;
    return (
      '<div class="surface" style="margin:14px 0 0;padding:14px">' +
      '<div style="display:flex;align-items:center;gap:9px;margin-bottom:9px">' +
      '<b style="font-size:14px">🔒 Приватность геолокации</b>' +
      '<span class="tag" style="margin-left:auto">' + esc(modes[mode].label) + "</span></div>" +
      Object.keys(modes)
        .map(
          (k) =>
            '<button class="list-row" data-privacy="' + k + '" style="width:100%;text-align:left;border:0;cursor:pointer">' +
            '<div style="display:flex;align-items:center;gap:10px;flex:1">' +
            '<span style="font-size:19px">' + modes[k].icon + "</span>" +
            '<span><b style="font-size:13.5px">' + esc(modes[k].label) + "</b>" +
            '<span class="muted" style="display:block;font-size:11.5px;line-height:1.4">' + esc(modes[k].desc) + "</span></span></div>" +
            (k === mode ? '<span style="color:var(--accent);font-weight:800">✓</span>' : "") +
            "</div></button>"
        )
        .join("") +
      '<p class="muted" style="font-size:11.5px;margin:10px 0 0;line-height:1.5">' +
      "Приложение не отправляет ваши координаты на сервер. Маршруты хранятся только на этом устройстве. " +
      "GPS включается исключительно по вашему нажатию и выключается кнопкой «Стоп».</p>" +
      '<button class="btn ghost sm" data-act="forget-geo" style="margin-top:10px;width:100%">🗑️ Удалить все геоданные</button>' +
      "</div>"
    );
  }

  function livePanel(snap) {
    if (!snap) return "";
    const splits = snap.splits || [];
    const doneSplits = splits.filter((s) => !s.partial);
    const bestPace = doneSplits.length ? Math.min.apply(null, doneSplits.map((s) => s.pace)) : Infinity;
    const type = gps.ACTIVITY_TYPES[snap.type] || gps.ACTIVITY_TYPES.other;

    let h =
      '<div class="surface" id="live-panel" style="margin:12px 0;padding:16px;border-color:color-mix(in srgb, var(--accent) 35%, var(--line))">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">' +
      '<span style="font-size:22px">' + type.icon + "</span>" +
      '<div style="flex:1"><b style="font-size:15px">' + esc(type.label) + " · запись</b>" +
      '<div class="muted" style="font-size:11.5px">' +
      (snap.source === "manual" ? "ручной ввод" : "GPS · точность ±" + (snap.accuracy == null ? "—" : snap.accuracy) + " м") +
      "</div></div>" +
      '<span class="tag" id="live-state" style="background:var(--accent-soft);color:var(--accent);border:0">' +
      (snap.paused ? (snap.autoPaused ? "Автопауза" : "Пауза") : "● Идёт") + "</span></div>" +
      '<div class="timer" data-live="time" style="font-size:44px;text-align:center;margin:10px 0 4px;font-variant-numeric:tabular-nums">' +
      esc(snap.elapsedLabel) + "</div>" +
      '<div class="m-grid g3" style="margin-top:12px">' +
      '<button class="m-metric" data-detail="distance"><span class="mi">📍</span>' +
      '<span class="mv" data-live="dist">' + esc(snap.distanceLabel) + "<small>км</small></span>" +
      '<span class="ml">Дистанция</span></button>' +
      '<button class="m-metric blue" data-detail="time"><span class="mi">⏱️</span>' +
      '<span class="mv" data-live="pace">' + esc(snap.paceLabel) + "<small>/км</small></span>" +
      '<span class="ml">Темп</span></button>' +
      metricCard("amber", "⬆️", snap.elevGain, "м", "Набор высоты") +
      "</div>";

    if (snap.rejected > 3) {
      h +=
        '<p class="muted" style="font-size:11.5px;margin:10px 0 0;line-height:1.45">' +
        "Отфильтровано " + snap.rejected + " неточных точек GPS — это нормально в городе.</p>";
    }

    h +=
      '<div style="display:flex;gap:9px;margin-top:14px">' +
      '<button class="btn ghost" data-act="toggle-pause" style="flex:1">' +
      (snap.paused ? "▶️ Продолжить" : "⏸ Пауза") + "</button>" +
      '<button class="btn danger" data-act="stop-rec" style="flex:1.4">⏹ Остановить запись</button>' +
      "</div></div>";
    return h;
  }

  function statsPanel() {
    const routes = gps.getRoutes();
    const today = Fit.today();
    const week = routes.filter((r) => (r.date || "").slice(0, 10) >= Fit.today(-6));
    const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
    const todayRoutes = routes.filter((r) => (r.date || "").slice(0, 10) === today);
    const steps = store.getSteps(today) || 0;

    return (
      '<h2 class="section">Сводка</h2>' +
      '<div class="m-grid g2">' +
      metricCard("accent", "📍", (sum(todayRoutes, (r) => r.distance) / 1000).toFixed(2), "км", "Маршруты сегодня", "distance") +
      metricCard("blue", "⏱️", gps.fmtDuration(sum(week, (r) => r.duration)), "", "Время за 7 дней", "time") +
      metricCard("rose", "⬆️", Math.round(sum(week, (r) => r.elevGain)), "м", "Высота за неделю", "elevation") +
      metricCard("violet", "🔥", Math.round(sum(week, (r) => r.kcal)), "ккал", "Калории за неделю", "calories") +
      "</div>" +
      '<div class="m-grid g2" style="margin-top:12px">' +
      metricCard("", "👟", steps.toLocaleString("ru-RU"), "", "Шагов сегодня", "steps") +
      metricCard("", "🏃", routes.length, "", "Всего маршрутов", "routes") +
      "</div>"
    );
  }

  function routeRow(r) {
    const t = gps.ACTIVITY_TYPES[r.type] || gps.ACTIVITY_TYPES.other;
    const km = (r.distance || 0) / 1000;
    const dur = r.duration || 0;
    const pace = dur > 0 && km > 0.01 ? dur / 60 / km : Infinity;
    return (
      '<div class="list-row" data-route="' + esc(r.id) + '" style="cursor:pointer">' +
      '<div style="display:flex;align-items:center;gap:11px;flex:1;min-width:0">' +
      '<span style="font-size:20px">' + t.icon + "</span>" +
      '<div style="min-width:0"><b style="font-size:14px">' + esc(t.label) + "</b>" +
      '<span class="muted" style="display:block;font-size:11.5px">' + Fit.fmtDate(r.date) + " · " + gps.fmtDuration(dur) +
      (r.elevGain ? " · ⬆" + Math.round(r.elevGain) + "м" : "") + "</span></div></div>" +
      '<div style="text-align:right;flex:0 0 auto">' +
      '<b style="font-size:14px">' + km.toFixed(2) + " км</b>" +
      '<span class="muted" style="display:block;font-size:11.5px">' +
      (isFinite(pace) ? pace.toFixed(2) + " мин/км" : "—") + "</span></div></div>"
    );
  }

  function historyPanel() {
    const routes = gps.getRoutes();
    if (!routes.length) {
      return (
        '<h2 class="section">История маршрутов</h2>' +
        '<div class="m-empty"><div class="ei">🗺️</div>' +
        '<div class="et">Маршрутов пока нет</div>' +
        '<div class="es">Запишите первую активность — маршрут сохранится на устройстве, и его можно будет посмотреть на карте или удалить.</div>' +
        '<button class="btn primary" data-act="start-rec">Начать запись</button></div>'
      );
    }
    return (
      '<h2 class="section">История маршрутов <span class="muted" style="font-size:13px;font-weight:600">' + routes.length + "</span></h2>" +
      '<div class="list">' + routes.slice(0, 25).map(routeRow).join("") + "</div>" +
      (routes.length > 25
        ? '<p class="muted" style="font-size:12px;margin:10px 0 0">Показаны последние 25 из ' + routes.length + ". Все маршруты выгружаются в CSV в настройках.</p>"
        : "") +
      '<button class="btn ghost sm" data-act="forget-geo" style="margin-top:12px;width:100%">🗑️ Удалить всю историю маршрутов</button>'
    );
  }

  function permissionState() {
    const mode = gps.getPrivacyMode();
    if (mode === "off") {
      return (
        '<div class="m-state warn"><span class="si">🔒</span><div class="sb">' +
        '<div class="st">Геолокация выключена</div>' +
        '<div class="sd">Приложение не отслеживает ваше местоположение. Выберите режим ниже, чтобы записывать маршруты.</div>' +
        '<div class="sa"><button class="btn primary sm" data-act="open-privacy">Выбрать режим</button></div></div></div>'
      );
    }
    return "";
  }

  /* ------------------------------------------------------------------ */
  /* Вид                                                                 */
  /* ------------------------------------------------------------------ */

  Fit.register("/activity", function () {
    const rec = gps.isRecording();
    const snap = gps.snapshot();
    const hasRoute = gps.getRoutes().length > 0;

    let html =
      '<div class="m-page">' +
      '<div class="m-head"><div><h1 class="ttl">Активность</h1>' +
      '<p class="sub">GPS-маршруты, дистанция и темп</p></div>' +
      '<div class="m-head-acts">' +
      (hasRoute ? '<button class="icon-btn" data-act="open-privacy" title="Приватность">' + Fit.iconSvg("settings") + "</button>" : "") +
      "</div></div>" +
      permissionState();

    // Выбор типа активности
    const curType = rec ? snap.type : gps.getActivityType();
    html +=
      '<div class="m-hscroll" style="margin-bottom:12px">' +
      Object.keys(gps.ACTIVITY_TYPES)
        .map((k) => {
          const t = gps.ACTIVITY_TYPES[k];
          return (
            '<button class="chip' + (k === curType ? " on" : "") + '" data-type="' + k + '"' + (rec ? " disabled" : "") + ">" +
            t.icon + " " + esc(t.label) + "</button>"
          );
        })
        .join("") +
      "</div>";

    // Карта
    html +=
      '<div class="surface" style="padding:0;overflow:hidden;position:relative">' +
      '<div id="act-map" style="width:100%;height:min(46vh,360px);min-height:230px;background:var(--card-2)"></div>' +
      (rec
        ? '<button class="icon-btn" data-act="follow" title="Следовать за мной" style="position:absolute;right:12px;bottom:12px;background:var(--card)">' +
          Fit.iconSvg("activity") + "</button>"
        : "") +
      "</div>";

    // Кнопка записи
    if (!rec) {
      html +=
        '<div class="row-actions" style="display:flex;gap:10px;margin-top:14px">' +
        '<button class="btn primary" data-act="start-rec" style="flex:1.3;min-height:52px">▶️ Начать запись</button>' +
        '<button class="btn ghost" data-act="start-manual" style="flex:1;min-height:52px">✍️ Вручную</button>' +
        "</div>";
    }

    html += livePanel(snap);
    html += statsPanel();
    html += historyPanel();
    html += "</div>";

    Fit.bind(function (root) {
      const mapEl = qs("#act-map");
      ensureMap(mapEl);
      if (rec) {
        const s = gps.snapshot();
        if (s) {
          const draft = store.getState().gpsDraft;
          const pts = draft && draft.points ? draft.points : [];
          if (pts.length) drawRoute({ points: pts });
        }
      }

      // Подписки на события записи.
      unsubscribe.forEach((u) => u());
      unsubscribe = [];

      const renderLive = () => {
        const s = gps.snapshot();
        if (!s) {
          Fit.renderTo();
          return;
        }
        updateLiveStats(s);
      };

      unsubscribe.push(gps.on("tick", () => {
        // Меняем текст на месте, чтобы не перерисовывать карту каждый секунд.
        const s = gps.snapshot();
        if (!s) return;
        updateLiveStats(s);
      }));

      unsubscribe.push(gps.on("point", (p) => {
        if (!map) return;
        const ll = [p.point.lat, p.point.lng];
        polyline.addLatLng(ll);
        marker.setLatLng(ll);
        circle.setLatLng(ll);
        if (followMode) map.setView(ll, Math.max(map.getZoom(), 16));
        updateLiveStats(p.snapshot);
      }));

      unsubscribe.push(gps.on("signal", (sig) => {
        if (sig && sig.reason === "accuracy") {
          showHint("Точность GPS ±" + sig.acc + " м — сигнал слабый", "warn");
        }
      }));

      unsubscribe.push(gps.on("geoerror", (e) => {
        showHint(e.message, e.level === "err" ? "error" : "warn");
      }));

      unsubscribe.push(gps.on("pause", (p) => {
        Fit.toast(p.auto ? "Автопауза — вы не двигаетесь" : p.paused ? "Пауза" : "Продолжаем", "ok");
        if (p.auto && followMode && map) map.setZoom(Math.max(map.getZoom() - 1, 14));
      }));

      unsubscribe.push(gps.on("background", (b) => {
        if (b.gap) {
          showHint("Приложение было свёрнуто " + Math.round(b.gapSec) + " с — запись продолжена с пропуском", "warn");
        } else if (b.active) {
          showHint("Запись идёт в фоне — баннер сверху остаётся активным", "warn");
        } else {
          showHint("Приложение свёрнуто — запись на паузе", "warn");
        }
      }));

      unsubscribe.push(gps.on("saved", (r) => {
        Fit.toast("Маршрут сохранён: " + (r.distance / 1000).toFixed(2) + " км", "ok");
        setTimeout(() => Fit.renderTo(), 60);
      }));

      unsubscribe.push(gps.on("discarded", () => {
        Fit.toast("Запись отменена", "ok");
        setTimeout(() => Fit.renderTo(), 60);
      }));

      // Кнопки.
      qsa("[data-act]", root).forEach((btn) => {
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          handleAction(btn.getAttribute("data-act"), btn);
        });
      });

      qsa("[data-type]", root).forEach((btn) => {
        btn.addEventListener("click", () => {
          gps.setActivityType(btn.getAttribute("data-type"));
          Fit.renderTo();
        });
      });

      qsa("[data-privacy]", root).forEach((btn) => {
        btn.addEventListener("click", async () => {
          const mode = btn.getAttribute("data-privacy");
          if (mode === "background" && gps.isRecording()) {
            Fit.toast("Сначала остановите текущую запись", "error");
            return;
          }
          gps.setPrivacyMode(mode);
          Fit.toast("Режим: " + gps.PRIVACY_MODES[mode].label, "ok");
          Fit.renderTo();
        });
      });

      qsa("[data-route]", root).forEach((row) => {
        row.addEventListener("click", () => {
          const r = gps.getRoute(row.getAttribute("data-route"));
          if (!r) return;
          Fit.navigate("#/activity/route/" + r.id);
        });
      });

      qsa("[data-detail]", root).forEach((card) => {
        card.addEventListener("click", () => {
          Fit.mSheet.open({
            title: detailTitle(card.getAttribute("data-detail")),
            body: detailBody(card.getAttribute("data-detail"))
          });
        });
      });
    });

    return html;
  });

  /* ------------------------------------------------------------------ */
  /* Детали показателя                                                    */
  /* ------------------------------------------------------------------ */

  function detailTitle(k) {
    return (
      {
        distance: "Дистанция",
        time: "Время",
        elevation: "Высота",
        calories: "Калории",
        steps: "Шаги",
        routes: "Маршруты"
      }[k] || "Подробности"
    );
  }

  function detailBody(k) {
    const routes = gps.getRoutes();
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(Fit.today(-i));
    if (k === "steps") {
      return (
        '<p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 14px">' +
        "Шаги появляются, когда вы подключите источник активности: браузер умеет считать их на Android " +
        "через Device Motion, на iOS — только с носимого устройства или вручную. Приложение не выдумывает цифры.</p>" +
        '<div class="list">' +
        days
          .slice()
          .reverse()
          .map((d) => {
            const v = store.getSteps(d) || 0;
            return '<div class="list-row"><span>' + d.slice(8) + "." + d.slice(5, 7) + '</span><b>' + v.toLocaleString("ru-RU") + "</b></div>";
          })
          .join("") +
        "</div>"
      );
    }
    if (k === "distance" || k === "time" || k === "elevation" || k === "calories") {
      const field = k === "distance" ? "distance" : k === "time" ? "duration" : k === "elevation" ? "elevGain" : "kcal";
      const unit = k === "distance" ? 1000 : 1;
      const dec = k === "distance" ? 2 : 0;
      const total = routes.reduce((a, r) => a + (r[field] || 0), 0);
      return (
        '<p class="muted" style="font-size:13px;line-height:1.6;margin:0 0 12px">' +
        "По вашим маршрутам за всё время. Нажмите на любой день, чтобы увидеть детализацию.</p>" +
        '<div style="text-align:center;padding:10px 0 18px">' +
        '<div style="font-size:34px;font-weight:800">' +
        (k === "time" ? gps.fmtDuration(total) : (total / unit).toFixed(dec) + (k === "distance" ? " км" : k === "calories" ? " ккал" : " м")) +
        "</div><div class='muted' style='font-size:12px'>всего за " + routes.length + " маршрут(ов)</div></div>" +
        '<div class="list">' +
        days
          .slice()
          .reverse()
          .map((d) => {
            const rs = routes.filter((r) => (r.date || "").slice(0, 10) === d);
            const v = rs.reduce((a, r) => a + (r[field] || 0), 0);
            const txt = v === 0 ? "—" : k === "time" ? gps.fmtDuration(v) : (v / unit).toFixed(dec) + (k === "distance" ? " км" : k === "calories" ? " ккал" : " м");
            return '<div class="list-row"><span>' + d.slice(8) + "." + d.slice(5, 7) + '</span><b>' + txt + "</b></div>";
          })
          .join("") +
        "</div>"
      );
    }
    return '<p class="muted" style="font-size:13px;line-height:1.6">Маршрутов: ' + routes.length + ".</p>";
  }

  /* ------------------------------------------------------------------ */
  /* Обновление живых цифр (без перерисовки карты)                       */
  /* ------------------------------------------------------------------ */

  function updateLiveStats(s) {
    if (!s) return;
    const panel = qs("#live-panel");
    if (!panel) return;
    const set = (key, txt) => {
      const el = panel.querySelector('[data-live="' + key + '"]');
      if (el) el.textContent = txt;
    };
    set("time", s.elapsedLabel);
    const dEl = panel.querySelector('[data-live="dist"]');
    if (dEl) dEl.innerHTML = esc(s.distanceLabel) + "<small>км</small>";
    const pEl = panel.querySelector('[data-live="pace"]');
    if (pEl) pEl.innerHTML = esc(s.paceLabel) + "<small>/км</small>";
    const st = qs("#live-state");
    if (st) {
      st.textContent = s.paused ? (s.autoPaused ? "Автопауза" : "Пауза") : "● Идёт";
    }
  }

  function showHint(msg, kind) {
    let h = qs("#gps-hint");
    if (!h) {
      h = document.createElement("div");
      h.id = "gps-hint";
      h.className = "m-toast " + (kind || "");
      document.body.appendChild(h);
    }
    h.className = "m-toast " + (kind || "");
    h.textContent = msg;
    h.style.opacity = "1";
    clearTimeout(h._t);
    h._t = setTimeout(() => h.remove(), 4000);
  }

  /* ------------------------------------------------------------------ */
  /* Действия                                                             */
  /* ------------------------------------------------------------------ */

  async function handleAction(act, btn) {
    if (act === "open-privacy") {
      Fit.mSheet.open({
        title: "🔒 Приватность геолокации",
        body:
          privacyCard(),
        onClose: () => Fit.renderTo()
      });
      return;
    }
    if (act === "start-rec") {
      if (gps.getPrivacyMode() === "off") {
        const go = await Fit.confirmDialog(
          "Чтобы записать маршрут, нужно включить геолокацию. Выберите режим приватности — приложение не пишет ваши данные на сервер."
        );
        if (!go) return;
        gps.setPrivacyMode("while-using");
      }
      const res = await gps.start({ type: gps.getActivityType() });
      if (res.ok) {
        Fit.toast("Запись началась", "ok");
        Fit.renderTo();
      } else if (res.reason === "denied") {
        Fit.toast("Доступ к геолокации запрещён", "error");
        Fit.mSheet.open({ title: "🚫 Нет доступа к GPS", body: permissionHelpHtml(gps.permissionHelp("denied")) });
      } else if (res.reason === "unsupported") {
        Fit.mSheet.open({ title: "🗺️ Геолокация недоступна", body: permissionHelpHtml(gps.permissionHelp("unsupported")) });
      } else if (res.reason === "no-consent") {
        // Режим приватности выключили между подтверждением и стартом —
        // молча начинать запись нельзя, объясняем и предлагаем ручной режим.
        Fit.toast("Включите геолокацию в разделе приватности", "error");
        Fit.mSheet.open({ title: "🔒 Нужно разрешение", body: privacyCard(), onClose: () => Fit.renderTo() });
      } else {
        Fit.toast("Не удалось начать запись", "error");
      }
      return;
    }
    if (act === "start-manual") {
      gps.startManual({ type: gps.getActivityType() });
      Fit.renderTo();
      return;
    }
    if (act === "toggle-pause") {
      const s = gps.snapshot();
      if (s && s.paused) gps.resume();
      else gps.pause();
      Fit.renderTo();
      return;
    }
    if (act === "stop-rec") {
      const s = gps.snapshot();
      if (s && s.distance < 10 && s.elapsed < 60) {
        const ok = await Fit.confirmDialog("Запись почти пустая. Сохранить её?");
        if (!ok) {
          gps.discard();
          Fit.renderTo();
          return;
        }
      }
      gps.stop({ save: true });
      Fit.renderTo();
      return;
    }
    if (act === "follow") {
      followMode = !followMode;
      Fit.toast(followMode ? "Карта следует за вами" : "Карта не следует", "ok");
      return;
    }
    if (act === "forget-geo") {
      const n = gps.getRoutes().length;
      const ok = await Fit.confirmDialog(
        n
          ? "Будут удалены все " + n + " маршрутов и история активности. Действие необратимо."
          : "Будут удалены все сохранённые геоданные."
      );
      if (!ok) return;
      const removed = gps.forgetAllLocationData();
      gps.setPrivacyMode("off");
      Fit.toast("Удалено маршрутов: " + removed, "ok");
      Fit.renderTo();
    }
  }

  function permissionHelpHtml(h) {
    return (
      '<p style="font-size:14px;line-height:1.6;margin:0 0 12px">' + esc(h.desc) + "</p>" +
      (h.actionType === "retry"
        ? '<button class="btn primary" data-sheet-close>Попробовать снова</button>'
        : '<a class="btn primary" href="' + (h.href || "#/activity") + '" data-sheet-close>Понятно</a>')
    );
  }

  /* ------------------------------------------------------------------ */
  /* Детальный просмотр маршрута                                         */
  /* ------------------------------------------------------------------ */

  Fit.register("/activity/route", function (r) {
    const id = r.parts[1];
    const route = gps.getRoute(id);
    if (!route) {
      return (
        '<div class="m-page"><div class="m-head"><div><h1 class="ttl">Маршрут</h1></div></div>' +
        '<div class="m-empty"><div class="ei">🗺️</div><div class="et">Маршрут не найден</div>' +
        '<div class="es">Возможно, он был удалён. Вернитесь к списку активности.</div>' +
        '<a class="btn primary" href="#/activity">К активности</a></div></div>'
      );
    }
    const t = gps.ACTIVITY_TYPES[route.type] || gps.ACTIVITY_TYPES.other;
    const km = (route.distance || 0) / 1000;
    const dur = route.duration || 0;
    const pace = dur > 0 && km > 0.01 ? dur / 60 / km : Infinity;
        const sp = gps.splitsForRoute(id) || [];
        const doneSp = sp.filter((s) => !s.partial);
        const best = doneSp.length ? Math.min.apply(null, doneSp.map((s) => s.pace)) : Infinity;

    Fit.bind(function () {
      const m = ensureMap(qs("#rt-map"));
      if (m && route.points && route.points.length) {
        polyline.setLatLngs(route.points.map((p) => [p.lat, p.lng]));
        const f = route.points[0];
        const l = route.points[route.points.length - 1];
        L.circleMarker([f.lat, f.lng], { radius: 5, color: "#fff", weight: 2, fillColor: "#22c55e", fillOpacity: 1 }).addTo(m);
        L.circleMarker([l.lat, l.lng], { radius: 5, color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }).addTo(m);
        fitToPoints(route.points, 0.15);
      }
    });

    return (
      '<div class="m-page">' +
      '<div class="m-head"><div><h1 class="ttl">' + t.icon + " " + esc(t.label) + "</h1>" +
      '<p class="sub">' + Fit.fmtDate(route.date) + " · " + gps.fmtDuration(dur) + "</p></div>" +
      '<div class="m-head-acts"><button class="icon-btn" data-back>' + Fit.iconSvg("back") + "</button></div></div>" +
      '<div class="surface" style="padding:0;overflow:hidden">' +
      '<div id="rt-map" style="width:100%;height:min(48vh,380px);background:var(--card-2)"></div></div>' +
      '<div class="m-grid g2" style="margin-top:14px">' +
      metricCard("accent", "📍", km.toFixed(2), "км", "Дистанция") +
      metricCard("blue", "⏱️", isFinite(pace) ? pace.toFixed(2) : "—", "мин/км", "Средний темп") +
      metricCard("amber", "⬆️", Math.round(route.elevGain || 0), "м", "Набор высоты") +
      metricCard("rose", "🔥", Math.round(route.kcal || 0), "ккал", "Калории") +
      "</div>" +
            (doneSp.length
              ? '<h2 class="section">Сплиты по километрам</h2>' +
                '<div class="surface" style="overflow:hidden">' +
                doneSp
                  .map((s, i) => {
                    const fast = isFinite(best) && s.pace <= best + 0.001;
                    return (
                      '<div class="sp-row' + (fast ? " best" : "") + '">' +
                      '<span class="sp-km">' + s.km + "</span>" +
                      '<span class="sp-bar" style="--w:' +
                      Math.round(Math.min(100, isFinite(pace) && pace > 0 && isFinite(s.pace) ? (pace / s.pace) * 100 : 100)) +
                      '%"></span>' +
                      '<span class="sp-t">' + (isFinite(s.pace) ? s.pace.toFixed(2) : "—") + "</span>" +
                      '<span class="sp-d">' + gps.fmtDuration(s.sec) + "</span>" +
                      "</div>"
                    );
                  })
                  .join("") +
                "</div>"
              : "") +
      (route.gaps
        ? '<div class="m-state warn" style="margin-top:14px"><span class="si">ℹ️</span><div class="sb">' +
          '<div class="st">Запись была прервана</div>' +
          '<div class="sd">Приложение уходило в фон ' + route.gaps + " раз(а). Эти промежутки не попали в статистику дистанции, но учтены во времени.</div></div></div>"
        : "") +
      '<div class="m-sticky-actions">' +
      '<button class="btn ghost" data-export>⬇️ CSV</button>' +
      '<button class="btn danger" data-del>🗑️ Удалить маршрут</button>' +
      "</div></div>"
    );
  });

  // Действия на экране маршрута (делегирование, т.к. биндинг свой).
  document.addEventListener("click", (e) => {
    const back = e.target.closest("[data-back]");
    if (back && location.hash.indexOf("#/activity/route") === 0) {
      Fit.navigate("#/activity");
      return;
    }
    const exp = e.target.closest("[data-export]");
    if (exp) {
      const id = location.hash.split("/")[3];
      const csv = store.exportRoutePointsCsv(id);
      Fit.downloadCsv("route-" + id + ".csv", csv);
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      const id = location.hash.split("/")[3];
      (async () => {
        const ok = await Fit.confirmDialog("Удалить этот маршрут без возможности восстановления?");
        if (!ok) return;
        gps.deleteRoute(id);
        Fit.toast("Маршрут удалён", "ok");
        Fit.navigate("#/activity");
      })();
    }
  });

  Fit.gpsView = { ensureMap: ensureMap, dispose: () => {} };
})();
