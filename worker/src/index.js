/* FORMA — бэкенд ленты, сторис и профилей.
   Cloudflare Worker + D1. Ноль зависимостей: только стандартный Web API.

   Деплой:
     cd worker
     npm install
     npx wrangler d1 create forma-db      # впишите database_id в wrangler.toml
     npx wrangler d1 execute forma-db --file=./schema.sql
     npx wrangler deploy
*/

const STORY_TTL = 24 * 60 * 60 * 1000; // сторис живут 24 часа

/* ============================ Утилиты ============================ */

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });

const err = (message, status = 400, extra = {}) => json({ error: message, ...extra }, status);

const id = (prefix) =>
  prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const str = (v, max = 2000) => String(v == null ? "" : v).trim().slice(0, max);
const num = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const int = (v) => (num(v) == null ? null : Math.trunc(num(v)));
/** Разница весов приходит из SQL как 13.299999999999997 — округляем до 0,1 кг. */
const round1 = (v) => (v == null ? 0 : Math.round(v * 10) / 10);

/** Идентификация: заголовок X-User-Id либо query ?user=. В проде — JWT.
 *  Ник может быть кириллическим (@я), а значения HTTP-заголовков обязаны быть
 *  ASCII — клиент шлёт encodeURIComponent(), здесь декодируем обратно. */
function who(req, url) {
  const raw = req.headers.get("x-user-id") || url.searchParams.get("user") || "";
  return str(safeDecode(raw), 80) || "@anon";
}

