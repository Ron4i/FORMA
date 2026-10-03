/* ==========================================================
   FORMA — новые экраны: сканер, ИИ-тренер, план, лента,
   сторис, достижения, челленджи, рецепты, профиль, настройки.
   ========================================================== */
(function () {
  const Fit = window.Fit;
  const store = Fit.store;
  const esc = Fit.esc;
  const S = () => Fit.social;

  const GRADS = ["g1", "g2", "g3", "g4", "g5", "g6", "gMe"];

  function me() {
    return store.getSocial();
  }
  function myAvaCls() {
    return "gMe";
  }
  function pcls(handle) {
    return (S().personOf(handle) || {}).grad || "gMe";
  }

  /* ==================== 1. СКАНЕР ФОТО ==================== */
  Fit.register("/scan", scanView, function () {
    bindScan();
  });
  function scanView() {
    const cfg = store.getAiConfig ? store.getAiConfig() : { provider: "gemini", model: "gemini-2.0-flash" };
    const used = store.getAiUsage();

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">📸 ИИ-сканер</span>' +
      '<h1>Сфоткай еду — узнай БЖУ</h1>' +
      '<div class="sub">Наведи камеру или загрузи фото. ИИ определит блюдо, калории, жиры и углеводы.' +
      (used ? "<br><span class='muted'>Сканирований за эту неделю: " + used + "</span>" : "") +
      "</div></div>" +
      '<span class="badge-free">Бесплатно · без лимита</span></div>' +

      '<div style="display:grid;grid-template-columns:1.15fr .85fr;gap:18px" class="scan-layout">' +
      '<div class="scanner" id="sc">' +
      '<div class="reticle"></div>' +
      '<div class="hint">Нажмите «Сделать фото» или загрузите изображение с блюдом.<br>Лучше всего работает при дневном свете и сверху.</div>' +
      '<input type="file" id="sc-file" accept="image/*" capture="environment" hidden />' +
      "</div>" +

      '<div class="surface" style="align-self:start">' +
      '<div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px">' +
      '<button class="btn primary" id="sc-cam">📷 Сделать фото</button>' +
      '<button class="btn ghost" id="sc-pick">🖼 Из галереи</button>' +
      "</div>" +
      '<div class="chip-row" style="margin-bottom:12px">' +
      ['gemini', 'groq', 'offline'].map(
        (p) =>
          '<button class="chip ' + (cfg.provider === p ? "on" : "") + '" data-prov="' + p + '">' +
          (p === "gemini" ? "Gemini 2.0" : p === "groq" ? "Groq Vision" : "Офлайн-эвристика") + "</button>"
      ).join("") +
      "</div>" +
      '<p class="muted" style="font-size:12.5px" id="sc-prov-note"></p>' +
      '<div id="sc-out" style="margin-top:14px"></div>' +
      "</div></div></div>";

    return html;
  }

  function bindScan() {
    const sc = Fit.qs("#sc");
    if (!sc) return;
    const out = Fit.qs("#sc-out");
    const file = Fit.qs("#sc-file");
    let current = null;

    const note = () => {
      const cfg = store.getAiConfig ? store.getAiConfig() : {};
      const n = Fit.qs("#sc-prov-note");
      if (!n) return;
      if (cfg.provider === "offline") n.innerHTML = "Работает без интернета и без ключей: анализ цвета и ключевых слов. Точность ниже, но всегда доступно.";
      else if (Fit.ai.hasKey()) n.innerHTML = "Ключ подключён — используется <b>" + esc((cfg.model || "").slice(0, 34)) + "</b>. Учти: фото уходит на сервер провайдера.";
      else n.innerHTML = 'Ключ не задан — будет использована офлайн-эвристика. <a href="#/settings">Подключить бесплатный ключ →</a>';
    };
    note();

    Fit.qsa("[data-prov]").forEach((b) => {
      b.addEventListener("click", () => {
        const cur = store.getAiConfig ? store.getAiConfig() : {};
        store.setAiConfig({ provider: b.getAttribute("data-prov") });
        Fit.qsa("[data-prov]").forEach((x) => x.classList.toggle("on", x === b));
        note();
      });
    });

    const pick = () => file.click();
    Fit.qs("#sc-cam").addEventListener("click", pick);
    Fit.qs("#sc-pick").addEventListener("click", pick);

    file.addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        current = dataUrl;
        sc.querySelector(".hint").style.display = "none";
        let img = sc.querySelector("img");
        if (!img) {
          img = document.createElement("img");
          sc.insertBefore(img, sc.firstChild);
        }
        img.src = dataUrl;
        run(dataUrl);
      };
      reader.readAsDataURL(f);
    });

    async function run(dataUrl) {
      sc.classList.add("busy");
      out.innerHTML = '<div class="surface" style="text-align:center;padding:28px"><div class="typing"><i></i><i></i><i></i></div><p class="muted" style="margin-top:10px">Анализирую фото…</p></div>';
      try {
        const r = await Fit.ai.analyzeImage(dataUrl, { onProgress: (s) => (out.querySelector(".muted").textContent = s) });
        renderResult(r, dataUrl);
      } catch (err) {
        out.innerHTML = '<div class="surface" style="border-color:var(--danger)"><b>Ошибка анализа</b><p class="muted">' + esc(err.message || String(err)) + "</p></div>";
      } finally {
        sc.classList.remove("busy");
      }
    }

    function renderResult(r, dataUrl) {
      if (!r) {
        out.innerHTML = '<div class="surface" style="border-color:var(--danger)">Не удалось распознать блюдо. Попробуйте другое фото.</div>';
        return;
      }
      const conf = r.confidence != null ? Math.round(r.confidence * (r.confidence <= 1 ? 100 : 1)) : null;
      out.innerHTML =
        '<div class="scan-result">' +
        '<div class="surface">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
        "<div><b style='font-size:17px'>" + esc(r.name) + "</b>" +
        (conf != null ? "<div class='muted' style='font-size:12px'>уверенность " + conf + "%</div>" : "") +
        "</div>" +
        (r.portion ? '<span class="tag">' + esc(r.portion) + "</span>" : "") +
        "</div>" +
        '<div class="macro-grid" style="margin-top:13px">' +
        '<div class="macro-cell kcal"><b>' + Math.round(r.kcal) + "</b><span>ккал</span></div>" +
        '<div class="macro-cell p"><b>' + Math.round(r.p) + "</b><span>белки г</span></div>" +
        '<div class="macro-cell f"><b>' + Math.round(r.f) + "</b><span>жиры г</span></div>" +
        '<div class="macro-cell c"><b>' + Math.round(r.c) + "</b><span>углеводы г</span></div>" +
        "</div>" +
        (r.note ? '<p class="muted" style="font-size:12.5px;margin:12px 0 0">' + esc(r.note) + "</p>" : "") +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
        '<button class="btn primary sm" id="sc-add">Добавить в дневник</button>' +
        '<button class="btn ghost sm" id="sc-again">Другое фото</button>' +
        "</div></div>" +
        (r.items && r.items.length > 1
          ? '<div class="surface"><b style="font-size:14px">Состав блюда</b><div style="margin-top:8px">' +
            r.items.map((i) => '<div class="plan-meal"><span class="mi">🍽️</span><span class="mn">' + esc(i.name) + "</span>" +
              '<span class="mc">' + Math.round(i.kcal || 0) + " ккал</span></div>").join("") +
            "</div></div>"
          : "") +
        "</div>";

      Fit.qs("#sc-add").addEventListener("click", () => {
        const name = (r.name || "Блюдо").slice(0, 60);
        store.addNutrition(Fit.today(), {
          name: name,
          kcal: Math.round(r.kcal),
          p: Math.round(r.p),
          f: Math.round(r.f),
          c: Math.round(r.c),
          source: "ai",
          portion: r.portion || ""
        });
        Fit.toast("Добавлено в дневник ✅");
        store.recordAiUse();
        Fit.renderTo();
      });
      Fit.qs("#sc-again").addEventListener("click", () => {
        file.value = "";
        const img = sc.querySelector("img");
        if (img) img.remove();
        sc.querySelector(".hint").style.display = "";
        out.innerHTML = "";
      });
    }
  }

  /* ==================== 2. ИИ-ТРЕНЕР (чат) ==================== */
  Fit.register("/coach", coachView, function () {
    bindCoach();
  });
  function coachView() {
    const plan = store.getPlan();
    const p = store.getProfile() || {};
    const hasKey = Fit.ai.hasKey();
    const saved = store.getChatHistory ? store.getChatHistory() : [];

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">🤖 ИИ-тренер</span>' +
      '<h1>Твой персональный тренер</h1>' +
      '<div class="sub">Спроси про еду, тренировки, вес. Ответит ИИ или встроенный помощник.</div></div>' +
      '<div style="display:flex;gap:8px">' +
      '<a class="btn ghost sm" href="#/plan">📋 План на неделю</a>' +
      "</div></div>" +

      '<div class="surface chat-wrap">' +
      '<div class="chat-log" id="chat-log">' +
      (saved.length
        ? saved.map(bubble).join("")
        : '<div class="msg"><span class="av">🤖</span><div class="bub">Привет, ' +
          esc((p && p.name) || "друг") + "! Я FORMA-тренер. Помогу с планом похудения, подсчётом БЖУ и тренировками.\n\nЧто хочешь узнать?</div></div>") +
      "</div>" +
      '<div class="chat-input">' +
      '<input id="chat-in" placeholder="Например: сколько белка мне нужно для похудения?" autocomplete="off" />' +
      '<button class="btn primary" id="chat-send">→</button>' +
      "</div></div>" +

      '<div class="quick-q">' +
      ["Составь мне план похудения", "Сколько мне есть белка в день?", "Что съесть на ужин при дефиците?", "Как быстро похудеть без вреда?", "Составь меню на день", "Как часто тренироваться?"].map(
        (q) => '<button class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"
      ).join("") +
      "</div>" +

      (hasKey
        ? ""
        : '<div class="surface" style="margin-top:16px"><b>💡 Хочешь ИИ-ответы по фото и голосу?</b>' +
          '<p class="muted" style="font-size:13px;margin:6px 0 10px">Подключи бесплатный ключ Gemini или Groq в настройках — и тренер будет отвечать с учётом твоих данных.</p>' +
          '<a class="btn primary sm" href="#/settings">Настроить ИИ</a></div>');

    if (plan) {
      html +=
        '<div class="surface" style="margin-top:16px"><b>📋 Активный план</b>' +
        '<p class="muted" style="font-size:13px;margin:6px 0 10px">' + Math.round(plan.targetKcal || 0) + " ккал/день · создан " + S().timeAgo(plan.ts || Date.now()) + "</p>" +
        '<a class="btn ghost sm" href="#/plan">Открыть план</a></div>';
    }

    html += "</div>";
    return html;
  }

  function bubble(m) {
    return (
      '<div class="msg ' + (m.role === "user" ? "me" : "") + '">' +
      (m.role === "user" ? "" : '<span class="av">🤖</span>') +
      '<div class="bub">' + esc(m.text) + "</div>" +
      (m.role === "user" ? '<span class="av" style="background:var(--card-2);color:var(--muted)">' + esc((me().avatar || "🙂")) + "</span>" : "") +
      "</div>"
    );
  }

  function bindCoach() {
    const log = Fit.qs("#chat-log");
    if (!log) return;
    const input = Fit.qs("#chat-in");
    const send = Fit.qs("#chat-send");
    const hist = (store.getChatHistory ? store.getChatHistory() : []).slice(-16);

    const push = (m) => {
      log.insertAdjacentHTML("beforeend", bubble(m));
      log.scrollTop = log.scrollHeight;
    };

    async function ask(text) {
      push({ role: "user", text: text });
      store.pushChat({ role: "user", text: text });
      input.value = "";
      const t = document.createElement("div");
      t.className = "msg";
      t.innerHTML = '<span class="av">🤖</span><div class="bub"><span class="typing"><i></i><i></i><i></i></span></div>';
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
      try {
        const ans = await Fit.ai.chat(text, hist);
        t.remove();
        push({ role: "assistant", text: ans });
        store.pushChat({ role: "assistant", text: ans });
      } catch (e) {
        t.remove();
        push({ role: "assistant", text: "Не получилось связаться с ИИ. Проверь ключ в настройках или попробуй позже." });
      }
    }

    send.addEventListener("click", () => {
      const v = input.value.trim();
      if (v) ask(v);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const v = input.value.trim();
        if (v) ask(v);
      }
    });
    Fit.qsa("[data-q]").forEach((b) => {
      b.addEventListener("click", () => ask(b.getAttribute("data-q")));
    });
    log.scrollTop = log.scrollHeight;
  }

  /* ==================== 3. ПЛАН ИИ ==================== */
  Fit.register("/plan", planView, function () {
    bindPlan();
  });
  function planView() {
    const plan = store.getPlan();
    const p = store.getProfile();
    if (!p) {
      return '<div class="page"><div class="card welcome"><h1>Сначала профиль</h1><p>Нужны вес, рост и возраст.</p><a class="btn primary" href="#/profile">Заполнить</a></div></div>';
    }
    const m = Fit.calcMetrics(p);
    if (!plan) {
      return (
        '<div class="page"><div class="page-head"><div><span class="eyebrow">📋</span><h1>План на неделю</h1>' +
        '<div class="sub">ИИ соберёт меню и тренировки под твою цель</div></div></div>' +
        '<div class="surface"><b>Твои цифры</b>' +
        '<p class="muted" style="font-size:13.5px;margin:8px 0 14px">BMR: <b>' + Math.round(m.bmr) + "</b> ккал · Поддержание: <b>" + Math.round(m.tdee || m.target + 400) + "</b> ккал · Цель: <b>" + Math.round(m.target) + "</b> ккал/день</p>" +
        '<label>Целевой вес, кг<input type="number" id="plan-goal" step="0.5" value="' + (p.goalWeight || p.weight || 70) + '" /></label>' +
        '<label>Что предпочитаешь<select id="plan-pref"><option value="loss">Похудение</option><option value="gain">Набор массы</option><option value="keep">Поддержание</option></select></label>' +
        '<label style="margin-top:12px"><input type="checkbox" id="plan-ai" ' + (Fit.ai.hasKey() ? "checked" : "") + " disabled /> Использовать ИИ" + (Fit.ai.hasKey() ? "" : " (нужен ключ)") + "</label>" +
        '<button class="btn primary" id="plan-go" style="margin-top:16px">✨ Составить план</button></div></div>'
      );
    }
    const days = plan.days || [];
    let html =
      '<div class="page"><div class="page-head"><div><span class="eyebrow">📋 План на неделю</span>' +
      '<h1>' + Math.round(plan.targetKcal) + " ккал в день</h1>" +
      '<div class="sub">Б: ' + Math.round(plan.protein || 0) + " г · Ж: " + Math.round(plan.fat || 0) + " г · У: " + Math.round(plan.carb || 0) + " г</div></div>" +
      '<div style="display:flex;gap:8px"><button class="btn ghost sm" id="plan-regen">Обновить</button><a class="btn primary sm" href="#/routines">К тренировкам</a></div></div>';

    (plan.workouts || []).forEach((w, i) => {
      html += '<div class="surface" style="margin-bottom:10px;display:flex;align-items:center;gap:12px"><span class="ic" style="font-size:22px">💪</span><div style="flex:1"><b style="font-size:14.5px">' + esc(w.title) + "</b><div class='muted' style='font-size:12.5px'>" + esc(w.detail || "") + "</div></div></div>";
    });

    days.forEach((d) => {
      html +=
        '<div class="plan-day"><h4><span>' + esc(d.title || "День") + '</span><span class="kcal-pill">' + Math.round(d.kcal || 0) + " ккал</span></h4>";
      (d.meals || []).forEach((ml) => {
        html +=
          '<div class="plan-meal"><span class="mi">' + esc(ml.icon || "🍽️") + '</span>' +
          '<span class="mn">' + esc(ml.name) + '<div class="mk">' + esc((ml.items || []).join(", ")) + "</div></span>" +
          '<span class="mc">' + Math.round(ml.kcal || 0) + " ккал</span></div>";
      });
      if (d.workout) {
        html += '<div class="plan-meal"><span class="mi">🏋️</span><span class="mn">' + esc(d.workout) + '<div class="mk">Тренировка дня</div></span></div>';
      }
      html += "</div>";
    });
    html += "</div>";
    return html;
  }

  function bindPlan() {
    const go = Fit.qs("#plan-go");
    if (go) {
      go.addEventListener("click", async () => {
        const p = store.getProfile();
        p.goalWeight = parseFloat(Fit.qs("#plan-go").value) || p.goalWeight;
        p.goal = Fit.qs("#plan-pref").value;
        store.setProfile(p);
        go.disabled = true;
        go.textContent = "Составляю…";
        const useAi = Fit.qs("#plan-ai").checked;
        const plan = await Fit.ai.makePlan(p, { useAi: useAi });
        store.setPlan(plan);
        Fit.toast("План готов 🎉");
        Fit.renderTo();
      });
    }
    const regen = Fit.qs("#plan-regen");
    if (regen) {
      regen.addEventListener("click", () => {
        regen.disabled = true;
        regen.textContent = "Обновляю…";
        Fit.ai.makePlan(store.getProfile(), {}).then((plan) => {
          store.setPlan(plan);
          Fit.renderTo();
        });
      });
    }
  }

  /* ==================== 4. ЛЕНТА ==================== */
  Fit.register("/feed", feedView, function () {
    bindFeed(Fit.parseHash());
  });
  function feedView(r) {
    if (r.parts[1] === "new") return feedComposer();
    if (r.parts[1] === "u" && r.parts[2]) return userProfile(Fit.routeParam(r.parts[2]));
    return feedList();
  }

  function feedList() {
    const posts = S().feed();
    const stories = store.getStories();
    const my = me();
    const handles = [];
    stories.forEach((s) => {
      if (handles.indexOf(s.user) === -1) handles.push(s.user);
    });

    let rail =
      '<div class="stories-rail">' +
      '<a class="story add" href="#/feed/new"><span class="ring-wrap"><span class="inner">+</span></span><span class="nm">Моя история</span></a>' +
      handles.map((hd) => {
        const p = S().personOf(hd);
        const seen = stories.some((s) => s.user === hd && (s.views || []).indexOf(my.handle) !== -1);
        const label = hd === my.handle ? "Я" : p.name;
        return (
          '<button class="story ' + (seen ? "seen" : "new") + '" data-user="' + esc(hd) + '">' +
          '<span class="ring-wrap"><span class="inner">' + esc(p.avatar || "🙂") + "</span></span>" +
          '<span class="nm">' + esc(label) + "</span></button>"
        );
      }).join("") +
      "</div>";

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">👥 Сообщество</span>' +
      '<h1>Лента историй</h1>' +
      '<div class="sub">Смотри, как худеют люди вокруг. Поделись своим результатом.</div></div>' +
      '<a class="btn primary sm" href="#/feed/new">+ Поделиться</a></div>' +
      rail;

    // Лидерборд
    const lb = S().leaderboard().slice(0, 3);
    html +=
      '<div class="surface" style="margin:14px 0;display:flex;gap:14px;align-items:center;overflow-x:auto">' +
      lb.map((x) =>
        '<div style="display:flex;align-items:center;gap:8px;min-width:0">' +
        '<span style="font-size:17px">' + (x.place === 1 ? "🥇" : x.place === 2 ? "🥈" : "🥉") + "</span>" +
        '<span class="ava sm ' + x.grad + '">' + esc(x.avatar) + "</span>" +
        "<div><b style='font-size:12.5px'>" + esc(x.name) + "</b><div class='muted' style='font-size:11px'>" + x.kg + " кг</div></div></div>"
      ).join("") +
      "</div>";

    if (!posts.length) {
      html += '<div class="empty">Пока нет публикаций. Будь первым!</div>';
    } else {
      posts.forEach((p) => (html += postHtml(p)));
    }
    html += "</div>";
    return html;
  }

  function postHtml(p) {
    const liked = (p.likes || []).indexOf(me().handle) !== -1;
    const isMine = p.user === me().handle;
    const grad = pcls(p.user);
    const likesTotal = (p.likes || []).length + (p.likeCount || 0);
    let html =
      '<div class="feed-item" data-post="' + esc(p.id) + '">' +
      '<div class="feed-head">' +
      '<a href="#/feed/u/' + encodeURIComponent(p.user) + '" class="ava ' + grad + '">' + esc(p.avatar || "🙂") + "</a>" +
      '<div class="meta"><div class="nm">' + esc(p.name || p.user) + "</div>" +
      '<div class="sub">' + S().timeAgo(p.ts) + "</div></div>" +
      (isMine ? '<button class="act" data-del="' + esc(p.id) + '" title="Удалить">🗑</button>' : "") +
      "</div>" +
      (p.text ? '<div class="feed-text">' + esc(p.text) + "</div>" : "") +
      (p.tags && p.tags.length ? '<div class="feed-tags">' + p.tags.map((t) => '<span class="tag">#' + esc(t) + "</span>").join("") + "</div>" : "") +
      '<div class="feed-actions">' +
      '<button class="act ' + (liked ? "on" : "") + '" data-like="' + esc(p.id) + '">' + Fit.iconSvg("heart") + "<span>" + likesTotal + "</span></button>" +
      '<button class="act" data-cmt="' + esc(p.id) + '">' + Fit.iconSvg("chat") + "<span>" + (p.comments || []).length + "</span></button>" +
      (isMine ? "" : '<button class="act" data-follow="' + esc(p.user) + '">' + (store.isFollowing(p.user) ? "✓ Вы подписаны" : "+ Подписаться") + "</button>") +
      "</div>";

    if ((p.comments || []).length) {
      html += '<div class="comments">' + p.comments.map((c) =>
        '<div class="comment"><span class="ava sm ' + pcls(c.user) + '">' + esc(c.avatar || "🙂") + "</span>" +
        '<div class="txt"><b>' + esc(c.name || c.user) + "</b> " + esc(c.text) + "</div></div>"
      ).join("") + "</div>";
    }
    html +=
      '<div class="comments"><div class="comment-box">' +
      '<input placeholder="Написать комментарий…" data-cmtin="' + esc(p.id) + '" />' +
      '<button class="btn primary sm" data-cmtsend="' + esc(p.id) + '">→</button>' +
      "</div></div></div>";
    return html;
  }

  function feedComposer() {
    const p = store.getProfile() || {};
    const prog = S().myProgress();
    const my = me();
    const s = store.getSocial();

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">✍️</span><h1>Поделись результатом</h1>' +
      '<div class="sub">Твоя история вдохновит других</div></div>' +
      '<a class="btn ghost sm" href="#/feed">Отмена</a></div>' +

      '<div class="surface" style="margin-bottom:16px"><b>Профиль в ленте</b>' +
      '<div style="display:flex;gap:12px;align-items:center;margin-top:12px">' +
      '<input id="c-ava" value="' + esc(my.avatar || "🙂") + '" style="width:58px;text-align:center;font-size:24px" />' +
      "<div style='flex:1'><input id='c-name' value='" + esc(my.name || (p && p.name) || "Я") + "' placeholder='Имя' /></div>" +
      "<div style='flex:1'><input id='c-handle' value='" + esc(my.handle || "@user") + "' placeholder='@handle' /></div>" +
      "</div></div>" +

      '<div class="surface" style="margin-bottom:16px"><b>Результат</b>' +
      '<div class="result-preview" style="margin-top:12px">' +
      "<div><div class='big' id='c-delta'>" + (prog.delta ? (prog.delta > 0 ? "+" : "") + prog.delta + " кг" : "0 кг") + "</div>" +
      "<div style='font-size:12.5px;opacity:.8'>" + prog.from + " → " + prog.to + " кг за " + prog.days + " дн.</div></div>" +
      "</div>" +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px">' +
      '<label>Было, кг<input type="number" step="0.1" id="c-from" value="' + prog.from + '" /></label>' +
      '<label>Стало, кг<input type="number" step="0.1" id="c-to" value="' + prog.to + '" /></label>' +
      '<label>Дней<input type="number" id="c-days" value="' + prog.days + '" /></label>' +
      '<label>Тип<select id="c-type"><option value="result">Похудение</option><option value="gain">Набор</option><option value="streak">Серия</option></select></label>' +
      "</div>" +
      '<button class="btn ghost sm" id="c-addstory" style="margin-top:12px">📲 Опубликовать как сторис (24 ч)</button></div>' +

      '<div class="surface composer"><b>Пост в ленту</b>' +
      '<label style="margin-top:10px">Что расскажешь?<textarea id="c-text" placeholder="Мой путь к цели: как худел(а), что помогло, советы…"></textarea></label>' +
      '<label>Теги<input id="c-tags" placeholder="похудение, рецепты, бег" /></label>' +
      '<button class="btn primary" id="c-post" style="margin-top:14px">Опубликовать</button></div>' +
      "</div>";
    return html;
  }

  function userProfile(handle) {
    const p = S().personOf(handle);
    const mine = handle === me().handle;
    const posts = store.getPosts().filter((x) => x.user === handle);
    const stories = store.getStories().filter((s) => s.user === handle);
    let html =
      '<div class="page">' +
      '<div class="page-head"><div><a class="btn ghost sm" href="#/feed">← Лента</a></div></div>' +
      '<div class="surface" style="text-align:center;margin-bottom:16px">' +
      '<div class="ava lg ' + (p.grad || "gMe") + '" style="margin:0 auto 12px">' + esc(p.avatar || "🙂") + "</div>" +
      "<h1 style='margin:0;font-size:22px'>" + esc(p.name || handle) + "</h1>" +
      "<div class='muted' style='font-size:13px'>" + esc(handle) + "</div>" +
      (p.bio ? "<p style='margin:10px auto 0;max-width:44ch;font-size:14px;line-height:1.6'>" + esc(p.bio) + "</p>" : "") +
      '<div style="display:flex;gap:10px;justify-content:center;margin-top:16px">' +
      '<div><b style="font-size:17px">' + posts.length + "</b><div class='muted' style='font-size:11.5px'>постов</div></div>" +
      '<div><b style="font-size:17px">' + stories.length + "</b><div class='muted' style='font-size:11.5px'>сторис</div></div>" +
      '<div><b style="font-size:17px">' + ((store.getSocial().followers || []).indexOf(handle) !== -1 ? "1" : "0") + "</b><div class='muted' style='font-size:11.5px'>подписчиков</div></div>" +
      "</div>";
    if (!mine) {
      html += '<button class="btn ' + (store.isFollowing(handle) ? "ghost" : "primary") + '" id="up-follow" style="margin-top:16px">' + (store.isFollowing(handle) ? "✓ Вы подписаны" : "Подписаться") + "</button>";
    }
    html += "</div>";

    if (stories.length) {
      html += '<h2 class="section">Сторис</h2><div class="stories-rail">';
      stories.forEach((s) => {
        html += '<button class="story" data-open="' + esc(s.id) + '"><span class="ring-wrap"><span class="inner">' + esc(s.avatar || "🙂") + "</span></span><span class='nm'>" + S().timeAgo(s.ts) + "</span></button>";
      });
      html += "</div>";
    }
    html += "<h2 class='section'>Посты</h2>";
    if (!posts.length) html += '<div class="empty">Пока нет постов</div>';
    else posts.forEach((x) => (html += postHtml(x)));
    html += "</div>";
    return html;
  }

  /* ---------- Поведение ленты ---------- */
  function bindFeed(r) {
    if (r.parts[1] === "new") return bindComposer();
    if (r.parts[1] === "u" && r.parts[2]) {
      const f = Fit.qs("#up-follow");
      if (f) {
        f.addEventListener("click", () => {
          store.toggleFollow(Fit.routeParam(r.parts[2]));
          Fit.renderTo();
        });
      }
      Fit.qsa("[data-open]").forEach((b) => b.addEventListener("click", () => openViewer([b.getAttribute("data-open")], 0)));
      bindPosts();
      return;
    }

    Fit.qsa("[data-user]").forEach((b) =>
      b.addEventListener("click", () => {
        const list = store.getStories().filter((s) => s.user === b.getAttribute("data-user")).map((s) => s.id);
        if (list.length) openViewer(list, 0);
      })
    );
    bindPosts();
  }

  function bindPosts() {
    Fit.qsa("[data-like]").forEach((b) =>
      b.addEventListener("click", () => {
        store.toggleLike(b.getAttribute("data-like"), me().handle);
        Fit.renderTo();
      })
    );
    Fit.qsa("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (await Fit.confirmDialog("Удалить публикацию?")) {
          store.deletePost(b.getAttribute("data-del"));
          Fit.renderTo();
        }
      })
    );
    Fit.qsa("[data-follow]").forEach((b) =>
      b.addEventListener("click", () => {
        store.toggleFollow(b.getAttribute("data-follow"));
        Fit.toast(store.isFollowing(b.getAttribute("data-follow")) ? "Вы подписались" : "Вы отписались");
        Fit.renderTo();
      })
    );
    Fit.qsa("[data-cmtsend]").forEach((b) =>
      b.addEventListener("click", () => {
        const id = b.getAttribute("data-cmtsend");
        const inp = Fit.qs('[data-cmtin="' + id + '"]');
        const v = inp.value.trim();
        if (!v) return;
        const m = me();
        store.addComment(id, { user: m.handle, name: m.name, avatar: m.avatar, text: v });
        Fit.renderTo();
      })
    );
    Fit.qsa("[data-cmtin]").forEach((i) =>
      i.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const btn = Fit.qs('[data-cmtsend="' + i.getAttribute("data-cmtin") + '"]');
          if (btn) btn.click();
        }
      })
    );
  }

  function bindComposer() {
    const up = (a, b) => {
      const d = parseFloat(Fit.qs("#c-from").value) - parseFloat(Fit.qs("#c-to").value);
      const dEl = Fit.qs("#c-delta");
      if (dEl) dEl.textContent = (d > 0 ? "-" : d < 0 ? "+" : "") + Math.abs(d).toFixed(1) + " кг";
    };
    Fit.qs("#c-from").addEventListener("input", up);
    Fit.qs("#c-to").addEventListener("input", up);

    const collect = () => {
      const m = me();
      m.avatar = Fit.qs("#c-ava").value.trim() || "🙂";
      m.name = Fit.qs("#c-name").value.trim() || "Я";
      m.handle = (Fit.qs("#c-handle").value.trim() || "@user").replace(/^@?/, "@");
      store.setSocial(m);
      return m;
    };

    Fit.qs("#c-addstory").addEventListener("click", () => {
      const m = collect();
      const from = parseFloat(Fit.qs("#c-from").value) || 0;
      const to = parseFloat(Fit.qs("#c-to").value) || 0;
      const days = parseInt(Fit.qs("#c-days").value, 10) || 1;
      const type = Fit.qs("#c-type").value;
      store.addStory({
        user: m.handle, avatar: m.avatar, type: type,
        from: from, to: to, days: days,
        text: m.name + ": " + (from - to).toFixed(1) + " кг за " + days + " дн.",
        grad: "gMe"
      });
      Fit.toast("Сторис опубликована на 24 часа 📲");
      Fit.navigate("#/feed");
    });

    Fit.qs("#c-post").addEventListener("click", () => {
      const m = collect();
      const tags = Fit.qs("#c-tags").value.split(",").map((x) => x.trim().replace(/^#/, "")).filter(Boolean).slice(0, 5);
      const text = Fit.qs("#c-text").value.trim();
      if (!text) {
        Fit.toast("Напишите хоть пару слов", "error");
        return;
      }
      const from = parseFloat(Fit.qs("#c-from").value) || 0;
      const to = parseFloat(Fit.qs("#c-to").value) || 0;
      const days = parseInt(Fit.qs("#c-days").value, 10) || 1;
      store.addPost({
        user: m.handle, name: m.name, avatar: m.avatar, grad: "gMe",
        text: text, tags: tags, likes: [], comments: [],
        from: from, to: to, days: days
      });
      store.grantBadge("story1");
      Fit.toast("Опубликовано! 🎉");
      Fit.navigate("#/feed");
    });
  }

  /* ==================== 5. ПРОСМОТР СОРИС ==================== */
  function openViewer(ids, startIdx) {
    let idx = startIdx;
    const all = store.getStories();
    const wrap = document.createElement("div");
    wrap.className = "story-viewer";
    document.body.appendChild(wrap);

    function render() {
      const s = all.find((x) => x.id === ids[idx]);
      if (!s) return close();
      store.markStoryViewed(s.id);
      const person = S().personOf(s.user);
      const grad = s.grad || person.grad || "g1";
      wrap.innerHTML =
        '<div class="bars">' + ids.map((_, i) => "<i class='" + (i < idx ? "done" : i === idx ? "now" : "") + "'" + (i === idx ? ' style="--w:0%"' : "") + "></i>").join("") + "</div>" +
        '<div class="sv-head"><span class="ava sm ' + grad + '">' + esc(s.avatar || "🙂") + "</span>" +
        "<div><div class='who'>" + esc(person.name || s.user) + "</div><div class='when'>" + S().timeAgo(s.ts) + " назад</div></div>" +
        '<button class="btn ghost sm" style="margin-left:auto" data-close>✕</button></div>' +
        '<div class="sv-body"><div class="sv-card ' + grad + '" style="background:var(--grad-blue)">' + cardInner(s) + "</div></div>" +
        '<div class="sv-foot">' +
        (Fit.STORY_REACTIONS || ["🔥", "👏", "💪", "❤️", "😮", "🙌", "😭", "🥇"]).map((e) => '<button class="sv-reaction" data-react="' + e + '">' + e + "</button>").join("") +
        "</div>" +
        '<div class="sv-nav prev" data-prev></div><div class="sv-nav next" data-next></div>';

      // Запустить прогресс-бар
      const now = wrap.querySelector(".bars i.now");
      if (now) requestAnimationFrame(() => now.style.setProperty("--w", "100%"));

      wrap.querySelector("[data-close]").addEventListener("click", close);
      wrap.querySelector("[data-prev]").addEventListener("click", () => step(-1));
      wrap.querySelector("[data-next]").addEventListener("click", () => step(1));
      wrap.querySelectorAll("[data-react]").forEach((b) =>
        b.addEventListener("click", () => {
          Fit.toast("Реакция " + b.getAttribute("data-react") + " отправлена");
          step(1);
        })
      );

      clearTimeout(wrap._t);
      wrap._t = setTimeout(() => step(1), 5000);
    }

    function cardInner(s) {
      if (s.type === "result") {
        const d = +(s.to - s.from).toFixed(1);
        return (
          '<div class="delta">' + (d > 0 ? "+" : "") + d + "</div>" +
          '<div class="from-to">' + s.from + " → " + s.to + " кг</div>" +
          '<div class="cap">' + esc(s.text || "") + "</div>" +
          '<div class="cap" style="opacity:.7">' + s.days + " дней</div>"
        );
      }
      if (s.type === "meal") {
        return (
          '<div class="emoji-big">🍽️</div>' +
          '<div class="from-to">' + esc(s.title || "Моё блюдо") + "</div>" +
          '<div class="cap">' + Math.round(s.kcal || 0) + " ккал · Б " + Math.round(s.p || 0) + " · Ж " + Math.round(s.f || 0) + " · У " + Math.round(s.c || 0) + "</div>"
        );
      }
      if (s.type === "streak") {
        return '<div class="emoji-big">🔥</div><div class="delta">' + (s.count || 0) + "</div><div class='cap'>" + esc(s.text || "дней подряд") + "</div>";
      }
      return '<div class="emoji-big">✨</div><div class="cap">' + esc(s.text || "") + "</div>";
    }

    function step(d) {
      clearTimeout(wrap._t);
      idx += d;
      if (idx < 0) idx = 0;
      if (idx >= ids.length) return close();
      render();
    }
    function close() {
      clearTimeout(wrap._t);
      wrap.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) {
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    render();
  }

  /* ==================== 6. ДОСТИЖЕНИЯ ==================== */
  Fit.register("/challenges", challengesView, function () {
    bindChallenges();
  });
  function challengesView() {
    const got = store.getBadges();
    const active = store.getChallenges();
    const my = me();
    const prog = S().myProgress();

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">🏆</span><h1>Достижения и челленджи</h1>' +
      '<div class="sub">Прокачивай серию и собирай награды</div></div></div>' +

      '<div class="surface" style="margin-bottom:16px;display:flex;align-items:center;gap:16px;flex-wrap:wrap">' +
      '<div class="ring violet" style="--p:' + Math.min(100, got.length * 10) + '"><div><div class="rv">' + got.length + '</div><div class="rl">из ' + Fit.BADGES.length + "</div></div></div>" +
      "<div style='flex:1;min-width:180px'><b>Очки опыта</b><div class='muted' style='font-size:13px'>Заработано: " +
      got.reduce((s, b) => s + ((Fit.BADGES.find((x) => x.id === b) || {}).xp || 0), 0) + " XP</div>" +
      "<div style='display:flex;gap:6px;flex-wrap:wrap;margin-top:8px'>" +
      got.map((b) => "<span class='tag'>" + esc((Fit.BADGES.find((x) => x.id === b) || { e: "" }).e) + "</span>").join("") +
      "</div></div></div>" +

      "<h2 class='section'>Челленджи</h2>";
    Fit.CHALLENGES.forEach((c) => {
      const on = active.indexOf(c.id) !== -1;
      html +=
        '<div class="chal"><span class="ic">' + c.e + "</span>" +
        '<div class="body"><div class="ttl">' + esc(c.title) + "</div>" +
        '<div class="ds">' + esc(c.desc) + " · " + c.days + " дн. · +" + c.xp + " XP</div></div>" +
        (on ? '<span class="tag">Активен</span>' : '<button class="btn primary sm" data-ch="' + esc(c.id) + '">Начать</button>') +
        "</div>";
    });

    html += "<h2 class='section'>Достижения</h2><div class='badge-grid'>";
    Fit.BADGES.forEach((b) => {
      const has = got.indexOf(b.id) !== -1;
      html +=
        '<div class="badge ' + (has ? "" : "locked") + '"><div class="ic">' + b.e + "</div>" +
        '<div class="nm">' + esc(b.title) + "</div>" +
        '<div class="ds">' + esc(b.desc) + "</div>" +
        '<div class="xp">' + (has ? "✓ " : "") + b.xp + " XP</div></div>";
    });
    html += "</div></div>";
    return html;
  }

  function bindChallenges() {
    Fit.qsa("[data-ch]").forEach((b) =>
      b.addEventListener("click", () => {
        store.startChallenge(b.getAttribute("data-ch"));
        Fit.toast("Челлендж начат! Удачи 💪");
        Fit.renderTo();
      })
    );
  }

  /* ==================== 7. РЕЦЕПТЫ ==================== */
  Fit.register("/recipes", recipesView, function () {
    bindRecipes(Fit.parseHash());
  });
  function findRecipe(r) {
      const id = r.parts[1];
      if (!id) return null;
      const rec = Fit.RECIPES.find((x) => x.id === id);
      if (!rec) return null;
      // Название в ссылке — только украшение для человека. Если оно не совпало
      // (старый хэш, другой регистр), всё равно открываем рецепт по id.
      return rec;
    }

    function recipesView(r) {
      if (r.parts[1]) {
        const rec = findRecipe(r);
        if (!rec) return Fit.navigate("#/recipes");
        let html =
        '<div class="page"><div class="page-head"><div><a class="btn ghost sm" href="#/recipes">← Рецепты</a></div>' +
        '<button class="btn primary sm" id="rc-eat">Добавить в дневник</button></div>' +
        '<div class="surface"><div style="font-size:56px;text-align:center">' + rec.e + "</div>" +
        "<h1 style='text-align:center;margin:10px 0 4px'>" + esc(rec.title) + "</h1>" +
        "<div class='muted' style='text-align:center'>" + rec.min + " мин · " + rec.kcal + " ккал</div>" +
        '<div class="macro-grid" style="margin-top:16px">' +
        '<div class="macro-cell kcal"><b>' + rec.kcal + "</b><span>ккал</span></div>" +
        '<div class="macro-cell p"><b>' + rec.p + "</b><span>белки г</span></div>" +
        '<div class="macro-cell f"><b>' + rec.f + "</b><span>жиры г</span></div>" +
        '<div class="macro-cell c"><b>' + rec.c + "</b><span>углеводы г</span></div>" +
        "</div>" +
        "<h3 style='margin:18px 0 8px'>Ингредиенты</h3><div>" +
        rec.ing.map((i) => '<div class="list-row"><span>' + esc(i) + "</span></div>").join("") +
        "</div></div></div>";
      return html;
    }

    let html =
      '<div class="page"><div class="page-head"><div><span class="eyebrow">🥗</span><h1>Рецепты</h1>' +
      '<div class="sub">Простые блюда с посчитанными БЖУ — на дефиците и на наборе</div></div></div><div class="recipe-grid">';
    Fit.RECIPES.forEach((rc) => {
      html +=
        '<a class="recipe" href="#/recipes/' + encodeURIComponent(rc.id) + '">' +
        '<div class="thumb" style="background:' + rc.bg + '">' + rc.e + "</div>" +
        '<div class="rb"><div class="rt">' + esc(rc.title) + "</div>" +
        '<div class="rm">' + rc.min + " мин · " + (rc.tags || []).slice(0, 2).join(", ") + "</div>" +
        '<div class="rk"><span>🔥</span><b>' + rc.kcal + "</b> <span>Б</span><b>" + rc.p + "</b> <span>Ж</span><b>" + rc.f + "</b> <span>У</span><b>" + rc.c + "</b></div></div></a>";
    });
    html += "</div></div>";
    return html;
  }

  function bindRecipes(r) {
    const e = Fit.qs("#rc-eat");
    if (!e) return;
    e.addEventListener("click", () => {
          const rec = findRecipe(r);
      if (!rec) return;
      store.addNutrition(Fit.today(), { name: rec.title, kcal: rec.kcal, p: rec.p, f: rec.f, c: rec.c, source: "recipe" });
      Fit.toast("Добавлено в дневник ✅");
    });
  }

  /* ==================== 8. НАСТРОЙКИ (расширенные) ==================== */
  Fit.register("/settings", renderSettings, function (el) {
    // Базовые обработчики (тема/данные/профиль) + новые (ИИ/уведомления/соцпрофиль)
    if (Fit.VIEW_BINDS["/settings-base"]) Fit.VIEW_BINDS["/settings-base"](el);
    bindSettings();
  });

  function renderSettings() {
    const base = Fit.renderBaseSettings ? Fit.renderBaseSettings() : "";
    const cfg = store.getAiConfig ? store.getAiConfig() : {};
    const perm = Fit.push.permission();

    let html =
      '<div class="page">' +
      '<div class="page-head"><div><span class="eyebrow">⚙️</span><h1>Настройки</h1></div></div>' +

      (base || "") +

      /* --- ИИ --- */
      '<div class="surface" style="margin-top:16px"><h3 style="margin-top:0">🤖 ИИ-модель</h3>' +
      '<p class="muted" style="font-size:12.5px">Бесплатные провайдеры с фото-распознаванием. Ключ хранится только в твоём браузере.</p>' +
      '<label>Провайдер<select id="ai-prov">' +
      '<option value="gemini"' + (cfg.provider === "gemini" ? " selected" : "") + '>Google Gemini 2.0 Flash (бесплатно)</option>' +
      '<option value="groq"' + (cfg.provider === "groq" ? " selected" : "") + '>Groq Llama Vision (бесплатно)</option>' +
      '<option value="offline"' + (cfg.provider === "offline" ? " selected" : "") + '>Офлайн-эвристика (без ключа)</option>' +
      "</select></label>" +
      '<label>Модель<input id="ai-model" value="' + esc(cfg.model || "gemini-2.0-flash") + '" /></label>' +
      '<label>API-ключ<div class="ai-key-row"><input type="password" id="ai-key" value="' + esc(cfg.key || "") + '" placeholder="AIza… / gsk_…" />' +
      '<button class="btn ghost" id="ai-save">Сохранить</button></div></label>' +
      '<p class="muted" style="font-size:11.5px;margin-top:8px">Ключ Gemini: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> · Groq: <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a></p>' +
      "</div>" +

      /* --- Уведомления --- */
      '<div class="surface" style="margin-top:16px"><h3 style="margin-top:0">🔔 Уведомления</h3>' +
      (perm === "granted"
        ? '<p class="muted" style="font-size:13px">Разрешение выдано. Расписание ниже.</p>'
        : perm === "denied"
          ? '<p class="muted" style="font-size:13px;color:var(--danger)">Разрешение заблокировано в браузере. Разрешите уведомления в настройках сайта.</p>'
          : '<button class="btn primary sm" id="nt-ask">Разрешить уведомления</button>') +
      '<button class="btn ghost sm" id="nt-test" style="margin-top:8px;margin-left:8px">Тест</button>' +
      '<div style="margin-top:14px">' +
      Fit.NOTIFY_TEMPLATES.map(
        (t) =>
          '<div class="notif-tpl"><span class="ne">' + t.e + "</span>" +
          '<div class="nt"><b>' + esc(t.title) + "</b><span>каждые " + t.every + " мин, " + t.min + ":00–" + t.max + ":00</span></div>" +
          '<div class="toggle ' + (store.isScheduleOn(t.id) ? "on" : "") + '" data-tpl="' + esc(t.id) + '"></div></div>'
      ).join("") +
      "</div></div>" +

      /* --- Профиль в соцсети --- */
      '<div class="surface" style="margin-top:16px"><h3 style="margin-top:0">👤 Профиль в ленте</h3>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<input id="soc-ava" value="' + esc(me().avatar || "🙂") + '" style="width:58px;text-align:center;font-size:24px" />' +
      "<input id='soc-name' value='" + esc(me().name || "") + "' placeholder='Имя' style='flex:1;min-width:110px' />" +
      "<input id='soc-handle' value='" + esc(me().handle || "@user") + "' placeholder='@handle' style='flex:1;min-width:110px' />" +
      "</div>" +
      '<label style="margin-top:10px">О себе<textarea id="soc-bio" style="min-height:60px">' + esc(me().bio || "") + "</textarea></label>" +
      '<button class="btn primary sm" id="soc-save" style="margin-top:10px">Сохранить</button></div>' +

      "</div>";
    return html;
  }

  function bindSettings() {
    // --- ИИ ---
    const save = Fit.qs("#ai-save");
    if (save) {
      save.addEventListener("click", () => {
        const cfg = store.getAiConfig ? store.getAiConfig() : {};
        cfg.provider = Fit.qs("#ai-prov").value;
        cfg.model = Fit.qs("#ai-model").value.trim();
        cfg.key = Fit.qs("#ai-key").value.trim();
        store.setAiConfig(cfg);
        Fit.toast("Настройки ИИ сохранены");
        Fit.renderTo();
      });
    }
    // --- Уведомления ---
    const ask = Fit.qs("#nt-ask");
    if (ask) {
      ask.addEventListener("click", async () => {
        const p = await Fit.push.requestPermission();
        Fit.toast(p === "granted" ? "Уведомления включены 🔔" : "Не выдано разрешение", p === "granted" ? "" : "error");
        Fit.renderTo();
      });
    }
    const test = Fit.qs("#nt-test");
    if (test) test.addEventListener("click", () => Fit.push.test());
    Fit.qsa("[data-tpl]").forEach((t) =>
      t.addEventListener("click", () => {
        store.toggleSchedule(t.getAttribute("data-tpl"));
        t.classList.toggle("on");
      })
    );
    // --- Соцпрофиль ---
    const ss = Fit.qs("#soc-save");
    if (ss) {
      ss.addEventListener("click", () => {
        const m = me();
        m.avatar = Fit.qs("#soc-ava").value.trim() || "🙂";
        m.name = Fit.qs("#soc-name").value.trim();
        m.handle = (Fit.qs("#soc-handle").value.trim() || "@user").replace(/^@?/, "@");
        m.bio = Fit.qs("#soc-bio").value.trim();
        store.setSocial(m);
        Fit.toast("Профиль обновлён");
        Fit.renderTo();
      });
    }
  }

  Fit.renderBaseSettings = function () {
    const theme = store.getTheme();
    return (
      '<div class="surface"><h3 style="margin-top:0">🎨 Тема</h3><div class="seg">' +
      '<button class="btn sm ' + (theme === "dark" ? "primary" : "ghost") + '" data-theme="dark">Тёмная</button>' +
      '<button class="btn sm ' + (theme === "light" ? "primary" : "ghost") + '" data-theme="light">Светлая</button>' +
      "</div></div>" +
      '<div class="surface" style="margin-top:16px"><h3 style="margin-top:0">💾 Данные</h3>' +
      '<div class="row-actions">' +
      '<button class="btn ghost" id="export">Экспорт (JSON)</button>' +
      '<button class="btn ghost" id="import">Импорт</button>' +
      '<input type="file" id="import-file" accept="application/json" style="display:none">' +
      "</div>" +
      '<p class="muted" style="font-size:13px">Все данные хранятся локально в твоём браузере.</p></div>'
    );
  };
})();
