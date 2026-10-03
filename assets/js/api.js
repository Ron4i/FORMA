/* FORMA — мост к бэкенду (Cloudflare Worker + D1).
   ------------------------------------------------------------------
   Приложение полностью работает без него: все данные лежат в localStorage.
   Этот файл добавляет ОПЦИОНАЛЬНУЮ синхронизацию: если задан адрес Worker'а,
   публикации дублируются на сервер и лента подтягивается с него.

   Включение — одна строка в assets/js/api.js (или window.FORMA_WORKER_URL
   до загрузки скриптов):

       const WORKER_URL = "https://forma-api.<ваш-поддомен>.workers.dev";

   Пока адрес не задан, Fit.api.enabled() === false и ни один сетевой
   запрос не делается. Любая ошибка сети проглатывается — интерфейс
   никогда не должен зависеть от сервера.
*/

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const store = Fit.store;

  /* Адрес Worker'а. Поменяйте на свой после деплоя. */
  const WORKER_URL = (window.FORMA_WORKER_URL || "").replace(/\/+$/, "");
  const TIMEOUT = 6000; // мс — не залипаем на мёртвом сервере

  let online = false;      // ответил ли Worker при последней проверке
  let checked = false;

  /* ---------- Сеть ---------- */

  async function req(method, path, body) {
    if (!WORKER_URL) return null;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(WORKER_URL + path, {
        method,
        signal: ctl.signal,
        headers: {
          "content-type": "application/json",
          "x-user-id": handleHeader()
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Обёртка: при любой ошибке возвращает null и не бросает наружу. */
  async function safe(promise) {
    if (!WORKER_URL) return null; // нет адреса — «сервера» не существует
    try {
      const r = await promise;
      online = true;
      return r;
    } catch (e) {
      online = false;
      if (window.console && console.debug) {
        console.debug("[FORMA] бэкенд недоступен, работаем локально:", e && e.message);
      }
      return null;
    }
  }

  function myHandle() {
    try {
      return store.getSocial().handle || "@" + store.myHandle();
    } catch (e) {
      return "@anon";
    }
  }

  /* Ник бывает кириллическим (@я), а значение HTTP-заголовка обязано быть
     ASCII: браузер молча уронит такой запрос, а Worker его даже не увидит.
     Поэтому в заголовок кладём percent-encoding, Worker его распаковывает. */
  function handleHeader() {
    const h = myHandle();
    try {
      return encodeURIComponent(h);
    } catch (e) {
      return "@anon";
    }
  }

  /* ---------- Синхронизация ---------- */

  /** Забрать ленту, сторис и лидерборд с сервера и подмешать в локальное хранилище. */
  async function pull() {
    if (!WORKER_URL) return null;
    const data = await safe(req("GET", "/api/sync"));
    if (!data || !data.me) return null;

    const local = store.getSocial();
    if (data.me.name && data.me.name !== local.name) {
      store.setSocial({ name: data.me.name, avatar: data.me.avatar, bio: data.me.bio });
    }

    // Сторис: сервер — источник правды по «живым» сторис.
    // Локальные сохраняем только если сервер их ещё не знает.
    if (Array.isArray(data.stories) && data.stories.length) {
      const known = new Set(store.getStories().map((s) => s.id));
      data.stories.forEach((s) => {
        // markFromServer — иначе хук перепошлёт строку обратно на сервер
        if (!known.has(s.id)) store.addStory(markFromServer(s));
      });
    }

    // Посты: добавляем только новые — локальные лайки и комментарии не затираем.
    if (Array.isArray(data.posts) && data.posts.length) {
      const known = new Set(store.getPosts().map((p) => p.id));
      data.posts.forEach((p) => {
        if (known.has(p.id)) return;
        const mine = store.getPost(p.id);
        if (mine) return;
        store.addPost(markFromServer(Object.assign({}, p, { comments: [] })));
      });
    }

    return { stories: data.stories.length, posts: data.posts.length };
  }

  /** Разовая проверка «жив» ли бэкенд. */
  async function ping() {
    if (checked && !online) return false;
    const r = await safe(req("GET", "/api/health"));
    checked = true;
    return !!r && r.ok === true;
  }

  /* ---------- Публикации (зеркалим локальные действия на сервер) ---------- */

  async function pushPost(text, tags, likeCount) {
    if (!WORKER_URL) return null;
    return safe(req("POST", "/api/posts", { text, tags, likeCount, author: myHandle() }));
  }

  async function pushStory(s) {
    if (!WORKER_URL) return null;
    return safe(
      req("POST", "/api/stories", {
        author: myHandle(),
        type: s.type,
        from: s.from,
        to: s.to,
        days: s.days,
        count: s.count,
        title: s.title,
        kcal: s.kcal,
        p: s.p,
        f: s.f,
        c: s.c,
        text: s.text,
        grad: s.grad
      })
    );
  }

  async function pushLike(postId) {
    if (!WORKER_URL) return null;
    return safe(req("POST", "/api/posts/" + encodeURIComponent(postId) + "/like", {}));
  }

  async function pushComment(postId, text) {
    if (!WORKER_URL) return null;
    return safe(req("POST", "/api/posts/" + encodeURIComponent(postId) + "/comments", { text, author: myHandle() }));
  }

  async function pushStorySeen(storyId) {
    if (!WORKER_URL) return null;
    return safe(req("POST", "/api/stories/" + encodeURIComponent(storyId) + "/seen", {}));
  }

  /* ---------- Перехват store: пишем локально, затем синхронизируем ---------- */

  function hook() {
    if (Fit.store.__apiHooked) return;
    Fit.store.__apiHooked = true;

    const origPost = store.addPost;
    store.addPost = function (p) {
      const saved = origPost.call(store, p);
      // локальный сид и восстановление из бэкенда на сервер не отправляем
      if (!p.__fromServer) pushPost(saved.text, saved.tags, saved.likeCount);
      return saved;
    };

    const origStory = store.addStory;
    store.addStory = function (s) {
      const saved = origStory.call(store, s);
      if (!s.__fromServer) pushStory(saved);
      return saved;
    };

    const origLike = store.toggleLike;
    store.toggleLike = function (id, who) {
      const on = origLike.call(store, id, who);
      pushLike(id);
      return on;
    };

    const origComment = store.addComment;
    store.addComment = function (id, c) {
      const saved = origComment.call(store, id, c);
      if (saved) pushComment(id, saved.text);
      return saved;
    };

    const origSeen = store.markStoryViewed;
    store.markStoryViewed = function (id) {
      const r = origSeen.call(store, id);
      pushStorySeen(id);
      return r;
    };
  }

  // Помечаем записи, пришедшие с сервера, чтобы хук их не переотправил.
  const markFromServer = (obj) => Object.assign({}, obj, { __fromServer: true });

  Fit.api = {
    WORKER_URL,
    enabled: () => !!WORKER_URL,
    online: () => online,
    myHandle,
    pull,
    ping,
    pushPost,
    pushStory,
    pushLike,
    pushComment,
    pushStorySeen,
    hook,
    markFromServer
  };

  if (WORKER_URL) {
    hook();
    // Подтягиваем серверные данные после старта, не блокируя первый экран
    window.addEventListener("load", function () {
      setTimeout(function () {
        pull();
      }, 800);
    });
  }
})();
