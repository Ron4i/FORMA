(function () {
  const Fit = (window.Fit = window.Fit || {});
  const KEY = "fitAppData_v1";

  const defaults = {
    profile: null,
    customExercises: [],
    routines: [],
    workouts: [],
    measurements: [],
    nutrition: [],
    water: [],
    activities: [],
    aiConfig: { provider: "gemini", endpoint: "", key: "", model: "gemini-2.0-flash" },
    tier: "free",
    aiUsage: { week: "", count: 0 },
    theme: "dark",
    presetsLoaded: false,
    /* --- GPS, активность и приватность --- */
    routes: [],
    gpsDraft: null,
    geoLastKnown: null,
    privacyMode: "off", // 'off' | 'while-using' | 'background'
    activityType: "run",
    social: { handle: "", name: "", avatar: "", bio: "", cover: "", following: [], followers: [] },
    posts: [],
    stories: [],
    storyViews: [],
    notifications: { enabled: false, permission: "default", schedules: {}, lastSent: {} },
    achievements: [],
    challenges: [],
    plan: null,
    chat: [],
    steps: {},
    favorites: []
  };

  let state = load();
  const listeners = [];

  function emit() {
    listeners.forEach((fn) => {
      try { fn(state); } catch (e) {}
    });
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        return migrate(Object.assign({}, JSON.parse(JSON.stringify(defaults)), JSON.parse(raw)));
      }
    } catch (e) {}
    return migrate(JSON.parse(JSON.stringify(defaults)));
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // offset в днях: today(-6) — шесть дней назад. Возвращает YYYY-MM-DD.
  function today(offset) {
    const d = new Date();
    if (offset) d.setDate(d.getDate() + offset);
    // toISOString сдвигает на часовой пояс, поэтому собираем дату вручную.
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function weekKey() {
    const d = new Date();
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  // likes — всегда массив хэндлов. Раньше демо-посты хранили число,
  // поэтому переносим его в likeCount, чтобы не потерять «социальное доказательство».
  function normLikes(p) {
    if (Array.isArray(p.likes)) return p.likes;
    if (typeof p.likes === "number") {
      p.likeCount = p.likeCount != null ? p.likeCount : p.likes;
      p.likes = [];
      return p.likes;
    }
    p.likes = [];
    return p.likes;
  }

  // Приводит сохранённые данные к текущей схеме (миграция при загрузке)
  // Сырой (неотсортированный) доступ к маршрутам — нужен экспорту.
  function getRoutesRaw() {
    return state.routes || [];
  }

  function migrate(s) {
    s.routes = Array.isArray(s.routes) ? s.routes : [];
    s.activities = Array.isArray(s.activities) ? s.activities : [];
    s.water = Array.isArray(s.water) ? s.water : [];
    s.nutrition = Array.isArray(s.nutrition) ? s.nutrition : [];
    s.workouts = Array.isArray(s.workouts) ? s.workouts : [];
    s.routines = Array.isArray(s.routines) ? s.routines : [];
    s.measurements = Array.isArray(s.measurements) ? s.measurements : [];
    s.customExercises = Array.isArray(s.customExercises) ? s.customExercises : [];
    s.achievements = Array.isArray(s.achievements) ? s.achievements : [];
    s.challenges = Array.isArray(s.challenges) ? s.challenges : [];
    s.steps = s.steps || {};
    s.favorites = Array.isArray(s.favorites) ? s.favorites : [];
    s.privacyMode = s.privacyMode || "off";
    s.activityType = s.activityType || "run";
    s.posts = (s.posts || []).map((p) => {
      normLikes(p);
      p.comments = p.comments || [];
      return p;
    });
    s.stories = (s.stories || []).map((st) => {
      st.reactions = Array.isArray(st.reactions) ? st.reactions : [];
      st.views = st.views || 0;
      return st;
    });
    return s;
  }

  const store = {
    getState() {
      return state;
    },
    save,

    // Точечное обновление состояния. Используется новыми модулями (GPS и др.),
    // которым не нужен отдельный метод под каждое поле.
    setState(patch) {
      Object.assign(state, patch || {});
      save();
      emit();
      return state;
    },

    getProfile() {
      return state.profile;
    },
    // Безопасный профиль: всегда объект, даже если пользователь его не заполнял
    getProfileOr(p) {
      if (!state.profile) {
        state.profile = Object.assign(
          { name: "Я", weight: 70, height: 170, age: 28, sex: "f", activity: 1.375, goalWeight: 65 },
          p || {}
        );
        save();
      }
      return state.profile;
    },
    setProfile(p) {
      state.profile = p;
      save();
    },

    ensurePresets() {
      if (!state.presetsLoaded) {
        state.routines = state.routines.concat(Fit.PRESET_ROUTINES.map((r) => JSON.parse(JSON.stringify(r))));
        if (!state.measurements.length && state.profile && state.profile.weight) {
          state.measurements.push({ date: today(), weight: state.profile.weight });
        }
        state.presetsLoaded = true;
        save();
      }
    },

    getAllExercises() {
      return Fit.EXERCISES.concat(state.customExercises);
    },
    addCustomExercise(ex) {
      ex.id = "custom_" + uid();
      state.customExercises.push(ex);
      save();
      return ex;
    },

    getRoutines() {
      return state.routines;
    },
    getRoutine(id) {
      return state.routines.find((r) => r.id === id);
    },
    addRoutine(r) {
      r.id = "r_" + uid();
      r.preset = false;
      r.exercises = r.exercises || [];
      state.routines.push(r);
      save();
      return r;
    },
    updateRoutine(r) {
      const i = state.routines.findIndex((x) => x.id === r.id);
      if (i >= 0) {
        state.routines[i] = r;
        save();
      }
    },
    deleteRoutine(id) {
      state.routines = state.routines.filter((r) => r.id !== id);
      save();
    },

    addWorkout(w) {
      w.id = "w_" + uid();
      state.workouts.push(w);
      save();
      return w;
    },
    getWorkouts() {
      return state.workouts.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    deleteWorkout(id) {
      state.workouts = state.workouts.filter((w) => w.id !== id);
      save();
    },

    addMeasurement(m) {
      state.measurements.push(m);
      state.measurements.sort((a, b) => (a.date < b.date ? -1 : 1));
      save();
    },
    getMeasurements() {
      return state.measurements;
    },

    addNutrition(e) {
      // Поддерживает addNutrition(entry) и addNutrition(date, entry)
      if (e && typeof e === "string" && arguments.length > 1) {
        e = Object.assign({}, arguments[1], { date: e });
      }
      e = Object.assign({}, e);
      e.id = "n_" + uid();
      e.date = e.date || today();
      state.nutrition.push(e);
      save();
      return e;
    },
    getNutrition(date) {
      return state.nutrition.filter((n) => (n.date || "").slice(0, 10) === date);
    },
    deleteNutrition(id) {
      state.nutrition = state.nutrition.filter((n) => n.id !== id);
      save();
    },
    nutritionTotals(date) {
      return state.nutrition
        .filter((n) => (n.date || "").slice(0, 10) === date)
        .reduce(
          (a, n) => ({
            kcal: a.kcal + (+n.kcal || 0),
            p: a.p + (+n.p || 0),
            f: a.f + (+n.f || 0),
            c: a.c + (+n.c || 0)
          }),
          { kcal: 0, p: 0, f: 0, c: 0 }
        );
    },

    addWater(ml, date) {
      date = date || today();
      const rec = state.water.find((w) => w.date === date);
      if (rec) rec.ml += ml;
      else state.water.push({ date, ml });
      save();
    },
    getWater(date) {
      date = date || today();
      const rec = state.water.find((w) => w.date === date);
      return rec ? rec.ml : 0;
    },

    addActivity(a) {
      a.id = "a_" + uid();
      state.activities.push(a);
      save();
      return a;
    },
    getActivities() {
      return state.activities.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    },

    /* ---------- Маршруты GPS ---------- */
    getRoutes() {
      return (state.routes || []).slice().sort((a, b) => (a.start > b.start ? 1 : -1));
    },
    getRoute(id) {
      return (state.routes || []).find((r) => r.id === id);
    },
    addRoute(r) {
      r.id = r.id || "rt_" + uid();
      state.routes = state.routes || [];
      state.routes.push(r);
      // Заодно пополняем общую активность, чтобы прогресс и лента видели маршрут.
      if (r.distance > 0) {
        const type = (Fit.ACTIVITY_TYPES || {})[r.type] || { id: r.type, label: "Активность" };
        state.activities.push({
          id: "a_" + uid(),
          date: r.date,
          type: r.type,
          kind: "route",
          routeId: r.id,
          duration: r.duration,
          distance: r.distance / 1000,
          points: (r.points || []).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t })),
          kcal: r.kcal || 0,
          elevGain: r.elevGain || 0
        });
      }
      save();
      emit();
      return r;
    },
    deleteRoute(id) {
      state.routes = (state.routes || []).filter((r) => r.id !== id);
      state.activities = (state.activities || []).filter((a) => a.routeId !== id);
      save();
      emit();
      return id;
    },
    deleteAllRoutes() {
      state.routes = [];
      state.activities = (state.activities || []).filter((a) => a.kind !== "route");
      state.gpsDraft = null;
      state.geoLastKnown = null;
      save();
      emit();
    },

    getAiConfig() {
      return state.aiConfig;
    },
    setAiConfig(cfg) {
      state.aiConfig = Object.assign({}, state.aiConfig, cfg);
      save();
    },

    /* ---------- Чат с ИИ-тренером ---------- */
    getChatHistory() {
      return (state.chat || []).slice(-40);
    },
    pushChat(msg) {
      state.chat = state.chat || [];
      state.chat.push({ role: msg.role, text: msg.text, ts: Date.now() });
      if (state.chat.length > 40) state.chat = state.chat.slice(-40);
      save();
    },
    clearChat() {
      state.chat = [];
      save();
    },
    getTier() {
      return state.tier;
    },
    setTier(t) {
      state.tier = t;
      save();
    },
    // FORMA не продаёт ИИ-сканер: у конкурентов он стоит 600–900 ₽/мес,
    // здесь он остаётся бесплатным без лимита. Счётчик ведётся для статистики.
    aiLimit() {
      return Infinity;
    },
    canUseAi() {
      return true;
    },
    recordAiUse() {
      const wk = weekKey();
      if (state.aiUsage.week !== wk) state.aiUsage = { week: wk, count: 0 };
      state.aiUsage.count++;
      save();
    },
    getAiUsage() {
      const wk = weekKey();
      if (state.aiUsage.week !== wk) state.aiUsage = { week: wk, count: 0 };
      return state.aiUsage.count;
    },

    getTheme() {
      return state.theme;
    },
    setTheme(t) {
      state.theme = t;
      save();
    },

    /* ---------- Соцсеть: профиль, посты, сторис ---------- */
    getSocial() {
      return state.social;
    },
    setSocial(s) {
      state.social = Object.assign({}, state.social, s);
      save();
      emit();
      return state.social;
    },
    myHandle() {
      return state.social.handle || (state.profile && state.profile.name) || "я";
    },

    getPosts() {
      return state.posts.slice().sort((a, b) => b.ts - a.ts);
    },
    addPost(p) {
      p.id = "po_" + uid();
      p.ts = p.ts || Date.now();
      p.likes = normLikes(p);
      p.comments = p.comments || [];
      state.posts.push(p);
      save();
      emit();
      return p;
    },
    getPost(id) {
      return state.posts.find((p) => p.id === id);
    },
    deletePost(id) {
      state.posts = state.posts.filter((p) => p.id !== id);
      save();
      emit();
    },
    toggleLike(id, who) {
      const p = state.posts.find((x) => x.id === id);
      if (!p) return false;
      p.likes = normLikes(p);
      const i = p.likes.indexOf(who);
      if (i >= 0) p.likes.splice(i, 1);
      else p.likes.push(who);
      save();
      emit();
      return i < 0;
    },
    addComment(id, c) {
      const p = state.posts.find((x) => x.id === id);
      if (!p) return null;
      c.ts = Date.now();
      c.id = "c_" + uid();
      c.handle = c.handle || "@" + this.myHandle();
      p.comments = p.comments || [];
      p.comments.push(c);
      save();
      emit();
      return c;
    },
    isFollowing(handle) {
      return (state.social.following || []).indexOf(handle) >= 0;
    },
    toggleFollow(handle) {
      state.social.following = state.social.following || [];
      const i = state.social.following.indexOf(handle);
      if (i >= 0) state.social.following.splice(i, 1);
      else state.social.following.push(handle);
      save();
      emit();
      return i < 0;
    },

    /* ---------- Сторис (живут 24 часа) ---------- */
    getStories() {
      const now = Date.now();
      state.stories = state.stories.filter((s) => s.expires > now);
      return state.stories.slice().sort((a, b) => b.ts - a.ts);
    },
    addStory(s) {
      s.id = "st_" + uid();
      s.ts = Date.now();
      s.expires = s.ts + 24 * 3600 * 1000;
      s.views = s.views || [];
      s.handle = s.handle || "@" + this.myHandle();
      state.stories.push(s);
      save();
      emit();
      return s;
    },
    markStoryViewed(id) {
      const s = state.stories.find((x) => x.id === id);
      if (!s) return;
      s.views = s.views || [];
      if (s.views.indexOf(this.myHandle()) < 0) {
        s.views.push(this.myHandle());
        save();
      }
    },
    deleteStory(id) {
      state.stories = state.stories.filter((s) => s.id !== id);
      save();
      emit();
    },

    /* ---------- Уведомления ---------- */
    getNotifyCfg() {
      return state.notifications;
    },
    setNotifyCfg(c) {
      state.notifications = Object.assign({}, state.notifications, c);
      save();
    },
    isScheduleOn(id) {
      const s = state.notifications.schedules || {};
      return !!s[id];
    },
    toggleSchedule(id) {
      const s = state.notifications.schedules || {};
      if (s[id]) delete s[id];
      else s[id] = true;
      state.notifications.schedules = s;
      save();
      emit();
      return !!s[id];
    },
    noteSent(id) {
      state.notifications.lastSent = state.notifications.lastSent || {};
      state.notifications.lastSent[id] = Date.now();
      save();
    },
    lastSent(id) {
      const l = (state.notifications.lastSent || {})[id] || 0;
      return l;
    },

    /* ---------- Достижения, челленджи ---------- */
    getBadges() {
      return state.achievements;
    },
    hasBadge(id) {
      return state.achievements.some((b) => b.id === id);
    },
    grantBadge(id) {
      if (this.hasBadge(id)) return null;
      const def = Fit.BADGES.find((b) => b.id === id);
      if (!def) return null;
      const b = Object.assign({}, def, { ts: Date.now() });
      state.achievements.push(b);
      save();
      emit();
      return b;
    },
    getChallenges() {
      return state.challenges;
    },
    startChallenge(id) {
      if (state.challenges.some((c) => c.id === id)) return null;
      const def = Fit.CHALLENGES.find((c) => c.id === id);
      if (!def) return null;
      const c = Object.assign({}, def, { start: Date.now(), days: [] });
      state.challenges.push(c);
      save();
      emit();
      return c;
    },
    isChallengeActive(id) {
      return state.challenges.some((c) => c.id === id);
    },

    /* ---------- План от ИИ ---------- */
    getPlan() {
      return state.plan;
    },
    setPlan(p) {
      state.plan = p;
      save();
      emit();
    },

    /* ---------- Шаги ---------- */
    setSteps(n, date) {
      date = date || today();
      state.steps[date] = n;
      save();
    },
    getSteps(date) {
      return state.steps[date || today()] || 0;
    },

    /* ---------- Избранное ---------- */
    toggleFav(id) {
      state.favorites = state.favorites || [];
      const i = state.favorites.indexOf(id);
      if (i >= 0) state.favorites.splice(i, 1);
      else state.favorites.push(id);
      save();
      emit();
      return i < 0;
    },
    isFav(id) {
      return (state.favorites || []).indexOf(id) >= 0;
    },

    onChange(fn) {
      listeners.push(fn);
    },

    exportData() {
      return JSON.stringify(state, null, 2);
    },

    // CSV по маршрутам. Координаты округляем до 6 знаков (~11 см) — точнее не нужно.
    exportRoutesCsv() {
      const head = [
        "id", "дата", "тип", "длительность_с", "дистанция_м", "темп_мин_км",
        "средняя_скорость_кмч", "набор_высоты_м", "потеря_высоты_м",
        "калории", "источник", "точек"
      ];
      const esc = (v) => {
        const s = v == null ? "" : String(v);
        return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      const rows = [head.join(";")];
      getRoutesRaw().forEach((r) => {
        const km = (r.distance || 0) / 1000;
        const dur = r.duration || 0;
        rows.push(
          [
            r.id,
            (r.date || "").slice(0, 19).replace("T", " "),
            r.type,
            dur,
            Math.round(r.distance || 0),
            dur > 0 && km > 0.01 ? (dur / 60 / km).toFixed(2) : "",
            r.avgSpeed || "",
            Math.round(r.elevGain || 0),
            Math.round(r.elevLoss || 0),
            r.kcal || 0,
            r.source || "gps",
            (r.points || []).length
          ].map(esc).join(";")
        );
      });
      return rows.join("\n");
    },

    // Выгрузка всех точек одного маршрута — для сторонних карт и анализа.
    exportRoutePointsCsv(routeId) {
      const r = getRoutesRaw().find((x) => x.id === routeId);
      if (!r) return "";
      const rows = ["index;timestamp;lat;lng;accuracy;alt;hr"];
      (r.points || []).forEach((p, i) => {
        rows.push([i, new Date(p.t).toISOString(), p.lat, p.lng, p.acc, p.alt == null ? "" : p.alt, p.hr == null ? "" : p.hr].join(";"));
      });
      return rows.join("\n");
    },
    importData(json) {
      const parsed = JSON.parse(json);
      state = Object.assign({}, JSON.parse(JSON.stringify(defaults)), parsed);
      save();
      emit();
    },
    reset() {
      state = JSON.parse(JSON.stringify(defaults));
      save();
      emit();
    }
  };

  Fit.store = store;
  Fit.uid = uid;
  Fit.today = today;
})();
