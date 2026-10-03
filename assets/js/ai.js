/* FORMA — ИИ-модуль: анализ фото еды и генерация плана похудения.
   Бесплатные модели:
     - Google Gemini 2.0 Flash (free tier, принимает фото) — основной
     - Groq (Llama 3.2 Vision) — альтернатива
     - OpenRouter (бесплатные :free модели с vision) — альтернатива
     - Любой совместимый endpoint (OpenAI / Ollama / Cloudflare Worker)
   Без ключа работает офлайн-эвристика по фото и локальный планировщик. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  const PROMPT =
    "Ты — нутрициолог. На фото блюдо или напиток. Определи блюдо и его состав.\n" +
    "Ответь СТРОГО одним JSON-объектом без markdown и пояснений:\n" +
    '{"name":"Название блюда по-русски","kcal":0,"p":0,"f":0,"c":0,"portion":"150 г","items":[{"name":"Ингредиент","kcal":0,"p":0,"f":0,"c":0}],"confidence":0.0,"note":""}\n' +
    "kcal — ккал на порцию в поле portion, p — белки (г), f — жиры (г), c — углеводы (г).\n" +
    "confidence — от 0 до 1. note — короткое предупреждение, если блюдо неоднозначно.";

  function cfg() {
    return store.getAiConfig() || {};
  }
  function hasKey() {
    const c = cfg();
    return !!(c.key || c.endpoint);
  }

  function dataUrlToBase64(dataUrl) {
    const i = dataUrl.indexOf(",");
    return { meta: dataUrl.slice(0, i), b64: dataUrl.slice(i + 1) };
  }

  function cleanJson(txt) {
    if (!txt) return null;
    let t = String(txt).trim();
    const fence = t.indexOf("```");
    if (fence >= 0) {
      t = t.slice(fence);
      t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "");
    }
    const first = t.search(/[[{]/);
    const last = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
    if (first >= 0 && last > first) t = t.slice(first, last + 1);
    try {
      return JSON.parse(t);
    } catch (e) {
      return null;
    }
  }

  function num(v, d) {
    const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return isFinite(n) ? Math.round(n * 10) / 10 : d;
  }

  function normalize(o) {
    if (!o) return null;
    const out = {
      name: String(o.name || "Блюдо").slice(0, 60),
      kcal: num(o.kcal, 0),
      p: num(o.p ?? o.protein, 0),
      f: num(o.f ?? o.fat, 0),
      c: num(o.c ?? o.carbs, 0),
      portion: String(o.portion || "").slice(0, 40),
      confidence: num(o.confidence, 0.6),
      note: String(o.note || "").slice(0, 200),
      items: [],
      source: "ai"
    };
    if (Array.isArray(o.items)) {
      out.items = o.items.slice(0, 12).map((it) => ({
        name: String(it.name || "").slice(0, 50),
        kcal: num(it.kcal, 0),
        p: num(it.p ?? it.protein, 0),
        f: num(it.f ?? it.fat, 0),
        c: num(it.c ?? it.carbs, 0)
      }));
    }
    if (out.kcal <= 0) {
      const kp = (out.p * 4 + out.f * 9 + out.c * 4) | 0;
      if (kp > 0) out.kcal = kp;
    }
    return out;
  }

  /* ---------------- Транспорт ---------------- */

  async function callGemini(imageDataUrl, c) {
    const { b64 } = dataUrlToBase64(imageDataUrl);
    const model = c.model || "gemini-2.0-flash";
    const url =
      "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(c.key);
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: PROMPT }, { inline_data: { mime_type: "image/jpeg", data: b64 } }]
        }
      ],
      generationConfig: { temperature: 0.2, maxOutputTokens: 1200, responseMimeType: "application/json" }
    };
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error("Gemini " + r.status + " " + t.slice(0, 160));
    }
    const j = await r.json();
    const txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return cleanJson(txt);
  }

  async function callGroq(imageDataUrl, c) {
    const { b64 } = dataUrlToBase64(imageDataUrl);
    const model = c.model || "llama-3.2-11b-vision-preview";
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + c.key },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      })
    });
    if (!r.ok) throw new Error("Groq " + r.status + " " + (await r.text().catch(() => "")).slice(0, 160));
    const j = await r.json();
    return cleanJson(j?.choices?.[0]?.message?.content || "");
  }

  async function callOpenAICompatible(imageDataUrl, c) {
    const model = c.model || "gpt-4o-mini";
    const r = await fetch(c.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (c.key || "") },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: PROMPT },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      })
    });
    if (!r.ok) throw new Error("API " + r.status);
    const j = await r.json();
    return cleanJson(j?.choices?.[0]?.message?.content || j?.result || j);
  }

  /* ---------------- Офлайн-эвристика ---------------- */

  // Грубый анализ изображения: цветовые сегменты + яркость → тип блюда.
  function heuristicFromImage(canvas) {
    try {
      const ctx = canvas.getContext("2d");
      const w = canvas.width, h = canvas.height;
      const d = ctx.getImageData(0, 0, w, h).data;
      let green = 0, red = 0, yellow = 0, white = 0, brown = 0, total = 0;
      const step = 4 * 7; // примерно каждые 7 пикселей
      for (let i = 0; i < d.length; i += step) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        total++;
        if (r > 200 && g > 200 && b > 190) white++;
        else if (g > r + 18 && g > b + 18) green++;
        else if (r > g + 30 && r > b + 20) red++;
        else if (r > 150 && g > 120 && b < g - 30) yellow++;
        else if (r > 90 && g > 60 && b < 80) brown++;
      }
      const pct = (n) => n / Math.max(total, 1);
      const pGreen = pct(green), pRed = pct(red), pYellow = pct(yellow), pWhite = pct(white), pBrown = pct(brown);
      let guess = null;
      if (pGreen > 0.18) guess = { name: "Овощной салат", kcal: 95, p: 2.5, f: 5, c: 9, portion: "250 г" };
      else if (pRed > 0.2 && pBrown < 0.1) guess = { name: "Томатный салат / помидоры", kcal: 70, p: 1.5, f: 4, c: 8, portion: "200 г" };
      else if (pBrown > 0.22) guess = { name: "Мясное блюдо с гарниром", kcal: 340, p: 26, f: 16, c: 22, portion: "250 г" };
      else if (pYellow > 0.2) guess = { name: "Паста / картофель", kcal: 300, p: 10, f: 9, c: 42, portion: "220 г" };
      else if (pWhite > 0.4) guess = { name: "Молочное / десерт", kcal: 180, p: 6, f: 8, c: 20, portion: "200 г" };
      else guess = { name: "Смешанное блюдо", kcal: 250, p: 14, f: 10, c: 22, portion: "250 г" };
      guess.confidence = 0.3;
      guess.note = "Офлайн-оценка по цвету фото. Подключите ИИ-ключ для точного разбора.";
      guess.source = "offline";
      return guess;
    } catch (e) {
      return { name: "Блюдо", kcal: 250, p: 12, f: 9, c: 22, portion: "250 г", confidence: 0.2, source: "offline", note: "Не удалось разобрать фото." };
    }
  }

  function heuristicFromText(text) {
    const q = String(text || "").toLowerCase();
    for (const h of Fit.VISION_HINTS) {
      if (h.k.some((k) => q.includes(k))) {
        return Object.assign({}, h, { portion: (Fit.PORTION_HINTS[h.n] || 200) + " г", confidence: 0.55, source: "offline" });
      }
    }
    return null;
  }

  /* ---------------- Основной API ---------------- */

  // Анализ фото еды -> {name,kcal,p,f,c,items,confidence}
  async function analyzeImage(dataUrl, opts) {
    opts = opts || {};
    if (!hasKey()) {
      if (opts.canvas) return heuristicFromImage(opts.canvas);
      return { name: "Блюдо", kcal: 250, p: 12, f: 9, c: 22, portion: "250 г", confidence: 0.2, source: "offline", note: "ИИ не подключён." };
    }
    const c = cfg();
    let raw = null;
    try {
      if (c.provider === "groq") raw = await callGroq(dataUrl, c);
      else if (c.provider === "custom" || c.provider === "openai") raw = await callOpenAICompatible(dataUrl, c);
      else raw = await callGemini(dataUrl, c);
    } catch (e) {
      if (opts.onError) opts.onError(e);
      if (opts.canvas) return heuristicFromImage(opts.canvas);
      throw e;
    }
    const n = normalize(raw);
    if (!n) {
      if (opts.canvas) return heuristicFromImage(opts.canvas);
      throw new Error("ИИ вернул нечитаемый ответ");
    }
    store.recordAiUse();
        return n;
  }

  async function analyzeText(text, opts) {
    opts = opts || {};
    if (hasKey()) {
      const c = cfg();
      try {
        const prompt = PROMPT + "\n\nБлюдо называется: \"" + text + "\". Оцени типичную порцию.";
        let txt = "";
        if (c.provider === "groq") {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + c.key },
            body: JSON.stringify({
              model: c.model || "llama-3.2-11b-vision-preview",
              temperature: 0.2,
              messages: [{ role: "user", content: prompt }]
            })
          });
          const j = await r.json();
          txt = j?.choices?.[0]?.message?.content || "";
        } else if (c.provider === "custom" || c.provider === "openai") {
          const r = await fetch(c.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + (c.key || "") },
            body: JSON.stringify({
              model: c.model || "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }]
            })
          });
          const j = await r.json();
          txt = j?.choices?.[0]?.message?.content || j?.result || "";
        } else {
          const model = c.model || "gemini-2.0-flash";
          const r = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(c.key),
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }] }) }
          );
          const j = await r.json();
          txt = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        }
        const n = normalize(cleanJson(txt));
        if (n) return n;
      } catch (e) {
        if (opts.onError) opts.onError(e);
      }
    }
    return heuristicFromText(text) || { name: text || "Блюдо", kcal: 250, p: 12, f: 9, c: 22, portion: "250 г", confidence: 0.2, source: "offline" };
  }

  /* ---------------- План похудения ---------------- */

  const PLAN_PROMPT =
    "Ты — диетолог и тренер. Составь ПРАКТИЧНЫЙ план похудения на русском.\n" +
    "Верни СТРОГО один JSON без markdown:\n" +
    '{"summary":"1-2 предложения","days":7,"daily":[{"day":1,"kcal":0,"p":0,"f":0,"c":0,"water":0,"workout":"Название тренировки","breakfast":"","lunch":"","dinner":"","snack":"","tip":""}],"tips":["..."]}\n' +
    "kcal — дневная норма; p — белки г; f — жиры г; c — углеводы г. Учитывай цель похудения, безопасный дефицит 300-500 ккал.";

  function localPlan(p) {
    const m = Fit.calcMetrics(p) || { target: 1800, bmr: 1500, tdee: 2000 };
    const goalW = p.targetWeight || Math.round((p.weight - 8) * 10) / 10;
    const perDay = p.weeklyRate ? p.weeklyRate : 0.5;
    const weeks = Math.max(1, Math.ceil((p.weight - goalW) / (perDay * 7)) || 1);
    const days = 7;
    const foods = Fit.FOODS;
    const pick = (ids) => ids.map((i) => foods.find((f) => f.id === i)).filter(Boolean);
    const b = pick(["oats", "banana", "egg", "pb"]);
    const l = pick(["chicken", "rice", "broccoli", "carrot"]);
    const d = pick(["salmon", "potato", "broccoli", "avocado"]);
    const s = pick(["yogurt", "almond", "apple"]);
    const sum = (arr) =>
      arr.reduce(
        (a, f) => ({ kcal: a.kcal + f.kcal, p: a.p + f.p, f: a.f + f.f, c: a.c + f.c }),
        { kcal: 0, p: 0, f: 0, c: 0 }
      );
    const rot = [0, 1, 2, 3, 0, 1, 2];
    const daily = [];
    for (let i = 0; i < days; i++) {
      const bf = sum(b.slice(0, (i % 3) + 2));
      const lu = sum(l);
      const di = sum(d);
      const sn = sum(s);
      const total = sum([bf, lu, di, sn]);
      const scale = m.target / Math.max(total.kcal, 1);
      daily.push({
        day: i + 1,
        kcal: Math.round(m.target),
        p: Math.round(total.p * scale),
        f: Math.round(total.f * scale),
        c: Math.round(total.c * scale),
        water: p.waterGoal || 2000,
        workout: ["Силовая: низ + пресс", "Кардио: ходьба 40 мин", "Верх + кор", "Йога + растяжка", "Любимая тренировка", "Прогулка 60 мин", "Отдых / лёгкая растяжка"][i % 7],
        breakfast: b.slice(0, (i % 3) + 2).map((f) => f.name).join(", "),
        lunch: l.map((f) => f.name).join(", "),
        dinner: d.map((f) => f.name).join(", "),
        snack: s.map((f) => f.name).join(", "),
        tip: [
          "Пей воду за 30 мин до еды — хуже аппетит.",
          "Не пропускай завтрак: стабильность важнее.",
          "Сон 7+ часов ускоряет жиросжигание.",
          "Считай БЖУ, а не только калории.",
          "Готовь заранее — снимает срывы.",
          "10 минут прогулки после еды снижает сахар.",
          "Планируй перекус, чтобы не срываться."
        ][i % 7]
      });
    }
    return {
      generated: Date.now(),
      source: "local",
      targetWeight: goalW,
      weeks,
      daily,
      summary:
        "Цель: " + goalW + " кг за ~" + weeks + " нед. Дефицит ~" + Math.max(0, m.tdee - m.target) +
        " ккал/день. Держи белок " + daily[0].p + " г и пей " + (p.waterGoal || 2000) + " мл воды.",
      tips: [
        "Дефицит 300–500 ккал даёт результат без срывов.",
        "Белок помогает сохранить мышцы на похудении.",
        "Взвешивайся утром натощак 3–4 раза в неделю.",
        "Сон и стресс влияют на аппетит сильнее, чем кажется.",
        "Любимую еду не выбрасывай — уменьши порцию."
      ]
    };
  }

  async function makePlan(p) {
    if (!p) return null;
    const c = cfg();
    if (hasKey()) {
      try {
        const ctx =
          "Профиль: " + p.sex + ", " + p.age + " лет, рост " + p.height + " см, вес " + p.weight +
          " кг, активность " + p.activity + ", цель " + p.goal + ", целевой вес " + (p.targetWeight || "-") +
          ". Расчёт: TDEE " + (Fit.calcMetrics(p)?.tdee || "?") + " ккал.";
        const txt = PLAN_PROMPT + "\n\n" + ctx;
        let out = "";
        if (c.provider === "groq") {
          const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + c.key },
            body: JSON.stringify({ model: c.model || "llama-3.2-11b-vision-preview", temperature: 0.4, messages: [{ role: "user", content: txt }] })
          });
          const j = await r.json();
          out = j?.choices?.[0]?.message?.content || "";
        } else if (c.provider === "custom" || c.provider === "openai") {
          const r = await fetch(c.endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + (c.key || "") },
            body: JSON.stringify({ model: c.model || "gpt-4o-mini", messages: [{ role: "user", content: txt }] })
          });
          const j = await r.json();
          out = j?.choices?.[0]?.message?.content || j?.result || "";
        } else {
          const model = c.model || "gemini-2.0-flash";
          const r = await fetch(
            "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(c.key),
            { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: txt }] }] }) }
          );
          const j = await r.json();
          out = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
        }
        const parsed = cleanJson(out);
        if (parsed && Array.isArray(parsed.daily) && parsed.daily.length) {
          const plan = {
            generated: Date.now(),
            source: "ai",
            summary: String(parsed.summary || "Ваш персональный план."),
            tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 6).map(String) : [],
            targetWeight: p.targetWeight || null,
            daily: parsed.daily.slice(0, 7).map((d, i) => ({
              day: i + 1,
              kcal: num(d.kcal, 0),
              p: num(d.p, 0),
              f: num(d.f, 0),
              c: num(d.c, 0),
              water: num(d.water, 2000),
              workout: String(d.workout || "Лёгкая тренировка"),
              breakfast: String(d.breakfast || ""),
              lunch: String(d.lunch || ""),
              dinner: String(d.dinner || ""),
              snack: String(d.snack || ""),
              tip: String(d.tip || "")
            }))
          };
          return normalizePlan(plan);
        }
      } catch (e) {
        if (arguments[1]) arguments[1](e);
      }
    }
    return normalizePlan(localPlan(p));
  }

  // Приводит любой план (от ИИ или локального генератора) к единой схеме,
  // которую ожидает экран плана: days[] + meals[] + targetKcal/protein/fat/carb.
  const MEAL_ICONS = { breakfast: "🌅", lunch: "🍽️", dinner: "🌙", snack: "🍎" };
  const MEAL_NAMES = { breakfast: "Завтрак", lunch: "Обед", dinner: "Ужин", snack: "Перекус" };
  // Доля калорий каждого приёма пищи в сутках
  const MEAL_SHARE = { breakfast: 0.27, lunch: 0.35, dinner: 0.28, snack: 0.1 };

  function normalizePlan(plan) {
    if (!plan) return null;
    if (Array.isArray(plan.days) && plan.days.length) return plan; // уже в нужной схеме

    const daily = (plan.daily || []).slice(0, 7);
    if (!daily.length) return null;
    const d0 = daily[0] || {};
    const days = daily.map((d) => {
      const meals = ["breakfast", "lunch", "dinner", "snack"]
        .filter((k) => d[k])
        .map((k) => ({
          key: k,
          icon: MEAL_ICONS[k],
          name: MEAL_NAMES[k],
          items: String(d[k]).split(/,\s*/).filter(Boolean),
          kcal: Math.round((d.kcal || 0) * MEAL_SHARE[k])
        }));
      return {
        title: "День " + (d.day || 1),
        kcal: Math.round(d.kcal || 0),
        p: Math.round(d.p || 0),
        f: Math.round(d.f || 0),
        c: Math.round(d.c || 0),
        water: d.water || 2000,
        tip: d.tip || "",
        workout: d.workout || "",
        meals
      };
    });
    return Object.assign({}, plan, {
      days,
      targetKcal: Math.round(d0.kcal || 0),
      protein: Math.round(d0.p || 0),
      fat: Math.round(d0.f || 0),
      carb: Math.round(d0.c || 0)
    });
  }

  // Текстовый чат с ИИ-коучем по похудению
  async function chat(message, history) {
    const c = cfg();
    if (!hasKey()) {
      return {
        text:
          "Я работаю в офлайн-режиме. Подключите бесплатный ключ Gemini в настройках — и я отвечу на любой вопрос по питанию и тренировкам. Пока вот базовый совет: " +
          Fit.chatFallback(message),
        offline: true
      };
    }
    const sys =
      "Ты — дружелюбный фитнес-коуч FORMA. Отвечай кратко (до 120 слов) на русском, по делу, без воды. " +
      "Учитывай, что пользователь хочет похудеть. Если данных не хватает — задай 1 уточняющий вопрос. Не выдумывай цифры как факты.";
    const msgs = [{ role: "system", content: sys }].concat((history || []).slice(-8)).concat([{ role: "user", content: message }]);
    let out = "";
    if (c.provider === "groq") {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + c.key },
        body: JSON.stringify({ model: c.model || "llama-3.2-11b-vision-preview", temperature: 0.5, messages: msgs })
      });
      out = (await r.json())?.choices?.[0]?.message?.content || "";
    } else if (c.provider === "custom" || c.provider === "openai") {
      const r = await fetch(c.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (c.key || "") },
        body: JSON.stringify({ model: c.model || "gpt-4o-mini", messages: msgs })
      });
      out = (await r.json())?.choices?.[0]?.message?.content || "";
    } else {
      const model = c.model || "gemini-2.0-flash";
      const r = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(c.key),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            contents: (history || []).concat([{ role: "user", parts: [{ text: message }] }])
          })
        }
      );
      const j = await r.json();
      out = j?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    }
    return { text: out || "Не удалось получить ответ. Попробуйте ещё раз.", offline: false };
  }

  Fit.ai = {
    analyzeImage,
    analyzeText,
    makePlan,
    chat,
    hasKey,
    localPlan,
    cleanJson,
    PROMPT
  };

  // Простые офлайн-ответы коуча
  Fit.chatFallback = function (message) {
    const q = String(message || "").toLowerCase();
    if (/скул|кал|углевод/.test(q)) return "Белок 1.6–2 г на кг массы, углеводы — остаток калорий, жиры 25–30% рациона. Сначала посчитайте белок.";
    if (/сколько|калори|ккал/.test(q)) return "Базовый обмен (Mifflin): мужчины 10×вес + 6.25×рост − 5×возраст + 5. Дальше умножьте на коэффициент активности 1.2–1.9.";
    if (/похуд|план|диет/.test(q)) return "Откройте «План» — ИИ составит меню и тренировки на неделю под ваши цифры и цель по весу.";
    if (/скан|фото|распозн/.test(q)) return "В разделе «Питание» нажмите «Скан» — сфотографируйте блюдо, ИИ посчитает калории, белки, жиры и углеводы.";
    if (/вод/.test(q)) return "Пейте 30–40 мл воды на кг веса. Стакан за 30 минут до еды снижает аппетит.";
    if (/трен|упражн|заряд/.test(q)) return "3 силовых и 2 кардио в неделю + 8000 шагов в день — минимум для жиросжигания.";
    return "Уточните вопрос: например «сколько белка мне нужно» или «составь план на неделю».";
  };
})();
