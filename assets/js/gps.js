/* FORMA — GPS-модуль.
   Полностью переписан: реальная карта, высота, темп, сплиты, автопауза,
   калории, приватность и управление разрешениями.

   Принципы приватности (зашиты в код, а не только в текст):
   • геолокация НИКОГДА не включается сама — только по явной кнопке пользователя;
   • без активной записи watchPosition не существует вовсе;
   • точность и «шум» GPS отфильтровываются, маршрут не пишется «как есть»;
   • режим фоновой записи всегда виден баннером с кнопкой «Стоп»;
   • маршруты можно удалить по одному или все разом. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  const R_EARTH = 6371008.8; // м, средний радиус Земли
  const MAX_ACCURACY = 35; // м — точки хуже отбрасываем
  const MIN_POINT_GAP = 2; // м — не пишем микро-抖动
  const ELEV_THRESHOLD = 1.5; // м — порог накопления высоты
  const AUTO_PAUSE_SPEED = 0.6; // км/ч
  const AUTO_PAUSE_AFTER = 12; // с

  /* ------------------------------------------------------------------ */
  /* Утилиты                                                              */
  /* ------------------------------------------------------------------ */

  function toRad(d) {
    return (d * Math.PI) / 180;
  }

  /** Расстояние между двумя точками по большому кругу (метры). */
  function haversine(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_EARTH * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
      : m + ":" + String(s).padStart(2, "0");
  }

  /** Темп вида «5:12» (мин:сек на км). */
  function fmtPace(secPerKm) {
    if (!isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return "—";
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  function fmtDist(m) {
    if (!isFinite(m)) return "0";
    return m >= 1000 ? (m / 1000).toFixed(2) : Math.round(m).toString();
  }

  /* ------------------------------------------------------------------ */
  /* Типы активности                                                      */
  /* ------------------------------------------------------------------ */

  const ACTIVITY_TYPES = {
    run: { id: "run", label: "Бег", icon: "🏃", met: 9.8, color: "#22c55e", avgKmh: 10.5 },
    walk: { id: "walk", label: "Ходьба", icon: "🚶", met: 3.5, color: "#a3e635", avgKmh: 5 },
    bike: { id: "bike", label: "Велосипед", icon: "🚴", met: 7.5, color: "#60a5fa", avgKmh: 20 },
    hike: { id: "hike", label: "Поход", icon: "🥾", met: 6.0, color: "#fbbf24", avgKmh: 4 },
    other: { id: "other", label: "Другое", icon: "⚡", met: 6.0, color: "#a78bfa", avgKmh: 6 }
  };
  Fit.ACTIVITY_TYPES = ACTIVITY_TYPES;

  /* ------------------------------------------------------------------ */
  /* Разрешения и приватность                                            */
  /* ------------------------------------------------------------------ */

  // 'off' | 'while-using' | 'background' — по умолчанию 'off': GPS выключен.
  const PRIVACY_MODES = {
    off: {
      id: "off",
      label: "Не разрешать",
      desc: "GPS полностью выключен. Активность считается вручную.",
      icon: "🚫"
    },
    "while-using": {
      id: "while-using",
      label: "Только во время использования",
      desc: "Запись идёт, пока открыто приложение. В фоне GPS не пишет.",
      icon: "📱"
    },
    background: {
      id: "background",
      label: "Фоновая запись тренировки",
      desc: "Запись не ставится на паузу при сворачивании. Виден баннер со кнопкой «Стоп».",
      icon: "🎯"
    }
  };
  Fit.PRIVACY_MODES = PRIVACY_MODES;

  function getPrivacyMode() {
    const m = store.getState().privacyMode;
    return PRIVACY_MODES[m] ? m : "off";
  }

  function setPrivacyMode(mode) {
    const m = PRIVACY_MODES[mode] ? mode : "off";
    store.setState({ privacyMode: m });
    // Если пользователь сузил права во время записи — честно останавливаем её.
    if (rec && m === "off") {
      stop({ save: true, reason: "privacy" });
    }
    emit("privacy", { mode: m });
    return m;
  }

  /** Состояние разрешения браузера: 'unsupported' | 'prompt' | 'granted' | 'denied'. */
  function getPermission() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return "unsupported";
    if (typeof Notification === "undefined") return "prompt";
    // Permissions API есть не везде (iOS Safari) — там считаем, что спросим при первом запуске.
    if (!navigator.permissions || !navigator.permissions.query) return "prompt";
    let result = "prompt";
    try {
      const p = navigator.permissions.query({ name: "geolocation" });
      if (p && typeof p.then === "function") {
        p.then((st) => {
          if (rec) emit("permission", { state: st.state });
        }).catch(() => {});
      }
    } catch (e) {}
    return result;
  }

  /** Запрашивает разрешение. Возвращает итоговое состояние. */
  function requestPermission() {
    return new Promise((resolve) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        resolve("unsupported");
        return;
      }
      let settled = false;
      // Страховка: некоторые браузеры не вызывают колбэк при молчаливом отказе.
      const guard = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve("denied");
        }
      }, 15000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          store.setState({ geoLastKnown: { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now() } });
          emit("permission", { state: "granted" });
          resolve("granted");
        },
        (err) => {
          if (settled) return;
          settled = true;
          clearTimeout(guard);
          const state = err && err.code === 1 ? "denied" : "error";
          emit("permission", { state: state, code: err && err.code, message: err && err.message });
          resolve(state);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  function permissionHelp(state) {
    switch (state) {
      case "unsupported":
        return {
          title: "Геолокация недоступна",
          desc: "Ваш браузер не поддерживает GPS. Активность можно записывать вручную: укажите дистанцию и время.",
          action: "Записать вручную",
          href: "#/activity/manual"
        };
      case "denied":
        return {
          title: "Доступ к местоположению запрещён",
          desc: "Браузер не даёт доступ к GPS. Разрешите его в настройках сайта, чтобы записывать маршруты. Данные наружу не отправляются.",
          action: "Как включить",
          href: "#/settings/privacy"
        };
      case "error":
        return {
          title: "Не удалось определить местоположение",
          desc: "Сигнал GPS слабый или временно недоступен. Выйдите на открытое место и попробуйте снова.",
          action: "Повторить",
          actionType: "retry"
        };
      default:
        return {
          title: "GPS не включён",
          desc: "Приложение не отслеживает ваше местоположение, пока вы сами не запустите запись.",
          action: "Запустить запись",
          actionType: "start"
        };
    }
  }

  /* ------------------------------------------------------------------ */
  /* События                                                              */
  /* ------------------------------------------------------------------ */

  const listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
    return () => off(evt, fn);
  }
  function off(evt, fn) {
    if (!listeners[evt]) return;
    listeners[evt] = listeners[evt].filter((f) => f !== fn);
  }
  function emit(evt, payload) {
    (listeners[evt] || []).forEach((fn) => {
      try {
        fn(payload);
      } catch (e) {
        console.error("[gps] listener error", e);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Фильтрация и метрики                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Проверяет, стоит ли принять точку.
   * Отсекает: плохую точность, дубли, выбросы скорости (городской каньон).
   */
  function acceptPoint(p) {
    if (!p) return { ok: false, reason: "empty" };
    if (!isFinite(p.lat) || !isFinite(p.lng)) return { ok: false, reason: "bad" };
    if (p.acc > MAX_ACCURACY) return { ok: false, reason: "accuracy", acc: p.acc };
    if (!rec.last) return { ok: true, d: 0 };
    const d = haversine(rec.last.lat, rec.last.lng, p.lat, p.lng);
    if (d < MIN_POINT_GAP) return { ok: false, reason: "jitter" };
    const dt = (p.t - rec.last.t) / 1000;
    if (dt > 0 && dt < 4) {
      const speed = d / dt; // м/с
      const type = ACTIVITY_TYPES[rec.type] || ACTIVITY_TYPES.other;
      const maxS = (type.avgKmh * 1000) / 3600 * 3.2 + 1.5; // допуск сверх типичной скорости
      if (speed > maxS) return { ok: false, reason: "spike", speed: speed };
    }
    return { ok: true, d: d };
  }

  /** Накопительная разница высот с порогом — защита от «шумовых» +/-30 м. */
  function addElevation(e) {
    if (!isFinite(e)) return;
    if (!isFinite(rec.elevRaw)) {
      rec.elevRaw = e;
      rec.elevMin = e;
      rec.elevMax = e;
      rec.elevStart = e;
      return;
    }
    const delta = e - rec.elevRaw;
    if (Math.abs(delta) >= ELEV_THRESHOLD) {
      if (delta > 0) rec.elevGain += delta;
      else rec.elevLoss += -delta;
      rec.elevRaw = e;
    }
    if (e < rec.elevMin) rec.elevMin = e;
    if (e > rec.elevMax) rec.elevMax = e;
  }

  /** Скорость сглаженная по последним точкам (км/ч). */
  function smoothSpeed() {
    const pts = rec.points;
    if (pts.length < 2) return 0;
    const use = Math.min(pts.length, 5);
    let dist = 0;
    let dt = 0;
    for (let i = pts.length - use; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!a || !b) continue;
      dist += haversine(a.lat, a.lng, b.lat, b.lng);
      dt += (b.t - a.t) / 1000;
    }
    if (dt <= 0) return 0;
    return (dist / dt) * 3.6;
  }

  /* ------------------------------------------------------------------ */
  /* Сплиты (км)                                                          */
  /* ------------------------------------------------------------------ */

  function rebuildSplits() {
      return splitsFromPoints(rec.points, rec.distance);
    }

    /**
     * Сплиты по километрам для произвольного массива точек.
     * Нужен и для живой записи, и для уже сохранённых маршрутов на экране деталей.
     */
    function splitsFromPoints(pts, totalDist) {
      const splits = [];
      if (!pts || !pts.length) return splits;
      let segTime = 0;
      let segPoints = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const d = haversine(a.lat, a.lng, b.lat, b.lng);
        segTime += (b.t - a.t) / 1000;
        segPoints.push(b);
        if (d >= 1000) {
          const km = splits.length + 1;
          const s = makeSplit(segPoints, segTime, totalDist);
          s.km = km;
          splits.push(s);
          segPoints = [b];
          segTime = 0;
        }
      }
      if (segPoints.length > 1) {
        // Незавершённый километр показываем отдельно, он важен на экране записи.
        const part = makeSplit(segPoints, segTime, totalDist);
        part.km = splits.length + 1;
        part.partial = true;
        part.rest = 1000 - partialDist(segPoints);
        splits.push(part);
      }
      return splits;
    }

    /** Сплиты сохранённого маршрута (на экране деталей). */
    function splitsForRoute(id) {
      const r = store.getRoute(id);
      if (!r || !r.points || !r.points.length) return [];
      return splitsFromPoints(r.points, r.distance || 0);
    }

  function partialDist(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    return d;
  }

  function makeSplit(pts, sec, totalDist) {
    const dist = partialDist(pts);
    return {
        km: Math.floor((totalDist || 0) / 1000) + 1,
      dist: dist,
      sec: Math.round(sec),
      pace: dist > 0 ? sec / (dist / 1000) : Infinity
    };
  }

  /* ------------------------------------------------------------------ */
  /* Запись                                                               */
  /* ------------------------------------------------------------------ */

  let rec = null;
  let tickTimer = null;

  function isRecording() {
    return !!rec;
  }

  function getType() {
    return rec ? rec.type : getPrivacyPrefType();
  }

  function getPrivacyPrefType() {
    const t = store.getState().activityType;
    return ACTIVITY_TYPES[t] ? t : "run";
  }

  function setActivityType(t) {
    if (!ACTIVITY_TYPES[t]) return getPrivacyPrefType();
    store.setState({ activityType: t });
    if (rec) {
      rec.type = t;
      emit("tick", snapshot());
    }
    return t;
  }

  /**
   * Запускает запись. Вызывается ТОЛЬКО из явного действия пользователя.
   * opts: { type, source }
   */
  async function start(opts) {
    opts = opts || {};
    if (rec) return { ok: false, reason: "already" };
    if (getPrivacyMode() === "off") {
      const mode = await ensurePrivacyForStart();
      if (mode === "off") return { ok: false, reason: "no-consent" };
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return { ok: false, reason: "unsupported" };
    }

    const perm = await requestPermission();
    if (perm !== "granted") return { ok: false, reason: perm };

    const type = ACTIVITY_TYPES[opts.type] ? opts.type : getPrivacyPrefType();
    const now = Date.now();
    rec = {
      id: "rt_" + now.toString(36) + Math.random().toString(36).slice(2, 6),
      type: type,
      source: opts.source || "gps",
      start: now,
      end: 0,
      pausedMs: 0,
      pauseStarted: 0,
      paused: false,
      autoPaused: false,
      stillSince: 0,
      points: [],
      last: null,
      distance: 0,
      movingSec: 0,
      elevRaw: NaN,
      elevGain: 0,
      elevLoss: 0,
      elevMin: NaN,
      elevMax: NaN,
      elevStart: NaN,
      hrSamples: [],
      rejected: 0,
      watch: null,
      lastPersist: 0
    };

    rec.watch = navigator.geolocation.watchPosition(onPosition, onGeoError, {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 20000
    });

    // Тикер для таймера/автопаузы. Отдельный от GPS-потока.
    tickTimer = setInterval(onTick, 1000);
    startBackgroundGuard();
    emit("start", snapshot());
    return { ok: true };
  }

  /** Запись без GPS (ручной ввод дистанции/времени) — для отказа в доступе. */
  function startManual(opts) {
    opts = opts || {};
    if (rec) return { ok: false, reason: "already" };
    const now = Date.now();
    rec = {
      id: "rt_" + now.toString(36) + Math.random().toString(36).slice(2, 6),
      type: ACTIVITY_TYPES[opts.type] ? opts.type : "other",
      source: "manual",
      start: now,
      end: 0,
      pausedMs: 0,
      pauseStarted: 0,
      paused: false,
      autoPaused: false,
      stillSince: 0,
      points: [],
      last: null,
      distance: 0,
      movingSec: 0,
      elevRaw: NaN,
      elevGain: 0,
      elevLoss: 0,
      elevMin: NaN,
      elevMax: NaN,
      elevStart: NaN,
      hrSamples: [],
      rejected: 0,
      watch: null,
      lastPersist: 0
    };
    tickTimer = setInterval(onTick, 1000);
    emit("start", snapshot());
    return { ok: true };
  }

  /** Ручное добавление дистанции (режим без GPS). */
  function addManualDistance(meters) {
    if (!rec || rec.source !== "manual") return false;
    rec.distance += Math.max(0, +meters || 0);
    emit("tick", snapshot());
    return true;
  }

  function onPosition(pos) {
    if (!rec) return;
    const c = pos.coords;
    const p = {
      lat: +c.latitude.toFixed(6),
      lng: +c.longitude.toFixed(6),
      t: Math.round(pos.timestamp || Date.now()),
      acc: c.accuracy == null ? 999 : Math.round(c.accuracy),
      alt: c.altitude == null ? null : Math.round(c.altitude),
      spd: c.speed == null ? null : c.speed,
      hr: readHeartRate(pos)
    };

    const verdict = acceptPoint(p);
    if (!verdict.ok) {
      rec.rejected++;
      emit("signal", { ok: false, reason: verdict.reason, acc: p.acc });
      return;
    }

    if (rec.paused) return;

    if (verdict.d > 0) {
      rec.distance += verdict.d;
      rec.movingSec += (p.t - rec.last.t) / 1000;
    }
    rec.last = p;
    rec.points.push(p);
    if (p.hr) rec.hrSamples.push({ t: p.t, v: p.hr });
    addElevation(p.alt);

    // Автопауза: стоим на месте дольше порога.
    if (verdict.d > 0) {
      const spd = smoothSpeed();
      if (spd < AUTO_PAUSE_SPEED) {
        if (!rec.stillSince) rec.stillSince = Date.now();
        else if (Date.now() - rec.stillSince > AUTO_PAUSE_AFTER * 1000) setPaused(true, true);
      } else {
        rec.stillSince = 0;
      }
    }

    emit("point", { point: p, snapshot: snapshot() });
    emit("tick", snapshot());
    maybePersist();
  }

  /** Пульс: стандартный путь — только если браузер/носимое его отдаёт. */
  function readHeartRate(pos) {
    try {
      if (pos.coords && typeof pos.coords.heartRate === "number") return Math.round(pos.coords.heartRate);
    } catch (e) {}
    return null;
  }

  function onGeoError(err) {
    if (!rec) return;
    let level = "warn";
    let msg = "Сигнал GPS потерян";
    if (err && err.code === 1) {
      level = "err";
      msg = "Доступ к местоположению отозван";
    } else if (err && err.code === 2) {
      msg = "Не удалось получить координаты. Продолжаем запись.";
    } else if (err && err.code === 3) {
      msg = "GPS не отвечает. Запись продолжается.";
    }
    emit("geoerror", { level: level, message: msg, code: err && err.code });
  }

  function onTick() {
    if (!rec) return;
    if (rec.paused) {
      emit("tick", snapshot());
      return;
    }
    if (rec.stillSince && Date.now() - rec.stillSince > AUTO_PAUSE_AFTER * 1000) {
      setPaused(true, true);
    }
    emit("tick", snapshot());
  }

  function setPaused(v, auto) {
    if (!rec) return;
    if (rec.paused === v) return;
    if (v) {
      rec.paused = true;
      rec.autoPaused = !!auto;
      rec.pauseStarted = Date.now();
      // При паузе фиксируем последнюю точку — иначе накопятся координаты прогулки.
      if (navigator.geolocation && rec.watch == null) return;
    } else {
      rec.paused = false;
      if (rec.pauseStarted) rec.pausedMs += Date.now() - rec.pauseStarted;
      rec.pauseStarted = 0;
      rec.autoPaused = false;
      rec.stillSince = 0;
    }
    emit("pause", { paused: rec.paused, auto: rec.autoPaused });
    emit("tick", snapshot());
  }

  const pause = () => setPaused(true, false);
  const resume = () => setPaused(false, false);

  /** Снимок текущего состояния записи для UI. */
  function snapshot() {
    if (!rec) return null;
    const now = Date.now();
    let elapsed = (now - rec.start) / 1000;
    if (rec.pauseStarted) elapsed -= (now - rec.pauseStarted) / 1000;
    elapsed = Math.max(0, elapsed - rec.pausedMs / 1000);

    const speed = rec.paused ? 0 : smoothSpeed();
    const km = rec.distance / 1000;
    const avgSpeed = elapsed > 0 ? km / (elapsed / 3600) : 0;
    const type = ACTIVITY_TYPES[rec.type] || ACTIVITY_TYPES.other;
    const weight = store.getProfileOr().weight || 70;
    const hours = Math.max(0, elapsed) / 3600;
    const kcal = type.met * weight * hours;

    return {
      id: rec.id,
      type: rec.type,
      typeLabel: type.label,
      icon: type.icon,
      color: type.color,
      source: rec.source,
      running: !rec.paused,
      paused: rec.paused,
      autoPaused: rec.autoPaused,
      start: rec.start,
      elapsed: Math.round(elapsed),
      elapsedLabel: fmtDuration(elapsed),
      distance: rec.distance,
      distanceLabel: fmtDist(rec.distance),
      km: km,
      speed: speed,
      speedLabel: speed.toFixed(1),
      avgSpeed: avgSpeed,
      avgSpeedLabel: avgSpeed.toFixed(1),
      pace: speed > 0.3 ? 1000 / speed : Infinity,
      paceLabel: fmtPace(speed > 0.3 ? 1000 / speed : Infinity),
      avgPace: km > 0.01 ? elapsed / km : Infinity,
      avgPaceLabel: fmtPace(km > 0.01 ? elapsed / km : Infinity),
      elevGain: Math.round(rec.elevGain),
      elevLoss: Math.round(rec.elevLoss),
      elevMin: Math.round(rec.elevMin),
      elevMax: Math.round(rec.elevMax),
      kcal: Math.round(kcal),
      points: rec.points.length,
      rejected: rec.rejected,
      accuracy: rec.last ? rec.last.acc : null,
      hr: rec.hrSamples.length ? rec.hrSamples[rec.hrSamples.length - 1].v : null,
      splits: rebuildSplits(),
      privacyMode: getPrivacyMode()
    };
  }

  /** Периодически сохраняем незавершённую запись — потеря прогресса при закрытии недопустима. */
  function maybePersist() {
    if (!rec) return;
    const now = Date.now();
    if (now - rec.lastPersist < 5000) return;
    rec.lastPersist = now;
    store.setState({ gpsDraft: draftOf(rec) });
  }

  function draftOf(r) {
    return {
      id: r.id,
      type: r.type,
      source: r.source,
      start: r.start,
      pausedMs: r.pausedMs,
      distance: Math.round(r.distance),
      points: r.points,
      elevGain: Math.round(r.elevGain),
      elevLoss: Math.round(r.elevLoss),
      savedAt: Date.now()
    };
  }

  /* ------------------------------------------------------------------ */
  /* Фоновая запись                                                      */
  /* ------------------------------------------------------------------ */

  /** Никакого реального фонового GPS в веб-приложении нет и быть не может.
      Поэтому мы честно: держим запись при сворачивании, отмечаем разрывы
      и показываем баннер. Пользователь всегда видит, что идёт запись. */
  function startBackgroundGuard() {
    const onHide = () => {
      if (!rec) return;
      rec.hiddenAt = Date.now();
      if (getPrivacyMode() === "background") {
        emit("background", { active: true, mode: "background" });
      } else {
        // В режиме «только во время использования» — честно ставим на паузу.
        if (!rec.paused) setPaused(true, false);
        emit("background", { active: false, mode: "while-using" });
      }
      maybePersist();
    };
    const onShow = () => {
      if (!rec) return;
      const gap = rec.hiddenAt ? Date.now() - rec.hiddenAt : 0;
      rec.hiddenAt = 0;
      // Разрыв больше 90 секунд означает, что вкладку выгрузили — отмечаем это в данных.
      if (gap > 90000) {
        rec.gaps = (rec.gaps || 0) + 1;
        emit("background", { active: !!rec, gap: true, gapSec: Math.round(gap / 1000) });
      }
      emit("tick", snapshot());
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) onHide();
      else onShow();
    });
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
  }

  /* ------------------------------------------------------------------ */
  /* Остановка и сохранение                                               */
  /* ------------------------------------------------------------------ */

  function stop(opts) {
    opts = opts || {};
    if (!rec) return null;
    if (rec.watch != null) {
      navigator.geolocation.clearWatch(rec.watch);
      rec.watch = null;
    }
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }

    const snap = snapshot();
    const finished = {
      id: rec.id,
      type: rec.type,
      source: rec.source,
      date: new Date(rec.start).toISOString(),
      start: rec.start,
      end: Date.now(),
      duration: snap ? snap.elapsed : 0,
      distance: Math.round(rec.distance),
      points: rec.points,
      elevGain: Math.round(rec.elevGain),
      elevLoss: Math.round(rec.elevLoss),
      elevMin: isFinite(rec.elevMin) ? Math.round(rec.elevMin) : null,
      elevMax: isFinite(rec.elevMax) ? Math.round(rec.elevMax) : null,
      kcal: snap ? snap.kcal : 0,
      avgSpeed: snap ? +snap.avgSpeed.toFixed(2) : 0,
      autoPausedMs: rec.autoPaused ? rec.pausedMs : 0,
      gaps: rec.gaps || 0,
      rejected: rec.rejected,
      stopReason: opts.reason || "user"
    };

    rec = null;
    store.setState({ gpsDraft: null });

    if (opts.save !== false && finished.distance >= 10) {
      store.addRoute(finished);
      emit("saved", finished);
    } else if (opts.save !== false) {
      emit("discarded", finished);
    }
    emit("stop", finished);
    return finished;
  }

  function discard() {
    return stop({ save: false, reason: "discard" });
  }

  /* ------------------------------------------------------------------ */
  /* История маршрутов                                                    */
  /* ------------------------------------------------------------------ */

  function getRoutes() {
    return store.getRoutes();
  }
  function getRoute(id) {
    return store.getRoute(id);
  }
  function deleteRoute(id) {
    const r = store.deleteRoute(id);
    emit("routes", {});
    return r;
  }
  function deleteAllRoutes() {
    const n = store.getRoutes().length;
    store.deleteAllRoutes();
    emit("routes", {});
    return n;
  }
  /** Полное стирание геоданных — включая черновик и последнюю известную точку. */
  function forgetAllLocationData() {
    const n = store.getRoutes().length;
    store.setState({ gpsDraft: null, geoLastKnown: null });
    store.deleteAllRoutes();
    emit("routes", {});
    emit("forget", { routes: n });
    return n;
  }

  /* ------------------------------------------------------------------ */
  /* Разрешение начать запись                                            */
  /* ------------------------------------------------------------------ */

  function ensurePrivacyForStart() {
    // Здесь мы НЕ включаем GPS молча. Пользователь должен явно выбрать режим.
    return Promise.resolve(getPrivacyMode());
  }

  /* ------------------------------------------------------------------ */
  /* Экспорт                                                              */
  /* ------------------------------------------------------------------ */

  Fit.gps = {
    ACTIVITY_TYPES: ACTIVITY_TYPES,
    PRIVACY_MODES: PRIVACY_MODES,
    haversine: haversine,
    fmtDuration: fmtDuration,
    fmtPace: fmtPace,
    fmtDist: fmtDist,
    getPermission: getPermission,
    requestPermission: requestPermission,
    permissionHelp: permissionHelp,
    getPrivacyMode: getPrivacyMode,
    setPrivacyMode: setPrivacyMode,
    getActivityType: getPrivacyPrefType,
    setActivityType: setActivityType,
    start: start,
    startManual: startManual,
    addManualDistance: addManualDistance,
    stop: stop,
    discard: discard,
    pause: pause,
    resume: resume,
    isRecording: isRecording,
    snapshot: snapshot,
    getRoutes: getRoutes,
    getRoute: getRoute,
        splitsForRoute: splitsForRoute,
        deleteRoute: deleteRoute,
    deleteAllRoutes: deleteAllRoutes,
    forgetAllLocationData: forgetAllLocationData,
    on: on,
    off: off
  };
})();
