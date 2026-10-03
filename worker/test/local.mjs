/* Тест Worker'а без деплоя и без wrangler.
   Поднимает реальный обработчик `src/index.js` поверх настоящей SQLite
   (node:sqlite), которая повторяет интерфейс Cloudflare D1:
     prepare(sql) → { bind(...).all() / .first() / .run() }
   Так проверяется именно SQL из schema.sql — не заглушка.
   Запуск: node test/local.mjs
*/

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import worker from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/* ---------- Адаптер D1 → node:sqlite ---------- */
function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(join(root, "schema.sql"), "utf8"));

  const plain = (s) => Object.assign({}, s);
  const prep = (sql) => {
    let st;
    try {
      st = db.prepare(sql);
    } catch (e) {
      throw new Error("SQL prepare failed: " + e.message + "\n  " + sql);
    }
    return {
      bind: (...args) => ({
        all: async () => {
          try {
            return { results: st.all(...args).map(plain), success: true };
          } catch (e) {
            throw new Error("SQL all failed: " + e.message + "\n  " + sql);
          }
        },
        first: async () => {
          try {
            const r = st.get(...args);
            return r ? plain(r) : null;
          } catch (e) {
            throw new Error("SQL first failed: " + e.message + "\n  " + sql);
          }
        },
        run: async () => {
          try {
            const r = st.run(...args);
            return { success: true, meta: r };
          } catch (e) {
            throw new Error("SQL run failed: " + e.message + "\n  " + sql);
          }
        }
      }),
      all: async () => ({ results: st.all().map(plain), success: true }),
      first: async () => {
        const r = st.get();
        return r ? plain(r) : null;
      },
      run: async () => ({ success: true, meta: st.run() })
    };
  };
  return { prepare: prep, exec: (s) => db.exec(s), _raw: db };
}

const env = { DB: makeD1() };

/* ---------- Мини-фреймворк ---------- */
let pass = 0,
  fail = 0;
const failures = [];
const only = process.argv[2] || "";

async function t(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  try {
    await fn();
    pass++;
    console.log("  ✓ " + name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e });
    console.log("  ✗ " + name + "\n      " + e.message);
  }
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual),
    b = JSON.stringify(expected);
  if (a !== b) throw new Error((msg || "") + "\n      ожидалось: " + b + "\n      получено:  " + a);
}
function ok(v, msg) {
  if (!v) throw new Error(msg || "ожидалось истинное значение, получено " + v);
}

