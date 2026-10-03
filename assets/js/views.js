(function () {
  const Fit = window.Fit;
  const store = Fit.store;
  const esc = Fit.esc;

  function isThisWeek(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = (now - d) / 86400000;
    return diff >= 0 && diff < 7;
  }

  function card(title, value, sub) {
    return (
      '<div class="stat"><div class="stat-v">' + esc(value) + '</div><div class="stat-l">' + esc(title) + "</div>" +
      (sub ? '<div class="stat-s">' + esc(sub) + "</div>" : "") + "</div>"
    );
  }

  Fit.register("/", function () {
    const p = store.getProfile();
    if (!p) {
      return (
        '<div class="page"><div class="hero">' +
        '<span class="eyebrow">🚀 Бесплатно · без подписки</span>' +
        "<h1>Сфоткай еду. Похудей на результат.</h1>" +
        "<p>FORMA — ИИ-тренер в твоём кармане. Считает калории, жиры и углеводы по фото еды, строит личный план похудения и показывает реальные истории людей рядом.</p>" +
        '<div class="cta"><button class="btn primary" onclick="Fit.navigate(\'#/profile\')">Начать бесплатно</button>' +
        '<a class="btn ghost" href="#/feed">Смотреть истории</a></div>' +
        "</div>" +
        '<div class="quick-grid">' +
        '<a class="quick" href="#/scan"><span class="qi">' + Fit.iconSvg("scan") + "</span>Скан еды</a>" +
        '<a class="quick" href="#/coach"><span class="qi">' + Fit.iconSvg("coach") + "</span>ИИ-тренер</a>" +
        '<a class="quick" href="#/routines"><span class="qi">' + Fit.iconSvg("routines") + "</span>Тренировки</a>" +
        '<a class="quick" href="#/feed"><span class="qi">' + Fit.iconSvg("feed") + "</span>Лента</a>" +
        "</div></div>"
      );
    }
    const metrics = Fit.calcMetrics(p);
    const workouts = store.getWorkouts();
    const weekCount = workouts.filter((w) => isThisWeek(w.date)).length;
    const str = Fit.streak ? Fit.streak() : 0;
    const recent = workouts.slice(0, 5);
    const routines = store.getRoutines();
    const water = store.getWater();
    const waterGoal = p.waterGoal || 2000;
    const calGoal = metrics ? metrics.target : 2000;
    const totals = store.nutritionTotals(Fit.today());
    const aiUsed = store.getAiUsage();
    const prog = Fit.social.myProgress();
    const myHandle = store.getSocial().handle;
    const stories = store.getStories();
    const newStories = stories.filter((s) => (s.views || []).indexOf(myHandle) === -1).length;

    const kcalPct = Math.min(100, Math.round((totals.kcal / calGoal) * 100));
    const waterPct = Math.min(100, Math.round((water / waterGoal) * 100));

    let html =
      '<div class="page">' +
      '<div class="hero">' +
      '<span class="eyebrow">' + (str > 0 ? "🔥 Серия " + str + " дн." : "👋 С возвращением") + "</span>" +
      "<h1>Привет, " + esc(p.name || "друг") + "!</h1>" +
      "<p>Сегодня осталось <b>" + Math.max(0, Math.round(calGoal - totals.kcal)) + " ккал</b> до твоей цели. Ты на верном пути.</p>" +
      '<div class="cta">' +
      '<a class="btn primary" href="#/scan">📸 Сфоткай еду</a>' +
      '<a class="btn ghost" href="#/coach">ИИ-тренер</a>' +
      '<a class="btn ghost" href="#/plan">📋 План на неделю</a>' +
      '<a class="btn ghost" href="#/routines">Тренировка</a>' +
      "</div></div>" +

      // Кольца прогресса
      '<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' +
      '<div class="stat" style="display:grid;place-items:center">' +
      '<div class="ring" style="--p:' + kcalPct + '"><div><div class="rv">' + Math.round(totals.kcal) + "</div><div class='rl'>из " + calGoal + " ккал</div></div></div></div>" +
      '<div class="stat" style="display:grid;place-items:center">' +
      '<div class="ring blue" style="--p:' + waterPct + '"><div><div class="rv">' + Math.round(water) + "</div><div class='rl'>из " + waterGoal + " мл</div></div></div></div>" +
      card("Тренировок за неделю", weekCount) +
      card("Серия дней", str) +
      "</div>" +

      // Быстрые действия
      '<div class="quick-grid" style="margin:18px 0">' +
      '<a class="quick" href="#/scan"><span class="qi">' + Fit.iconSvg("scan") + "</span>Скан</a>" +
      '<a class="quick" href="#/coach"><span class="qi">' + Fit.iconSvg("coach") + "</span>Тренер</a>" +
      '<a class="quick" href="#/progress"><span class="qi">' + Fit.iconSvg("progress") + "</span>Прогресс</a>" +
      '<a class="quick" href="#/feed"><span class="qi">' + Fit.iconSvg("feed") + "</span>Лента" + (newStories ? " • " + newStories : "") + "</a>" +
      "</div>";

    // Мой результат
    if (Math.abs(prog.delta) >= 0.1) {
      html +=
        '<div class="surface" style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap">' +
        "<div><b style='font-size:15px'>Твой результат</b><div class='muted' style='font-size:13px'>За " + prog.days + " дн.: " + prog.from + " → " + prog.to + " кг</div></div>" +
        '<a class="btn primary sm" href="#/feed/new">Показать историю</a></div>';
    }

    if (recent.length) {
      html += '<h2 class="section">Последние тренировки</h2><div class="list">';
      recent.forEach((w) => {
        const r = store.getRoutine(w.routineId);
        html +=
          '<div class="list-row"><div><b>' + esc(r ? r.name : "Тренировка") + "</b><span>" + Fit.fmtDate(w.date) + " · " + Fit.fmtTime(w.duration || 0) + "</span></div>" +
          '<div class="muted">' + Fit.workoutVolume(w) + " кг объём</div></div>";
      });
      html += "</div>";
    } else {
      html += '<div class="empty">Пока нет тренировок. Начните первую!</div>';
    }

    if (routines.length) {
      const r0 = routines[0];
      html +=
        '<h2 class="section">Рекомендуем сегодня</h2>' +
        '<div class="card routine-card" onclick="Fit.navigate(\'#/session/' + r0.id + "')\">" +
        '<div><b>' + esc(r0.name) + "</b><span>" + r0.exercises.length + " упражнений</span></div>" +
        '<button class="btn primary sm">Старт</button></div>';
    }

    html +=
      '<div class="surface" style="margin-top:16px"><h3 style="margin:0 0 6px">ИИ-анализ питания по фото</h3>' +
      '<p class="muted">ИИ-сканирование бесплатно и без лимита' + (aiUsed ? " — использовано: " + aiUsed : "") + '. Подключи бесплатный ключ Gemini или Groq, чтобы фото уходило в настоящий ИИ.' + "</p>" +
      '<a class="btn primary sm" href="#/scan">Сканировать еду</a></div>';

    html += "</div>";
    return html;
  });

  Fit.register("/nutrition", function () {
    const p = store.getProfile() || {};
    const date = Fit.today();
    const logs = store.getNutrition(date);
    const totals = store.nutritionTotals(date);
    const water = store.getWater(date);
    const waterGoal = p.waterGoal || 2000;
    const m = Fit.calcMetrics(p);
    const calGoal = m ? m.target : 2000;
    const aiUsed = store.getAiUsage();

    let html = '<div class="page"><div class="head-row"><h1 class="section">Питание</h1>' +
      '<button class="btn primary sm" id="scan-food">📷 Сканировать еду</button></div>';

    html += '<div class="card"><h3>Сегодня: ' + date + '</h3><div class="macros">' +
      macro("Калории", Math.round(totals.kcal), calGoal, "ккал") +
      macro("Белок", Math.round(totals.p), Math.round((calGoal * 0.3) / 4), "г") +
      macro("Жиры", Math.round(totals.f), Math.round((calGoal * 0.3) / 9), "г") +
      macro("Углеводы", Math.round(totals.c), Math.round((calGoal * 0.4) / 4), "г") +
      "</div></div>";

    html += '<div class="card"><h3>Вода</h3>' +
      '<div class="water-ring"><div class="water-fill" style="height:' + Math.min(100, Math.round((water / waterGoal) * 100)) + '%"></div>' +
      "<span>" + Math.round(water) + " / " + waterGoal + " мл</span></div>" +
      '<div class="row-actions"><button class="btn ghost sm" data-water="250">+250</button>' +
      '<button class="btn ghost sm" data-water="500">+500</button>' +
      '<button class="btn ghost sm" data-water="1000">+1000</button></div></div>';

    if (aiUsed) {
      html += '<div class="card muted">ИИ-сканирований за эту неделю: ' + aiUsed + ". Бесплатно и без ограничений.</div>";
    }

    html += '<div class="card"><div class="head-row"><h3>Приёмы пищи</h3>' +
      '<button class="btn ghost sm" id="add-food">+ Добавить</button></div><div class="list" id="food-list">';
    if (logs.length) {
      logs.forEach((n) => {
        html += '<div class="list-row"><div><b>' + esc(n.name) + "</b><span>" + esc(n.meal || "") + (n.ai ? " · ИИ" : "") + "</span></div>" +
          '<div class="row-actions"><span class="muted">' + Math.round(n.kcal) + ' ккал</span>' +
          '<button class="btn ghost sm" data-del-n="' + n.id + '">✕</button></div></div>';
      });
    } else {
      html += '<div class="empty">Пока пусто. Добавьте приём пищи или отсканируйте фото.</div>';
    }
    html += "</div></div></div>";

    Fit.bind(function () {
      Fit.qs("#scan-food").addEventListener("click", openScanModal);
      Fit.qs("#add-food").addEventListener("click", () => openFoodPicker(addFoodFromPicker));
      Fit.qsa("[data-water]").forEach((b) =>
        b.addEventListener("click", () => {
          store.addWater(+b.dataset.water);
          Fit.renderTo();
        })
      );
      Fit.qsa("[data-del-n]").forEach((b) =>
        b.addEventListener("click", () => {
          store.deleteNutrition(b.dataset.delN);
          Fit.renderTo();
        })
      );
    });
    return html;
  });

  function macro(label, val, goal, unit) {
    const pct = goal ? Math.min(100, Math.round((val / goal) * 100)) : 0;
    return '<div class="macro"><div class="macro-bar"><div class="macro-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="macro-l">' + label + '</div><div class="macro-v">' + val + " / " + goal + " " + unit + "</div></div>";
  }

  function addFoodFromPicker(food, meal) {
    store.addNutrition({ name: food.name, kcal: food.kcal, p: food.p, f: food.f, c: food.c, meal: meal });
    Fit.renderTo();
  }

  function openFoodPicker(onPick) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = '<div class="modal wide"><h3>Выберите продукт</h3>' +
      '<input id="fk-search" placeholder="Поиск..." style="margin-bottom:10px">' +
      '<select id="fk-meal" style="margin-bottom:10px"><option value="Завтрак">Завтрак</option><option value="Обед">Обед</option><option value="Ужин">Ужин</option><option value="Перекус">Перекус</option></select>' +
      '<div class="picker-list" id="fk-list"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Готово</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.hasAttribute("data-close")) ov.remove();
    });
    const list = Fit.qs("#fk-list", ov);
    function paint() {
      const q = Fit.qs("#fk-search", ov).value.toLowerCase();
      list.innerHTML = Fit.FOODS.filter((x) => !q || x.name.toLowerCase().includes(q))
        .map((x) => '<div class="picker-row" data-id="' + x.id + '"><b>' + esc(x.name) + '</b><span class="muted">' + x.kcal + " ккал</span></div>")
        .join("");
    }
    paint();
    Fit.qs("#fk-search", ov).addEventListener("input", paint);
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".picker-row");
      if (!row) return;
      const food = Fit.FOODS.find((x) => x.id === row.dataset.id);
      const meal = Fit.qs("#fk-meal", ov).value;
      ov.remove();
      onPick(food, meal);
    });
  }

  function openScanModal() {
    const cfg = store.getAiConfig();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML = '<div class="modal"><h3>Сканирование еды</h3>' +
      "<p class=\"muted\">Загрузите фото блюда. " + (cfg.endpoint ? "Анализ через настроенный ИИ-эндпоинт." : "Эндпоинт ИИ не настроен — заполните вручную.") + "</p>" +
      '<input type="file" id="scan-file" accept="image/*">' +
      (cfg.endpoint ? '<button class="btn primary" id="scan-go" style="margin-top:10px">Анализировать ИИ</button>' : "") +
      '<button class="btn ghost" id="scan-manual" style="margin-top:10px">Заполнить вручную</button>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Отмена</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.hasAttribute("data-close")) ov.remove();
    });
    Fit.qs("#scan-manual", ov).addEventListener("click", () => {
      ov.remove();
      openFoodPicker(addFoodFromPicker);
    });
    const goBtn = Fit.qs("#scan-go", ov);
    if (goBtn) {
      goBtn.addEventListener("click", async () => {
        const file = Fit.qs("#scan-file", ov).files[0];
        if (!file) return Fit.toast("Выберите фото", "error");
        const fd = new FormData();
        fd.append("image", file);
        try {
          const res = await fetch(cfg.endpoint, {
            method: "POST",
            body: fd,
            headers: cfg.key ? { Authorization: "Bearer " + cfg.key } : undefined
          });
          const data = await res.json();
          store.addNutrition({
            name: data.name || "Блюдо (ИИ)",
            kcal: +data.kcal || 0,
            p: +data.p || 0,
            f: +data.f || 0,
            c: +data.c || 0,
            meal: "Обед",
            ai: true
          });
          store.recordAiUse();
          Fit.toast("Проанализировано ИИ");
          ov.remove();
          Fit.renderTo();
        } catch (err) {
          Fit.toast("Ошибка ИИ-эндпоинта. Заполните вручную.", "error");
        }
      });
    }
  }

  Fit.register("/exercises", function () {
    const all = store.getAllExercises();
    const muscleOpts = Fit.MUSCLE_GROUPS.map((m) => '<option value="' + m.id + '">' + m.label + "</option>").join("");
    const equipOpts = Fit.EQUIPMENT.map((e) => '<option value="' + e.id + '">' + e.label + "</option>").join("");
    let html =
      '<div class="page"><h1 class="section">Библиотека упражнений</h1>' +
      '<div class="toolbar">' +
      '<input id="ex-search" placeholder="Поиск..." />' +
      '<select id="ex-muscle"><option value="">Все группы</option>' + muscleOpts + "</select>" +
      '<select id="ex-equip"><option value="">Всё оборудование</option>' + equipOpts + "</select>" +
      '<button class="btn primary sm" id="add-ex">+ Своё</button>' +
      "</div>" +
      '<div class="grid" id="ex-grid"></div></div>';
    Fit.bind(function () {
      const grid = Fit.qs("#ex-grid");
      function paint() {
        const q = Fit.qs("#ex-search").value.toLowerCase();
        const m = Fit.qs("#ex-muscle").value;
        const e = Fit.qs("#ex-equip").value;
        const list = all.filter(
          (x) => (!q || x.name.toLowerCase().includes(q)) && (!m || x.muscle === m) && (!e || x.equipment === e)
        );
        grid.innerHTML = list
          .map(
            (x) =>
              '<div class="card ex-card" data-id="' + x.id + '"><div class="ex-top"><b>' + esc(x.name) + "</b>" +
              '<span class="tag">' + esc(Fit.muscleLabel(x.muscle)) + "</span></div>" +
              '<div class="muted">' + esc(Fit.equipLabel(x.equipment)) + " · " + esc(x.difficulty) + "</div></div>"
          )
          .join("") || '<div class="empty">Ничего не найдено</div>';
      }
      ["#ex-search", "#ex-muscle", "#ex-equip"].forEach((s) => Fit.qs(s).addEventListener("input", paint));
      paint();

      grid.addEventListener("click", (ev) => {
        const card = ev.target.closest(".ex-card");
        if (!card) return;
        const ex = store.getAllExercises().find((x) => x.id === card.dataset.id);
        openExerciseModal(ex);
      });

      Fit.qs("#add-ex").addEventListener("click", openCustomForm);
    });
    return html;
  });

  function openExerciseModal(ex) {
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal"><h3>' + esc(ex.name) + "</h3>" +
      '<p class="muted">' + esc(Fit.muscleLabel(ex.muscle)) + " · " + esc(Fit.equipLabel(ex.equipment)) + " · " + esc(ex.difficulty) + "</p>" +
      "<p>" + esc(ex.instructions) + "</p>" +
      '<div class="modal-actions"><button class="btn primary" data-close>Закрыть</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.hasAttribute("data-close")) ov.remove();
    });
  }

  function openCustomForm() {
    const muscleOpts = Fit.MUSCLE_GROUPS.map((m) => '<option value="' + m.id + '">' + m.label + "</option>").join("");
    const equipOpts = Fit.EQUIPMENT.map((e) => '<option value="' + e.id + '">' + e.label + "</option>").join("");
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal"><h3>Своё упражнение</h3>' +
      '<form id="custom-form"><label>Название<input name="name" required></label>' +
      '<label>Группа мышц<select name="muscle">' + muscleOpts + "</select></label>" +
      '<label>Оборудование<select name="equipment">' + equipOpts + "</select></label>" +
      '<label>Тип<select name="type"><option value="strength">Силовое</option><option value="cardio">Кардио</option></select></label>' +
      '<label>Сложность<select name="difficulty"><option>Начальный</option><option>Средний</option><option>Продвинутый</option></select></label>' +
      '<label>Описание<textarea name="instructions" rows="3"></textarea></label>' +
      '<div class="modal-actions"><button type="button" class="btn ghost" data-close>Отмена</button>' +
      '<button type="submit" class="btn primary">Добавить</button></div></form></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.hasAttribute("data-close")) ov.remove();
    });
    Fit.qs("#custom-form", ov).addEventListener("submit", (e) => {
      e.preventDefault();
      const f = e.target;
      store.addCustomExercise({
        name: f.elements.name.value.trim(),
        muscle: f.elements.muscle.value,
        equipment: f.elements.equipment.value,
        type: f.elements.type.value,
        difficulty: f.elements.difficulty.value,
        instructions: f.elements.instructions.value.trim()
      });
      Fit.toast("Упражнение добавлено");
      ov.remove();
      Fit.renderTo();
    });
  }

  Fit.register("/routines", function (r) {
    if (r.parts[1] === "new") return renderRoutineEditor(null);
    if (r.parts[1] === "edit") return renderRoutineEditor(r.parts[2]);
    const routines = store.getRoutines();
    let html = '<div class="page"><div class="head-row"><h1 class="section">Тренировки</h1>' +
      '<button class="btn primary sm" onclick="Fit.navigate(\'#/routines/new\')">+ Создать</button></div>';
    if (!routines.length) {
      html += Fit.emptyState("Нет программ. Создайте свою или загрузите пресеты.");
    } else {
      html += '<div class="list">';
      routines.forEach((r) => {
        html +=
          '<div class="list-row routine-row"><div><b>' + esc(r.name) + "</b>" +
          "<span>" + r.exercises.length + " упражнений" + (r.preset ? " · пресет" : "") + "</span></div>" +
          '<div class="row-actions">' +
          '<button class="btn primary sm" onclick="Fit.navigate(\'#/session/' + r.id + "')\">Старт</button>" +
          (r.preset ? "" : '<button class="btn ghost sm" onclick="Fit.navigate(\'#/routines/edit/' + r.id + "')\">✎</button>") +
          (r.preset ? "" : '<button class="btn ghost sm" data-del="' + r.id + '">🗑</button>') +
          "</div></div>";
      });
      html += "</div>";
    }
    html += "</div>";
    Fit.bind(function () {
      Fit.qsa("[data-del]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (await Fit.confirmDialog("Удалить программу?")) {
            store.deleteRoutine(b.dataset.del);
            Fit.toast("Удалено");
            Fit.renderTo();
          }
        })
      );
    });
    return html;
  });

  let editorState = { name: "", items: [] };
  let editorKey = null;

  function editorShell() {
    let items = editorState.items
      .map((it, idx) => {
        const ex = store.getAllExercises().find((x) => x.id === it.exerciseId);
        return (
          '<div class="editor-item" data-idx="' + idx + '"><div class="ei-head"><b>' + esc(ex ? ex.name : it.exerciseId) + "</b>" +
          '<button class="btn ghost sm" data-remove="' + idx + '">✕</button></div>' +
          '<div class="ei-inputs">' +
          '<label>Подходы<input type="number" min="1" value="' + (it.sets || 3) + '" data-f="sets"></label>' +
          '<label>Повторы<input type="number" min="0" value="' + (it.reps != null ? it.reps : 10) + '" data-f="reps"></label>' +
          '<label>Отдых, с<input type="number" min="0" value="' + (it.rest || 60) + '" data-f="rest"></label>' +
          "</div></div>"
        );
      })
      .join("");
    if (!items) items = '<div class="empty">Добавьте упражнения</div>';
    return (
      '<div class="page"><div class="head-row"><h1 class="section">' + (editorState.editing ? "Редактировать" : "Новая программа") + "</h1>" +
      '<button class="btn primary sm" id="save-routine">Сохранить</button></div>' +
      '<div class="card"><label class="block">Название<input id="routine-name" value="' + esc(editorState.name) + '"></label>' +
      '<button class="btn ghost sm" id="add-ex">+ Добавить упражнение</button>' +
      '<div id="editor-items">' + items + "</div></div></div>"
    );
  }

  function renderRoutineEditor(id) {
    const key = id ? "edit:" + id : "new";
    if (editorKey !== key) {
      if (id) {
        const ex = store.getRoutine(id);
        editorState = ex
          ? {
              name: ex.name,
              items: ex.exercises.map((e) => ({ exerciseId: e.exerciseId, sets: e.sets, reps: e.reps, rest: e.rest, note: e.note })),
              editing: id
            }
          : { name: "", items: [], editing: null };
      } else {
        editorState = { name: "", items: [], editing: null };
      }
      editorKey = key;
    }
    Fit.bind(function () {
      bindEditor(editorState.editing);
    });
    return editorShell();
  }

  function bindEditor(editingId) {
    const itemsEl = Fit.qs("#editor-items");
    itemsEl.addEventListener("click", (e) => {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        editorState.items.splice(+rm.dataset.remove, 1);
        Fit.renderTo();
      }
    });
    itemsEl.addEventListener("input", (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      const idx = +e.target.closest(".editor-item").dataset.idx;
      editorState.items[idx][f] = +e.target.value;
    });
    Fit.qs("#add-ex").addEventListener("click", () => {
      openExercisePicker((exId) => {
        editorState.items.push({ exerciseId: exId, sets: 3, reps: 10, rest: 60 });
        Fit.renderTo();
      });
    });
    Fit.qs("#save-routine").addEventListener("click", () => {
      const name = Fit.qs("#routine-name").value.trim();
      if (!name) return Fit.toast("Введите название", "error");
      if (!editorState.items.length) return Fit.toast("Добавьте упражнения", "error");
      const data = {
        name,
        exercises: editorState.items.map((it) => ({
          exerciseId: it.exerciseId,
          sets: it.sets || 1,
          reps: it.reps || 0,
          rest: it.rest || 0
        }))
      };
      if (editingId) {
        const r = store.getRoutine(editingId);
        data.id = editingId;
        data.preset = false;
        store.updateRoutine(data);
        Fit.toast("Сохранено");
      } else {
        store.addRoutine(data);
        Fit.toast("Программа создана");
      }
      editorKey = null;
      Fit.navigate("#/routines");
    });
  }

  function openExercisePicker(onPick) {
    const all = store.getAllExercises();
    const ov = document.createElement("div");
    ov.className = "modal-overlay";
    ov.innerHTML =
      '<div class="modal wide"><h3>Выберите упражнение</h3>' +
      '<input id="pk-search" placeholder="Поиск..." style="margin-bottom:10px">' +
      '<div class="picker-list" id="pk-list"></div>' +
      '<div class="modal-actions"><button class="btn ghost" data-close>Готово</button></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      if (e.target === ov || e.target.hasAttribute("data-close")) ov.remove();
    });
    const list = Fit.qs("#pk-list", ov);
    function paint() {
      const q = Fit.qs("#pk-search", ov).value.toLowerCase();
      list.innerHTML = all
        .filter((x) => !q || x.name.toLowerCase().includes(q))
        .map(
          (x) =>
            '<div class="picker-row" data-id="' + x.id + '"><b>' + esc(x.name) + "</b><span class=\"muted\">" + esc(Fit.muscleLabel(x.muscle)) + "</span></div>"
        )
        .join("");
    }
    paint();
    Fit.qs("#pk-search", ov).addEventListener("input", paint);
    list.addEventListener("click", (e) => {
      const row = e.target.closest(".picker-row");
      if (!row) return;
      onPick(row.dataset.id);
      ov.remove();
    });
  }

  let sess = null;

  Fit.register("/session", function (r) {
    const id = r.parts[1];
    const routine = store.getRoutine(id);
    if (!routine) return '<div class="page"><div class="empty">Программа не найдена</div></div>';
    if (sess && sess.routineId !== id) sess = null;
    if (!sess) {
      sess = {
        routineId: id,
        start: Date.now(),
        elapsed: 0,
        timer: null,
        restTimer: null,
        exercises: routine.exercises.map((ex) => ({
          exerciseId: ex.exerciseId,
          sets: ex.sets,
          reps: ex.reps,
          rest: ex.rest || 0,
          note: ex.note || "",
          logs: Array.from({ length: ex.sets }, () => ({ reps: ex.reps || 0, weight: 0, done: false }))
        }))
      };
      sess.timer = setInterval(() => {
        if (!Fit.qs("#elapsed")) {
          clearInterval(sess.timer);
          return;
        }
        sess.elapsed = Math.floor((Date.now() - sess.start) / 1000);
        Fit.qs("#elapsed").textContent = Fit.fmtTime(sess.elapsed);
      }, 1000);
    }
    const r0 = routine;
    let html =
      '<div class="page session"><div class="card session-head"><div><b>' + esc(r0.name) + "</b></div>" +
      '<div class="timer">⏱ <span id="elapsed">' + Fit.fmtTime(sess.elapsed) + "</span></div></div>" +
      '<div class="rest-box" id="rest-box" style="display:none"><span id="rest-text"></span><button class="btn ghost sm" id="rest-skip">Пропустить</button></div>';

    sess.exercises.forEach((ex, ei) => {
      const def = store.getAllExercises().find((x) => x.id === ex.exerciseId);
      html += '<div class="card ex-block"><div class="ex-block-head"><b>' + esc(def ? def.name : ex.exerciseId) + "</b>" +
        '<span class="muted">' + ex.sets + " × " + (ex.reps || "—") + (ex.note ? " " + esc(ex.note) : "") + "</span></div>";
      for (let si = 0; si < ex.sets; si++) {
        const log = ex.logs[si];
        html +=
          '<div class="set-row' + (log.done ? " done" : "") + '" data-ei="' + ei + '" data-si="' + si + '">' +
          '<span class="set-n">' + (si + 1) + "</span>" +
          '<label>Повт.<input type="number" min="0" value="' + (log.reps || 0) + '" data-r></label>' +
          '<label>Вес<input type="number" min="0" value="' + (log.weight || 0) + '" data-w></label>' +
          '<button class="btn sm mark' + (log.done ? " primary" : " ghost") + '">✓</button></div>';
      }
      html += "</div>";
    });

    html += '<div class="session-foot"><button class="btn ghost" id="abort">Отмена</button>' +
      '<button class="btn primary" id="finish">Завершить тренировку</button></div></div>';
    Fit.bind(function () {
      Fit.qs("#abort").addEventListener("click", () => {
        clearInterval(sess.timer);
        if (sess.restTimer) clearInterval(sess.restTimer);
        sess = null;
        Fit.navigate("#/routines");
      });
      Fit.qsa(".set-row").forEach((row) => {
        const ei = +row.dataset.ei;
        const si = +row.dataset.si;
        row.addEventListener("input", (e) => {
          if (e.target.hasAttribute("data-r")) sess.exercises[ei].logs[si].reps = +e.target.value;
          if (e.target.hasAttribute("data-w")) sess.exercises[ei].logs[si].weight = +e.target.value;
        });
        row.querySelector(".mark").addEventListener("click", () => {
          const log = sess.exercises[ei].logs[si];
          log.done = !log.done;
          row.classList.toggle("done", log.done);
          row.querySelector(".mark").className = "btn sm mark " + (log.done ? "primary" : "ghost");
          const ex = sess.exercises[ei];
          if (log.done && ex.rest && si < ex.sets - 1) startRest(ex.rest);
        });
      });
      Fit.qs("#rest-skip").addEventListener("click", stopRest);
      Fit.qs("#finish").addEventListener("click", finishSession);
    });
    return html;
  });

  function startRest(sec) {
    if (sess.restTimer) clearInterval(sess.restTimer);
    let left = sec;
    const box = Fit.qs("#rest-box");
    const txt = Fit.qs("#rest-text");
    box.style.display = "flex";
    txt.textContent = "Отдых: " + left + " с";
    sess.restTimer = setInterval(() => {
      left--;
      if (left <= 0) {
        stopRest();
        Fit.toast("Отдых окончен!");
        return;
      }
      if (txt) txt.textContent = "Отдых: " + left + " с";
    }, 1000);
  }
  function stopRest() {
    if (sess && sess.restTimer) clearInterval(sess.restTimer);
    if (sess) sess.restTimer = null;
    const box = Fit.qs("#rest-box");
    if (box) box.style.display = "none";
  }

  function finishSession() {
    const duration = Math.floor((Date.now() - sess.start) / 1000);
    const data = {
      routineId: sess.routineId,
      date: new Date().toISOString(),
      duration,
      exercises: sess.exercises.map((ex) => ({
        exerciseId: ex.exerciseId,
        sets: ex.logs.map((l) => ({ reps: l.reps || 0, weight: l.weight || 0, done: l.done }))
      }))
    };
    store.addWorkout(data);
    clearInterval(sess.timer);
    if (sess.restTimer) clearInterval(sess.restTimer);
    const vol = Fit.workoutVolume(data);
    sess = null;
    Fit.toast("Тренировка сохранена! Объём: " + vol + " кг");
    Fit.navigate("#/");
  }

  Fit.register("/progress", function () {
    const ms = store.getMeasurements();
    const workouts = store.getWorkouts();
    const recs = {};
    workouts.forEach((w) =>
      w.exercises.forEach((ex) =>
        ex.sets.forEach((s) => {
          if (+s.weight > 0) recs[ex.exerciseId] = Math.max(recs[ex.exerciseId] || 0, +s.weight);
        })
      )
    );
    const recList = Object.keys(recs)
      .map((id) => ({ ex: store.getAllExercises().find((x) => x.id === id), w: recs[id] }))
      .filter((r) => r.ex)
      .sort((a, b) => b.w - a.w)
      .slice(0, 8);

    let html =
      '<div class="page"><h1 class="section">Прогресс</h1>' +
      '<div class="card"><h3>Вес тела</h3><canvas data-chart="weight" height="180"></canvas></div>' +
      '<div class="card"><h3>Тренировок по неделям</h3><canvas data-chart="weekly" height="180"></canvas></div>';

    html +=
      '<div class="card"><h3>Записать замер</h3><form id="ms-form" class="ms-form">' +
      '<label>Дата<input type="date" name="date" value="' + Fit.today() + '"></label>' +
      '<label>Вес, кг<input type="number" step="0.1" name="weight"></label>' +
      '<label>Грудь, см<input type="number" name="chest"></label>' +
      '<label>Талия, см<input type="number" name="waist"></label>' +
      '<label>Бёдра, см<input type="number" name="hips"></label>' +
      '<label>Рука, см<input type="number" name="arms"></label>' +
      '<label>Бедро, см<input type="number" name="thighs"></label>' +
      '<button class="btn primary" type="submit">Сохранить</button></form></div>';

    if (recList.length) {
      html += '<div class="card"><h3>Рекорды (по весу)</h3><div class="list">';
      recList.forEach((r) => {
        html += '<div class="list-row"><div><b>' + esc(r.ex.name) + "</b></div><div><b>" + r.w + " кг</b></div></div>";
      });
      html += "</div></div>";
    }

    if (ms.length) {
      html += '<div class="card"><h3>История замеров</h3><div class="table-wrap"><table class="tbl"><tr><th>Дата</th><th>Вес</th><th>Грудь</th><th>Талия</th><th>Бёдра</th><th>Рука</th><th>Бедро</th></tr>';
      ms.slice()
        .reverse()
        .forEach((m) => {
          html += "<tr><td>" + esc(m.date) + "</td><td>" + num(m.weight) + "</td><td>" + num(m.chest) + "</td><td>" + num(m.waist) + "</td><td>" + num(m.hips) + "</td><td>" + num(m.arms) + "</td><td>" + num(m.thighs) + "</td></tr>";
        });
      html += "</table></div></div>";
    }

    html += "</div>";
    Fit.bind(function () {
      Fit.qs("#ms-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target;
        const el = f.elements;
        const m = {
          date: el.date.value || Fit.today(),
          weight: el.weight.value ? +el.weight.value : null,
          chest: el.chest.value ? +el.chest.value : null,
          waist: el.waist.value ? +el.waist.value : null,
          hips: el.hips.value ? +el.hips.value : null,
          arms: el.arms.value ? +el.arms.value : null,
          thighs: el.thighs.value ? +el.thighs.value : null
        };
        store.addMeasurement(m);
        const p = store.getProfile();
        if (p && m.weight) {
          p.weight = m.weight;
          store.setProfile(p);
        }
        Fit.toast("Замер сохранён");
        Fit.renderTo();
      });
    });
    return html;
  });

  function num(v) {
    return v == null ? "—" : v;
  }

  Fit.register("/profile", function () {
    const p = store.getProfile() || {};
    const sexOpts = '<option value="male">Мужской</option><option value="female">Женский</option>';
    const goalOpts =
      '<option value="lose">Похудение</option><option value="maintain">Удержание</option><option value="gain">Набор массы</option>';
    const actOpts =
      '<option value="sedentary">Малоподвижный</option><option value="light">Лёгкая</option><option value="moderate">Средняя</option><option value="active">Высокая</option><option value="athlete">Спортсмен</option>';
    let html =
      '<div class="page"><h1 class="section">Профиль</h1>' +
      '<div class="card"><form id="profile-form">' +
      '<label>Имя<input name="name" value="' + esc(p.name || "") + '"></label>' +
      '<label>Пол<select name="sex">' + sexOpts + "</select></label>" +
      '<label>Возраст<input type="number" name="age" value="' + esc(p.age || "") + '"></label>' +
      '<label>Рост, см<input type="number" name="height" value="' + esc(p.height || "") + '"></label>' +
      '<label>Вес, кг<input type="number" step="0.1" name="weight" value="' + esc(p.weight || "") + '"></label>' +
      '<label>Цель<select name="goal">' + goalOpts + "</select></label>" +
      '<label>Активность<select name="activity">' + actOpts + "</select></label>" +
      '<label>Цель воды, мл<input type="number" name="waterGoal" value="' + esc(p.waterGoal || 2000) + '"></label>' +
      '<button class="btn primary" type="submit">Сохранить</button>' +
      "</form></div>";
    html +=
      '<div class="card"><h3>Бесплатно навсегда</h3>' +
      '<p class="muted">У конкурентов ИИ-сканер еды стоит 600–900 ₽ в месяц. ' +
      "Здесь он бесплатный и без лимита, потому что мы ничего не продаём и никуда не отправляем твои данные. " +
      'Приложение останется бесплатным и без рекламы. <a href="#/settings">Подключить бесплатный ключ ИИ →</a></p></div>';
    const m = Fit.calcMetrics(p);
    if (m) {
      html +=
        '<div class="card"><h3>Ваши показатели</h3><div class="stats">' +
        card("ИМТ", m.bmi, bmiNote(m.bmi)) +
        card("BMR", m.bmr, "ккал") +
        card("TDEE", m.tdee, "ккал") +
        card("Цель калорий", m.target, "ккал/день") +
        "</div></div>";
    }
    html += "</div>";
    Fit.bind(function () {
      fitSelect(p.sex, "sex");
      fitSelect(p.goal, "goal");
      fitSelect(p.activity, "activity");
      Fit.qs("#profile-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const f = e.target;
        const el = f.elements;
        const data = {
          name: el.name.value.trim(),
          sex: el.sex.value,
          age: +el.age.value,
          height: +el.height.value,
          weight: +el.weight.value,
          goal: el.goal.value,
          activity: el.activity.value,
          waterGoal: +el.waterGoal.value || 2000
        };
        store.setProfile(data);
        Fit.toast("Профиль сохранён");
        Fit.renderTo();
      });
      });
    return html;
  });

  function fitSelect(val, name) {
    if (!val) return;
    const el = Fit.qs('[name="' + name + '"]');
    if (el) el.value = val;
  }
  function bmiNote(b) {
    if (b < 18.5) return "Недостаток";
    if (b < 25) return "Норма";
    if (b < 30) return "Избыток";
    return "Ожирение";
  }

  Fit.register("/settings-base", function () {
    const theme = store.getTheme();
    let html =
      '<div class="page"><h1 class="section">Настройки</h1>' +
      '<div class="card"><h3>Тема</h3><div class="seg">' +
      '<button class="btn sm ' + (theme === "dark" ? "primary" : "ghost") + '" data-theme="dark">Тёмная</button>' +
      '<button class="btn sm ' + (theme === "light" ? "primary" : "ghost") + '" data-theme="light">Светлая</button>' +
      "</div></div>" +
      '<div class="card"><h3>Данные</h3>' +
      '<div class="row-actions">' +
      '<button class="btn ghost" id="export">Экспорт (JSON)</button>' +
      '<button class="btn ghost" id="import">Импорт</button>' +
      '<input type="file" id="import-file" accept="application/json" style="display:none">' +
      "</div>" +
      '<p class="muted">Все данные хранятся локально в вашем браузере.</p></div>' +
      '<div class="card danger-zone"><h3>Сброс</h3>' +
      '<button class="btn danger" id="reset">Удалить все данные</button></div>' +
      "</div>";
    Fit.bind(function () {
      Fit.qsa("[data-theme]").forEach((b) =>
        b.addEventListener("click", () => {
          store.setTheme(b.dataset.theme);
          Fit.applyTheme();
          Fit.renderTo();
        })
      );
      Fit.qs("#export").addEventListener("click", () => {
        const blob = new Blob([store.exportData()], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "fittrack-backup.json";
        a.click();
      });
      Fit.qs("#import").addEventListener("click", () => Fit.qs("#import-file").click());
      Fit.qs("#import-file").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            store.importData(reader.result);
            Fit.toast("Данные импортированы");
            Fit.renderTo();
          } catch (err) {
            Fit.toast("Ошибка файла", "error");
          }
        };
        reader.readAsText(file);
      });
      Fit.qs("#reset").addEventListener("click", async () => {
        if (await Fit.confirmDialog("Удалить ВСЕ данные безвозвратно?")) {
          store.reset();
          Fit.toast("Данные удалены");
          Fit.renderTo();
        }
      });
    });
    return html;
  });
})();