/** decodeURIComponent не падает на битой последовательности — молча режем. */
function safeDecode(s) {
  if (!/%/.test(s)) return s;
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

/** @handle — обрезаем длину и гарантируем ведущий @. */
function normalHandle(raw) {
  const s = str(raw, 80);
  if (!s) return "@anon";
  return s.startsWith("@") ? s : "@" + s;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/* ============================ CORS ============================ */

function cors(req) {
  const origin = req.headers.get("origin") || "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type, x-user-id",
    "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
    "access-control-max-age": "86400"
  };
}

/* ============================ Маршруты ============================ */

async function handle(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const me = who(req, url);
  const db = env.DB;

  /* ---- служебные ---- */
  if (path === "/" || path === "/api/health") {
    return json({
      ok: true,
      app: "FORMA",
      version: 1,
      time: Date.now(),
      endpoints: [
        "GET  /api/feed",
        "GET  /api/feed/:id",
        "POST /api/posts",
        "POST /api/posts/:id/like",
        "POST /api/posts/:id/comments",
        "GET  /api/stories",
        "POST /api/stories",
        "POST /api/stories/:id/seen",
        "GET  /api/leaderboard",
        "GET/POST /api/users/:handle",
        "POST /api/follow",
        "GET  /api/sync"
      ]
    });
  }

  /* ---- Лента: список постов ---- */
  if (path === "/api/feed" && req.method === "GET") {
    const limit = Math.min(100, Math.max(1, int(url.searchParams.get("limit")) || 30));
    const before = int(url.searchParams.get("before")) || Date.now() + 1;
    const tag = str(url.searchParams.get("tag"), 40);

    const rows = await db
      .prepare(
        `SELECT p.id, p.text, p.tags, p.like_count, p.created_at,
                u.handle, u.name, u.avatar, u.grad,
                (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
                (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comments
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.deleted_at IS NULL AND p.created_at < ?
         ORDER BY p.created_at DESC LIMIT ?`
      )
      .bind(before, limit)
      .all();

    let posts = (rows.results || []).map(toPost);

    if (tag) {
      const t = tag.toLowerCase();
      posts = posts.filter((p) => p.tags.some((x) => x.toLowerCase() === t));
    }
    // Курсор — ts последнего отданного поста, а не запрошенный `before`:
    // иначе следующая страница повторит текущую.
    const next = posts.length === limit ? posts[posts.length - 1].ts : null;
    return json({ posts, next });
  }

  /* ---- Один пост с комментариями ---- */
  const mPost = path.match(/^\/api\/feed\/([\w-]+)$/);
  if (mPost && req.method === "GET") {
    const r = await db
      .prepare(
        `SELECT p.id, p.text, p.tags, p.like_count, p.created_at,
                u.handle, u.name, u.avatar, u.grad,
                (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes
         FROM posts p JOIN users u ON u.id = p.user_id
         WHERE p.id = ? AND p.deleted_at IS NULL`
      )
      .bind(mPost[1])
      .first();
    if (!r) return err("Пост не найден", 404);

    const cs = await db
      .prepare(
        `SELECT c.id, c.text, c.created_at, u.handle, u.name, u.avatar
         FROM comments c JOIN users u ON u.id = c.user_id
         WHERE c.post_id = ? AND c.deleted_at IS NULL
         ORDER BY c.created_at ASC`
      )
      .bind(mPost[1])
      .all();

    return json({
      post: { ...toPost(r), comments: (cs.results || []).map(toComment) }
    });
  }

  /* ---- Создать пост ---- */
  if (path === "/api/posts" && req.method === "POST") {
    const b = (await readBody(req)) || {};
    const text = str(b.text, 4000);
    if (!text) return err("Пустой текст поста", 422);
    const u = await ensureUser(db, b.author || me);
    const pid = id("po");
    const tags = Array.isArray(b.tags)
      ? b.tags.map((t) => str(t, 24)).filter(Boolean).slice(0, 6)
      : [];
    await db
      .prepare("INSERT INTO posts (id,user_id,text,tags,like_count,created_at) VALUES (?,?,?,?,?,?)")
      .bind(pid, u.id, text, JSON.stringify(tags), int(b.likeCount) || 0, Date.now())
      .run();
    return json({ ok: true, id: pid }, 201);
  }

  /* ---- Лайк / снять лайк (переключение одной операцией) ---- */
  const mLike = path.match(/^\/api\/posts\/([\w-]+)\/like$/);
  if (mLike && req.method === "POST") {
    const u = await ensureUser(db, me);
    const postId = mLike[1];
    const exists = await db
      .prepare("SELECT 1 AS x FROM likes WHERE post_id = ? AND user_id = ?")
      .bind(postId, u.id)
      .first();

    if (exists) {
      await db.prepare("DELETE FROM likes WHERE post_id = ? AND user_id = ?").bind(postId, u.id).run();
    } else {
      await db
        .prepare("INSERT OR IGNORE INTO likes (post_id,user_id,created_at) VALUES (?,?,?)")
        .bind(postId, u.id, Date.now())
        .run();
    }
    const n = await db
      .prepare("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?")
      .bind(postId)
      .first();
    return json({ ok: true, liked: !exists, likes: n ? n.c : 0 });
  }

  /* ---- Комментарий ---- */
  const mCom = path.match(/^\/api\/posts\/([\w-]+)\/comments$/);
  if (mCom && req.method === "POST") {
    const b = (await readBody(req)) || {};
    const text = str(b.text, 1000);
    if (!text) return err("Пустой комментарий", 422);
    const u = await ensureUser(db, b.author || me);
    const cid = id("c");
    await db
      .prepare("INSERT INTO comments (id,post_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
      .bind(cid, mCom[1], u.id, text, Date.now())
      .run();
    return json({ ok: true, comment: { id: cid, text, handle: u.handle, name: u.name, avatar: u.avatar, ts: Date.now() } }, 201);
  }

  /* ---- Сторис ---- */
  if (path === "/api/stories" && req.method === "GET") {
    const viewer = await ensureUser(db, me);
    // подчищаем протухшие — заодно освобождаем место в таблице
    await db.prepare("DELETE FROM stories WHERE expires_at < ?").bind(Date.now()).run();
    const rows = await db
      .prepare(
        `SELECT s.*, u.handle, u.name, u.avatar
         FROM stories s JOIN users u ON u.id = s.user_id
         WHERE s.expires_at >= ?
         ORDER BY s.created_at DESC LIMIT 200`
      )
      .bind(Date.now())
      .all();
    const seen = await db
      .prepare("SELECT story_id FROM story_views WHERE user_id = ?")
      .bind(viewer.id)
      .all();
    const seenSet = new Set((seen.results || []).map((r) => r.story_id));
    return json({ stories: (rows.results || []).map((r) => toStory(r, seenSet.has(r.id))) });
  }

  if (path === "/api/stories" && req.method === "POST") {
    const b = (await readBody(req)) || {};
    const u = await ensureUser(db, b.author || me);
    const sid = id("st");
    const ts = Date.now();
    const type = ["result", "meal", "streak"].includes(b.type) ? b.type : "result";
    await db
      .prepare(
        `INSERT INTO stories (id,user_id,type,from_weight,to_weight,days,count,title,kcal,protein,fat,carbs,text,grad,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        sid, u.id, type,
        num(b.from), num(b.to), int(b.days), int(b.count),
        str(b.title, 80), num(b.kcal), num(b.protein ?? b.p), num(b.fat ?? b.f), num(b.carbs ?? b.c),
        str(b.text, 500), str(b.grad, 8) || "g1",
        ts, ts + STORY_TTL
      )
      .run();
    return json({ ok: true, id: sid, expiresAt: ts + STORY_TTL }, 201);
  }

  /* ---- Сторис просмотрена ---- */
  const mSeen = path.match(/^\/api\/stories\/([\w-]+)\/seen$/);
  if (mSeen && req.method === "POST") {
    const viewer = await ensureUser(db, me);
    await db
      .prepare("INSERT OR IGNORE INTO story_views (story_id,user_id,created_at) VALUES (?,?,?)")
      .bind(mSeen[1], viewer.id, Date.now())
      .run();
    return json({ ok: true });
  }

  /* ---- Лидерборд: кто сколько сбросил ---- */
  if (path === "/api/leaderboard" && req.method === "GET") {
    const rows = await db
      .prepare(
        `SELECT u.handle, u.name, u.avatar, u.grad,
                MAX(ABS(COALESCE(s.from_weight,0) - COALESCE(s.to_weight,0))) AS kg
         FROM users u LEFT JOIN stories s ON s.user_id = u.id AND s.type = 'result'
         GROUP BY u.id ORDER BY kg DESC, u.handle LIMIT 50`
      )
      .all();
    const list = (rows.results || []).map((r, i) => ({
      handle: r.handle, name: r.name, avatar: r.avatar, grad: r.grad,
      kg: round1(r.kg), place: i + 1
    }));
    return json({ leaderboard: list });
  }

  /* ---- Профиль ---- */
    // Ник кладём в путь percent-encoded: [\w@.-]+ кириллицу не пропустит,
    // поэтому сначала берём «сырой» участок, потом аккуратно распаковываем.
    const mUser = path.match(/^\/api\/users\/(.+)$/);
    if (mUser) {
      const handle = normalHandle(safeDecode(mUser[1]));
    if (req.method === "GET") {
      const u = await db.prepare("SELECT * FROM users WHERE handle = ?").bind(handle).first();
      if (!u) return err("Пользователь не найден", 404);
      const viewer = await ensureUser(db, me);
      const p = await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(u.id).first();
      const cnt = await db
        .prepare(
          `SELECT (SELECT COUNT(*) FROM posts WHERE user_id = ? AND deleted_at IS NULL) AS posts,
                  (SELECT COUNT(*) FROM follows WHERE followee_id = ? AND follower_id = ?) AS followsMe,
                  (SELECT COUNT(*) FROM follows WHERE follower_id = ?) AS followers`
        )
        .bind(u.id, u.id, viewer.id, u.id)
        .first();
      return json({
        user: { handle: u.handle, name: u.name, avatar: u.avatar, bio: u.bio, grad: u.grad },
        profile: p || null,
        stats: { posts: cnt.posts, followers: cnt.followers, followsMe: !!cnt.followsMe }
      });
    }
    if (req.method === "POST" || req.method === "PUT") {
      const b = (await readBody(req)) || {};
      const u = await ensureUser(db, handle);
      await db
        .prepare("UPDATE users SET name = ?, avatar = ?, bio = ?, grad = ? WHERE id = ?")
        .bind(str(b.name, 40) || u.name, str(b.avatar, 8) || u.avatar, str(b.bio, 200), str(b.grad, 8) || u.grad, u.id)
        .run();
      await db
        .prepare(
          `INSERT INTO profiles (user_id,from_weight,to_weight,weight,height,age,goal_weight,bio,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(user_id) DO UPDATE SET
             from_weight = COALESCE(excluded.from_weight, from_weight),
             to_weight   = COALESCE(excluded.to_weight,   to_weight),
             weight      = COALESCE(excluded.weight,      weight),
             height      = COALESCE(excluded.height,      height),
             age         = COALESCE(excluded.age,         age),
             goal_weight = COALESCE(excluded.goal_weight, goal_weight),
             bio         = excluded.bio,
             updated_at  = excluded.updated_at`
        )
        .bind(
          u.id, num(b.from), num(b.to), num(b.weight), num(b.height), int(b.age), num(b.goalWeight),
          str(b.bio, 200), Date.now()
        )
        .run();
      return json({ ok: true, handle: u.handle });
    }
  }

  /* ---- Подписка ---- */
  if (path === "/api/follow" && req.method === "POST") {
    const b = (await readBody(req)) || {};
    const a = await ensureUser(db, b.from || me);
    const t = await ensureUser(db, b.to);
    if (a.id === t.id) return err("Нельзя подписаться на себя", 422);
    const exists = await db
      .prepare("SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?")
      .bind(a.id, t.id)
      .first();
    if (exists) {
      await db.prepare("DELETE FROM follows WHERE follower_id = ? AND followee_id = ?").bind(a.id, t.id).run();
    } else {
      await db.prepare("INSERT OR IGNORE INTO follows (follower_id,followee_id,created_at) VALUES (?,?,?)").bind(a.id, t.id, Date.now()).run();
    }
    return json({ ok: true, following: !exists });
  }

  /* ---- Синхронизация всего профиля сразу (то, что нужно приложению при старте) ---- */
  if (path === "/api/sync" && req.method === "GET") {
    const u = await ensureUser(db, me);
    const [stories, feed, lb] = await Promise.all([
      db.prepare("SELECT s.*, u.handle, u.avatar, u.name FROM stories s JOIN users u ON u.id = s.user_id WHERE s.expires_at >= ? ORDER BY s.created_at DESC LIMIT 50").bind(Date.now()).all(),
      db.prepare("SELECT p.id, p.text, p.tags, p.like_count, p.created_at, u.handle, u.name, u.avatar, u.grad FROM posts p JOIN users u ON u.id = p.user_id WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 30").all(),
      db.prepare("SELECT u.handle, u.name, u.avatar, u.grad, MAX(ABS(COALESCE(s.from_weight,0) - COALESCE(s.to_weight,0))) AS kg FROM users u LEFT JOIN stories s ON s.user_id = u.id AND s.type='result' GROUP BY u.id ORDER BY kg DESC LIMIT 50").all()
    ]);
    const p = await db.prepare("SELECT * FROM profiles WHERE user_id = ?").bind(u.id).first();
    return json({
      me: { handle: u.handle, name: u.name, avatar: u.avatar, bio: u.bio, grad: u.grad },
      profile: p || null,
      stories: (stories.results || []).map((r) => toStory(r, false)),
      posts: (feed.results || []).map(toPost),
      leaderboard: (lb.results || []).map((r, i) => ({ handle: r.handle, name: r.name, avatar: r.avatar, grad: r.grad, kg: round1(r.kg), place: i + 1 }))
    });
  }

  return err("Неизвестный маршрут", 404, { path });
}

/* ============================ Маппинг строк БД → формат приложения ============================ */

function parseTags(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function toPost(r) {
  return {
    id: r.id,
    user: r.handle,
    name: r.name,
    avatar: r.avatar,
    grad: r.grad,
    text: r.text,
    tags: parseTags(r.tags),
    likes: [],
    likeCount: Math.max(r.like_count || 0, r.likes || 0),
    commentCount: r.comments || 0,
    ts: r.created_at
  };
}

function toComment(r) {
  return { id: r.id, user: r.handle, name: r.name, avatar: r.avatar, text: r.text, ts: r.created_at };
}

function toStory(r, seen) {
  return {
    id: r.id,
    user: r.handle,
    handle: r.handle,
    name: r.name,
    avatar: r.avatar,
    type: r.type,
    from: r.from_weight,
    to: r.to_weight,
    days: r.days,
    count: r.count,
    title: r.title,
    kcal: r.kcal,
    p: r.protein,
    f: r.fat,
    c: r.carbs,
    text: r.text,
    grad: r.grad,
    ts: r.created_at,
    expires: r.expires_at,
    seen: !!seen
  };
}

/** Найти или создать пользователя по @хэндлу. Имя выводится из хэндла. */
async function ensureUser(db, handle) {
  const h = (String(handle || "@anon").startsWith("@") ? String(handle) : "@" + handle).slice(0, 40);
  const found = await db.prepare("SELECT * FROM users WHERE handle = ?").bind(h).first();
  if (found) return found;
  const name = h
    .slice(1)
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 40);
  const u = { id: id("u"), handle: h, name, avatar: "🙂", bio: "", grad: "gMe", created_at: Date.now() };
  await db
    .prepare("INSERT OR IGNORE INTO users (id,handle,name,avatar,bio,grad,created_at) VALUES (?,?,?,?,?,?,?)")
    .bind(u.id, u.handle, u.name, u.avatar, u.bio, u.grad, u.created_at)
    .run();
  return (await db.prepare("SELECT * FROM users WHERE handle = ?").bind(h).first()) || u;
}

/* ============================ Точка входа ============================ */

export default {
  async fetch(req, env) {
    const c = cors(req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: c });
    try {
      const res = await handle(req, env);
      for (const [k, v] of Object.entries(c)) res.headers.set(k, v);
      return res;
    } catch (e) {
      return err("Внутренняя ошибка: " + (e && e.message ? e.message : e), 500);
    }
  }
};