let me = "@tester";
async function call(method, path, body, user) {
  const req = new Request("https://forma.example" + path, {
    method,
    headers: { "content-type": "application/json", "x-user-id": user || me },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const res = await worker.fetch(req, env);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* пустое тело */
  }
  return { status: res.status, data, headers: res.headers };
}

console.log("\nFORMA Worker — тесты на реальной SQLite\n");

/* ============================ Здоровье и CORS ============================ */

await t("GET /api/health отвечает ok:true", async () => {
  const r = await call("GET", "/api/health");
  eq(r.status, 200);
  eq(r.data.ok, true);
  eq(r.data.app, "FORMA");
  ok(Array.isArray(r.data.endpoints) && r.data.endpoints.length >= 10, "нужен список эндпоинтов");
});

await t("OPTIONS отдаёт CORS-заголовки (preflight)", async () => {
  const res = await worker.fetch(new Request("https://forma.example/api/feed", { method: "OPTIONS", headers: { origin: "https://forma.pages.dev" } }), env);
  eq(res.status, 204);
  eq(res.headers.get("access-control-allow-methods").includes("POST"), true);
  ok(res.headers.get("access-control-allow-headers").includes("x-user-id"), "нужен x-user-id в allow-headers");
});

await t("Неизвестный маршрут → 404, а не 500", async () => {
  const r = await call("GET", "/api/nope");
  eq(r.status, 404);
  ok(typeof r.data.error === "string" && r.data.error.length > 0, "нужен текст ошибки");
});

/* ============================ Пользователи ============================ */

await t("POST /api/users/:handle создаёт пользователя из хэндла", async () => {
  const r = await call("POST", "/api/users/@masha_fit", { name: "Маша", avatar: "🔥", bio: "верится в дефицит", grad: "g1" });
  eq(r.status, 200);
  eq(r.data.handle, "@masha_fit");
});

await t("Имя выводится из хэндла, если не задано (ensureUser)", async () => {
  await call("POST", "/api/posts", { text: "привет" }, "@kirill_lift");
  const r = await call("GET", "/api/users/@kirill_lift");
  eq(r.status, 200);
  eq(r.data.user.name, "Kirill Lift");
  eq(r.data.user.avatar, "🙂");
});

/* Клиент кладёт ник в заголовок x-user-id. Значение HTTP-заголовка обязано
   быть ASCII, поэтому кириллица приходит percent-encoded: если забыть
   распаковать — пользователь с русским ником (@я) получит чужой профиль. */
await t("Кириллический ник в x-user-id распаковывается (percent-encoding)", async () => {
  const r = await call("POST", "/api/posts", { text: "кириллический автор" }, encodeURIComponent("@я"));
  eq(r.status, 201);
  const u = await call("GET", "/api/users/" + encodeURIComponent("@я"));
  eq(u.status, 200, "закодированный ник не нашёлся");
  eq(u.data.user.handle, "@я");
  eq(u.data.stats.posts, 1, "пост записался не тому пользователю");
});

await t("Битая percent-последовательность не роняет Worker", async () => {
  const r = await call("GET", "/api/users/%E0%A4%A", undefined, "@broken");
  eq(r.status, 404, "битый ник должен просто не найтись");
});

await t("Профиль сохраняет вес и цель (upsert, а не insert)", async () => {
  await call("POST", "/api/users/@anna_meal", { name: "Анна", weight: 58.4, height: 166, age: 29, goalWeight: 52 });
  const r = await call("POST", "/api/users/@anna_meal", { weight: 57.1, goalWeight: 52 });
  eq(r.status, 200);
  const g = await call("GET", "/api/users/@anna_meal");
  eq(g.data.profile.weight, 57.1, "вес обновился");
  eq(g.data.profile.height, 166, "рост не потерялся при upsert");
  eq(g.data.profile.goalWeight ?? g.data.profile.goal_weight, 52);
});

await t("GET несуществующего пользователя → 404", async () => {
  const r = await call("GET", "/api/users/@nobody_here");
  eq(r.status, 404);
});

/* ============================ Посты ============================ */

let postId = null;

await t("POST /api/posts создаёт пост с тегами", async () => {
  const r = await call("POST", "/api/posts", { text: "Минус 13,3 кг за 214 дней. Дефицит и шаги.", tags: ["похудение", "результат"] });
  eq(r.status, 201);
  ok(r.data.id, "нужен id");
  postId = r.data.id;
});

await t("Пустой текст поста отклоняется (422)", async () => {
  const r = await call("POST", "/api/posts", { text: "   " });
  eq(r.status, 422);
});

await t("GET /api/feed возвращает пост с распарсенными тегами", async () => {
  const r = await call("GET", "/api/feed");
  eq(r.status, 200);
  ok(r.data.posts.length >= 1, "постов нет");
  const p = r.data.posts.find((x) => x.id === postId);
  ok(p, "созданный пост не найден в ленте");
  eq(p.tags, ["похудение", "результат"]);
  eq(p.text, "Минус 13,3 кг за 214 дней. Дефицит и шаги.");
  ok(p.ts > 0, "нет ts");
  ok(typeof p.likeCount === "number", "нет likeCount");
});

await t("Фильтр по тегу /api/feed?tag= работает", async () => {
  const r = await call("GET", "/api/feed?tag=похудение");
  eq(r.status, 200);
  ok(r.data.posts.length >= 1, "фильтр ничего не нашёл");
  ok(r.data.posts.every((p) => p.tags.some((t) => t.toLowerCase() === "похудение")), "протекла лишняя запись");
});

await t("Пагинация: ?limit=1 отдаёт ровно один пост и курсор next", async () => {
  await call("POST", "/api/posts", { text: "второй пост" }, "@dima_run");
  const r = await call("GET", "/api/feed?limit=1");
  eq(r.data.posts.length, 1);
  ok(r.data.next, "нет курсора next");
  const r2 = await call("GET", "/api/feed?limit=1&before=" + r.data.next);
  ok(r2.data.posts.length === 1, "вторая страница не вернулась");
  ok(r2.data.posts[0].id !== r.data.posts[0].id, "вторая страница повторила первый пост");
});

await t("Лента отсортирована от новых к старым", async () => {
  const r = await call("GET", "/api/feed");
  for (let i = 1; i < r.data.posts.length; i++) {
    ok(r.data.posts[i - 1].ts >= r.data.posts[i].ts, "порядок нарушен на позиции " + i);
  }
});

/* ============================ Лайки ============================ */

await t("Лайк ставится, счётчик растёт", async () => {
  const r = await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(r.status, 200);
  eq(r.data.liked, true);
  eq(r.data.likes, 1);
});

await t("Повторный лайк того же человека снимает его (toggle)", async () => {
  const r = await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(r.data.liked, false);
  eq(r.data.likes, 0);
  const r2 = await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(r2.data.liked, true, "должен снова поставить лайк");
  eq(r2.data.likes, 1);
});

await t("Двойной лайк невозможен: чётное число нажатий = лайка нет", async () => {
  // Каждое нажатие переключает состояние, поэтому чётное число нажатий
  // сохраняет исходное состояние, а нечётное — меняет его. Проверяем инвариант.
  // Счётчик лежит в likeCount: поле likes — массив хэндлов (формат приложения).
  const count = async () => (await call("GET", "/api/feed/" + postId)).data.post.likeCount;

  // нормализуем исходное состояние — не полагаемся на порядок тестов
  if ((await count()) !== 0) await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(await count(), 0, "не удалось привести к состоянию без лайка");

  for (let i = 0; i < 4; i++) await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(await count(), 0, "4 нажатия (чётное) должны вернуть исходное состояние");

  await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(await count(), 1, "5 нажатий (нечётное) должны поставить ровно один лайк");

  await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  eq(await count(), 0, "6 нажатий (чётное) снова должны снять");
});

await t("likeCount в ленте отражает число реальных лайков", async () => {
  // приводим к ровно одному лайку, затем сверяем ленту с детальной выдачей
  if ((await call("GET", "/api/feed/" + postId)).data.post.likeCount !== 1) {
    await call("POST", "/api/posts/" + postId + "/like", {}, "@anna_meal");
  }
  const list = (await call("GET", "/api/feed")).data.posts.find((x) => x.id === postId);
  eq(list.likeCount, 1, "лайк есть в детальной выдаче, но не виден в ленте");
  eq(list.likes, [], "поле likes в ленте должно быть пустым массивом, а не числом");
});

/* ============================ Комментарии ============================ */

await t("Комментарий добавляется и возвращается с хэндлом", async () => {
  const r = await call("POST", "/api/posts/" + postId + "/comments", { text: "Повторяю! Особенно про шаги." }, "@olya_water");
  eq(r.status, 201);
  eq(r.data.comment.handle, "@olya_water");
  eq(r.data.comment.text, "Повторяю! Особенно про шаги.");
});

await t("Пустой комментарий отклоняется (422)", async () => {
  const r = await call("POST", "/api/posts/" + postId + "/comments", { text: "" });
  eq(r.status, 422);
});

await t("GET /api/feed/:id отдаёт пост с комментариями по порядку", async () => {
  await call("POST", "/api/posts/" + postId + "/comments", { text: "второй" }, "@kirill_lift");
  const r = await call("GET", "/api/feed/" + postId);
  eq(r.status, 200);
  eq(r.data.post.comments.length, 2);
  eq(r.data.post.comments[0].text, "Повторяю! Особенно про шаги.");
  ok(r.data.post.comments[0].ts <= r.data.post.comments[1].ts, "комментарии не по возрастанию");
});

await t("GET несуществующего поста → 404", async () => {
  const r = await call("GET", "/api/feed/po_missing");
  eq(r.status, 404);
});

await t("commentCount в ленте считает комментарии", async () => {
  const r = await call("GET", "/api/feed");
  const p = r.data.posts.find((x) => x.id === postId);
  eq(p.commentCount, 2);
});

/* ============================ Сторис ============================ */

let storyId = null;

await t("POST /api/stories создаёт сторис с TTL 24 часа", async () => {
  const r = await call("POST", "/api/stories", {
    author: "@masha_fit",
    type: "result",
    from: 84.5,
    to: 71.2,
    days: 214,
    text: "214 дней. Минус 13,3 кг.",
    grad: "g1"
  });
  eq(r.status, 201);
  ok(r.data.id, "нет id");
  const ttl = r.data.expiresAt - Date.now();
  ok(ttl > 23.5 * 3600 * 1000 && ttl <= 24 * 3600 * 1000 + 5000, "TTL не 24 часа: " + ttl);
  storyId = r.data.id;
});

await t("Сторис-блюдо сохраняет БЖУ (kcal/p/f/c)", async () => {
  const r = await call("POST", "/api/stories", { author: "@anna_meal", type: "meal", title: "Мой завтрак", kcal: 420, p: 28, f: 14, c: 48 }, "@anna_meal");
  const g = await call("GET", "/api/stories");
  const s = g.data.stories.find((x) => x.id === r.data.id);
  ok(s, "сторис не найден в списке");
  eq(s.type, "meal");
  eq(s.title, "Мой завтрак");
  eq(s.kcal, 420);
  eq(s.p, 28, "белки не сохранились");
  eq(s.f, 14, "жиры не сохранились");
  eq(s.c, 48, "углеводы не сохранились");
});

await t("Неизвестный type сторис сводится к result", async () => {
  const r = await call("POST", "/api/stories", { type: "видео", text: "x" }, "@max_bro");
  const g = await call("GET", "/api/stories");
  const s = g.data.stories.find((x) => x.id === r.data.id);
  eq(s.type, "result");
});

await t("GET /api/stories отдаёт живые сторис (протухшие вычищены)", async () => {
  // кладём протухшую запись напрямую в БД
  const db = env.DB._raw;
  db.prepare("INSERT OR IGNORE INTO users (id,handle,name,avatar,bio,grad,created_at) VALUES ('u_exp','@expired','Expired','🙂','','g1',0)").run();
  db.prepare("INSERT INTO stories (id,user_id,type,from_weight,to_weight,days,count,title,kcal,protein,fat,carbs,text,grad,created_at,expires_at) VALUES ('st_expired','u_exp','result',90,80,30,NULL,NULL,NULL,NULL,NULL,NULL,'старое','g1',1,2)").run();
  const r = await call("GET", "/api/stories");
  eq(r.status, 200);
  ok(r.data.stories.every((s) => s.expires >= Date.now() - 1000), "протухшая сторис попала в выдачу");
  ok(!r.data.stories.some((s) => s.id === "st_expired"), "протухшая сторис не вычищена");
  const n = db.prepare("SELECT COUNT(*) AS c FROM stories WHERE id='st_expired'").get();
  eq(n.c, 0, "протухшая запись осталась в таблице");
});

await t("Отметка «просмотрено» запоминается для конкретного пользователя", async () => {
  eq((await call("POST", "/api/stories/" + storyId + "/seen", {}, "@tester")).data.ok, true);
  const asTester = await call("GET", "/api/stories", undefined, "@tester");
  const asOther = await call("GET", "/api/stories", undefined, "@anna_meal");
  eq(asTester.data.stories.find((s) => s.id === storyId).seen, true, "у автора не отмечено");
  eq(asOther.data.stories.find((s) => s.id === storyId).seen, false, "у другого отмечено");
});

/* ============================ Лидерборд ============================ */

await t("GET /api/leaderboard сортирует по потере веса", async () => {
  const r = await call("GET", "/api/leaderboard");
  eq(r.status, 200);
  const l = r.data.leaderboard;
  ok(l.length >= 2, "слишком мало строк");
  for (let i = 1; i < l.length; i++) ok(l[i - 1].kg >= l[i].kg, "лидерборд не отсортирован");
  eq(l[0].handle, "@masha_fit", "первым должен быть @masha_fit (−13,3 кг)");
  eq(l[0].kg, 13.3);
  eq(l[0].place, 1);
});

await t("Пользователь без result-сторис попадает в таблицу с 0", async () => {
  await call("POST", "/api/posts", { text: "я тут" }, "@zero_kg");
  const r = await call("GET", "/api/leaderboard");
  ok(r.data.leaderboard.some((x) => x.handle === "@zero_kg" && x.kg === 0), "нет строки с нулём");
});

/* ============================ Подписки ============================ */

await t("POST /api/follow переключает подписку", async () => {
  const r1 = await call("POST", "/api/follow", { from: "@tester", to: "@masha_fit" });
  eq(r1.data.following, true);
  const r2 = await call("POST", "/api/follow", { from: "@tester", to: "@masha_fit" });
  eq(r2.data.following, false, "повторный вызов должен отписать");
  await call("POST", "/api/follow", { from: "@tester", to: "@masha_fit" });
});

await t("Подписаться на себя нельзя (422)", async () => {
  const r = await call("POST", "/api/follow", { from: "@tester", to: "@tester" });
  eq(r.status, 422);
});

await t("Статистика профиля считает посты, подписчиков и followsMe", async () => {
  await call("POST", "/api/posts", { text: "мой пост в профиль" }, "@masha_fit");
  const r = await call("GET", "/api/users/@masha_fit", undefined, "@tester");
  eq(r.status, 200);
  eq(r.data.stats.followsMe, true, "подписка не отражена");
  eq(r.data.stats.posts, 1, "посты не посчитаны");
  const other = await call("GET", "/api/users/@masha_fit", undefined, "@olya_water");
  eq(other.data.stats.followsMe, false, "чужой видит подписку неверно");
});

/* ============================ Синхронизация ============================ */

await t("GET /api/sync отдаёт одним куском: me + stories + posts + leaderboard", async () => {
  const r = await call("GET", "/api/sync");
  eq(r.status, 200);
  eq(r.data.me.handle, "@tester");
  ok(Array.isArray(r.data.stories) && r.data.stories.length >= 2, "сторис нет в sync");
  ok(Array.isArray(r.data.posts) && r.data.posts.length >= 1, "постов нет в sync");
  ok(Array.isArray(r.data.leaderboard) && r.data.leaderboard.length >= 1, "лидерборда нет в sync");
  ok("profile" in r.data, "нет ключа profile даже когда профиля нет");
});

await t("Форма сторис из Worker совпадает с форматом приложения (поля store.addStory)", async () => {
  const r = await call("GET", "/api/stories");
  const s = r.data.stories[0];
  for (const k of ["id", "user", "avatar", "type", "grad", "ts", "expires"]) {
    ok(k in s, "в сторис нет поля " + k);
  }
  ok("text" in s && "title" in s, "нет text/title");
});

/* ============================ Устойчивость ============================ */

await t("Битый JSON в теле не роняет Worker", async () => {
  const req = new Request("https://forma.example/api/posts", {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": "@tester" },
    body: "{это не json"
  });
  const res = await worker.fetch(req, env);
  eq(res.status, 422, "битый JSON должен дать 422, а не исключение");
});

await t("Очень длинный текст обрезается, а не падает", async () => {
  const r = await call("POST", "/api/posts", { text: "я".repeat(9000) });
  eq(r.status, 201);
  const g = await call("GET", "/api/feed/" + r.data.id);
  ok(g.data.post.text.length <= 4000, "текст не обрезан: " + g.data.post.text.length);
});

await t("Теги режутся до 6 штук", async () => {
  const r = await call("POST", "/api/posts", { text: "много тегов", tags: ["a", "b", "c", "d", "e", "f", "g", "h"] });
  const g = await call("GET", "/api/feed/" + r.data.id);
  eq(g.data.post.tags.length, 6);
});

await t("Некорректный tags (строка вместо массива) не ломает ответ", async () => {
  const r = await call("POST", "/api/posts", { text: "строка вместо массива", tags: "не массив" });
  eq(r.status, 201);
  const g = await call("GET", "/api/feed/" + r.data.id);
  eq(g.data.post.tags, []);
});

await t("Некорректные веса в сторис сохраняются как null, а не как NaN", async () => {
  const r = await call("POST", "/api/stories", { type: "result", from: "много", to: "" }, "@max_bro");
  const g = await call("GET", "/api/stories");
  const s = g.data.stories.find((x) => x.id === r.data.id);
  eq(s.from, null);
  eq(s.to, null);
});

/* ============================ Итог ============================ */

console.log("\n" + "─".repeat(50));
console.log(`  Пройдено: ${pass}   Провалено: ${fail}`);
if (fail) {
  console.log("\nПровалы:");
  failures.forEach((f) => console.log("  • " + f.name + "\n    " + f.error.message.split("\n").join("\n    ")));
}
console.log("─".repeat(50) + "\n");
process.exit(fail ? 1 : 0);
