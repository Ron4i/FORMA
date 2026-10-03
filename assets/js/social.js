/* FORMA — Соцсеть: сторис, лента, профили, достижения, челленджи.
   Всё работает локально (localStorage) + демо-контент, чтобы лента
   была живой с первого запуска. Готово к подключению к Cloudflare Worker. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  /* ---------- Демо-люди и публикации (однократный сид) ---------- */
  const DEMO_PEOPLE = [
    { handle: "@masha_fit", name: "Маша", avatar: "🔥", bio: "−18 кг за 7 месяцев. Верю в дефицит.", cover: "g1" },
    { handle: "@kirill_lift", name: "Кирилл", avatar: "💪", bio: "Силовые 4 раза в неделю.", cover: "g2" },
    { handle: "@anna_meal", name: "Анна", avatar: "🥗", bio: "Считаю БЖУ, готовлю из обычных продуктов.", cover: "g3" },
    { handle: "@dima_run", name: "Дима", avatar: "🏃", bio: "Бегаю по утрам. 10 км в день.", cover: "g4" },
    { handle: "@olya_water", name: "Оля", avatar: "💧", bio: "2 литра воды каждый день — мой суперсила.", cover: "g5" },
    { handle: "@max_bro", name: "Макс", avatar: "🏋️", bio: "Набор массы, 3200 ккал.", cover: "g6" }
  ];

  const h = 24 * 3600 * 1000;
  const now = () => Date.now();

  function seed() {
    if (store.getPosts().length && store.getStories().length) return;
    const p = store.getSocial();

    if (!p.following.length) {
      DEMO_PEOPLE.forEach((d) => {
        p.following.push(d.handle);
        p.followers.push(d.handle);
      });
      store.setSocial(p);
    }

    // --- Сторис (живут 24 ч) ---
    const stories = [
      { user: "@masha_fit", avatar: "🔥", type: "result", from: 84.5, to: 71.2, days: 214, text: "214 дней. Минус 13,3 кг.", grad: "g1" },
      { user: "@kirill_lift", avatar: "💪", type: "result", from: 78, to: 82.4, days: 120, text: "Набрал 4,4 кг мышц, жир не растёт.", grad: "g2" },
      { user: "@anna_meal", avatar: "🥗", type: "meal", title: "Мой завтрак", kcal: 420, p: 28, f: 14, c: 48, grad: "g3" },
      { user: "@dima_run", avatar: "🏃", type: "result", from: 92, to: 84, days: 90, text: "90 дней бега. Минус 8 кг.", grad: "g4" },
      { user: "@olya_water", avatar: "💧", type: "streak", count: 30, text: "30 дней воды по 2 литра 💧", grad: "g5" },
      { user: "@max_bro", avatar: "🏋️", type: "result", from: 63, to: 71, days: 150, text: "+8 кг качественной массы.", grad: "g6" }
    ];
    stories.forEach((s, i) => {
      store.addStory({
        user: s.user,
        avatar: s.avatar,
        type: s.type,
        from: s.from,
        to: s.to,
        days: s.days,
        text: s.text,
        title: s.title,
        kcal: s.kcal,
        p: s.p,
        f: s.f,
        c: s.c,
        count: s.count,
        grad: s.grad,
        ts: now() - (i * 37 + 5) * 60 * 1000
      });
    });

    // --- Лента ---
    // likes — массив хэндлов (кто лайкнул); likeCount — «социальное доказательство»
    // для демо-постов, у которых реальных лайков ещё нет.
    const posts = [
      {
        user: "@masha_fit", avatar: "🔥", grad: "g1",
        text: "Полгода назад весила 84,5 кг и не могла подняться на 4 этаж без отдыха. Сегодня — 71,2 кг. Секрет оказался простым: считать БЖУ и ходить 10 000 шагов каждый день.",
        tags: ["похудение", "результат"],
        likes: [], likeCount: 412, comments: [
          { user: "@anna_meal", avatar: "🥗", text: "Повторяю! Особенно про шаги — это реально работает." },
          { user: "@kirill_lift", avatar: "💪", text: "Сколько времени ушло на −13 кг?" }
        ],
        ts: now() - 3 * 3600 * 1000
      },
      {
        user: "@anna_meal", avatar: "🥗", grad: "g3",
        text: "Собрала меню на неделю за 20 минут с помощью ИИ. Каждый день попадает в мой дефицит. Экономит часы жизни.",
        tags: ["еда", "БЖУ"],
        likes: [], likeCount: 287, comments: [{ user: "@olya_water", avatar: "💧", text: "А расход калорий он тоже считает?" }],
        ts: now() - 9 * 3600 * 1000
      },
      {
        user: "@kirill_lift", avatar: "💪", grad: "g2",
        text: "Три года пахала в зале и ненавидела зеркала. Потом перешла на нормальное питание — 3200 ккал на набор. Через 4 месяца стало 82,4 кг, но теперь это не жир, а muscle.",
        tags: ["набор", "силовые"],
        likes: [], likeCount: 531, comments: [],
        ts: now() - 26 * 3600 * 1000
      },
      {
        user: "@dima_run", avatar: "🏃", grad: "g4",
        text: "90 дней утренних пробежек. Минус 8 кг и вроде упала тревожность.",
        tags: ["бег", "кардио"],
        likes: [], likeCount: 198, comments: [{ user: "@masha_fit", avatar: "🔥", text: "Молодец! 💪" }],
        ts: now() - 2 * 24 * 3600 * 1000
      }
    ];
    posts.forEach((x) => store.addPost(x));
  }

  function peopleMap() {
    const m = {};
    DEMO_PEOPLE.forEach((d) => (m[d.handle] = d));
    return m;
  }

  // Поле класса аватарки называется по-разному: у демо-людей — cover,
    // у профиля пользователя — тоже cover, а в разметке везде читается grad.
    // Приводим к одному ключу, иначе в class попадает "undefined".
    const gradOf = (p) => (p && (p.grad || p.cover)) || "gMe";

    function personOf(handle) {
      const s = store.getSocial();
      if (s.handle === handle) return { handle: s.handle, name: s.name || "Я", avatar: s.avatar || "🙂", bio: s.bio || "", grad: gradOf(s) === "gMe" ? "gMe" : gradOf(s) };
      const known = peopleMap()[handle];
      if (known) return { handle: known.handle, name: known.name, avatar: known.avatar, bio: known.bio, grad: gradOf(known) };
      return { handle: handle, name: handle.replace("@", ""), avatar: "🙂", bio: "", grad: "gMe" };
    }

  function timeAgo(ts) {
    const d = Math.floor((now() - ts) / 1000);
    if (d < 60) return "только что";
    if (d < 3600) return Math.floor(d / 60) + " мин";
    if (d < 86400) return Math.floor(d / 3600) + " ч";
    return Math.floor(d / 86400) + " дн";
  }

  /* ---------- Профиль: мой прогресс ---------- */
  function myProgress() {
    const ms = (store.getMeasurements() || []).filter((m) => m && m.weight);
    if (ms.length < 2) {
      const p = store.getProfile() || {};
      const w = p.weight || 0;
      return { from: w, to: w, delta: 0, days: 0 };
    }
    const first = ms[0];
    const last = ms[ms.length - 1];
    const days = Math.max(1, Math.round((new Date(last.date) - new Date(first.date)) / 86400));
    return { from: first.weight, to: last.weight, delta: +(last.weight - first.weight).toFixed(1), days: days };
  }

  function myStreak() {
    const st = store.getStories().filter((s) => s.user === store.getSocial().handle);
    if (st.length) {
      const wk = new Set();
      st.forEach((s) => {
        const d = new Date(s.ts);
        wk.add(d.getFullYear() + "-" + d.getMonth() + "-" + d.getWeek());
      });
      return wk.size;
    }
    return Fit.streak ? Fit.streak() : 0;
  }

  /* ---------- Лента: мой пост ---------- */
  function feed() {
    return store.getPosts().slice().sort((a, b) => b.ts - a.ts);
  }

  /* ---------- Лидерборд за неделю ---------- */
  function leaderboard() {
    const weekAgo = now() - 7 * 24 * 3600 * h / 7;
    const rows = DEMO_PEOPLE.map((d) => {
      const st = store.getStories().filter((s) => s.user === d.handle && s.type === "result");
      const best = st.length ? Math.max.apply(null, st.map((s) => Math.abs(s.from - s.to))) : 0;
      return { handle: d.handle, name: d.name, avatar: d.avatar, grad: gradOf(d), kg: best };
    });
    const prog = myProgress();
    const me = store.getSocial();
    rows.push({ handle: me.handle, name: me.name || "Я", avatar: me.avatar || "🙂", grad: "gMe", kg: Math.abs(prog.delta) });
    rows.sort((a, b) => b.kg - a.kg);
    rows.forEach((r, i) => (r.place = i + 1));
    return rows;
  }

  Fit.social = {
    DEMO_PEOPLE,
    seed,
    peopleMap,
    personOf,
    timeAgo,
    myProgress,
    myStreak,
    feed,
    leaderboard,
    timeAgoFn: timeAgo
  };
})();
