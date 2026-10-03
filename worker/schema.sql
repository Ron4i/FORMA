-- FORMA — схема базы для ленты, сторис и профилей.
-- Cloudflare D1 (SQLite). Применяется: wrangler d1 execute forma-db --file=./schema.sql

PRAGMA foreign_keys = ON;

-- ---------- Пользователи ----------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  handle      TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  avatar      TEXT NOT NULL DEFAULT '🙂',
  bio         TEXT NOT NULL DEFAULT '',
  grad        TEXT NOT NULL DEFAULT 'gMe',
  created_at  INTEGER NOT NULL
);

-- Профиль прогресса: то, что человек публикует о себе
CREATE TABLE IF NOT EXISTS profiles (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  from_weight  REAL,
  to_weight    REAL,
  weight       REAL,
  height       REAL,
  age          INTEGER,
  goal_weight  REAL,
  bio          TEXT NOT NULL DEFAULT '',
  updated_at   INTEGER NOT NULL
);

-- ---------- Посты ленты ----------
CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',   -- JSON-массив
  like_count  INTEGER NOT NULL DEFAULT 0,  -- базовое «социальное доказательство»
  created_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(deleted_at, created_at DESC);

-- ---------- Лайки ----------
-- Первичный ключ (post, user) не даёт лайкнуть дважды и делает переключение атомарным
CREATE TABLE IF NOT EXISTS likes (
  post_id   TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

-- ---------- Комментарии ----------
CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, deleted_at, created_at);

-- ---------- Сторис (живут 24 часа) ----------
CREATE TABLE IF NOT EXISTS stories (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'result', -- result | meal | streak
  from_weight REAL,
  to_weight   REAL,
  days        INTEGER,
  count       INTEGER,
  title       TEXT,
  kcal        REAL,
  protein     REAL,
  fat         REAL,
  carbs       REAL,
  text        TEXT NOT NULL DEFAULT '',
  grad        TEXT NOT NULL DEFAULT 'g1',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stories_live ON stories(expires_at DESC);

-- Кто какие сторис смотрел (чтобы кольцо было серым)
CREATE TABLE IF NOT EXISTS story_views (
  story_id   TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (story_id, user_id)
);

-- ---------- Подписки ----------
CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

-- ---------- Челленджи и прогресс ----------
CREATE TABLE IF NOT EXISTS challenges (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  day         INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS achievements (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id     TEXT NOT NULL,
  earned_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, badge_id)
);
