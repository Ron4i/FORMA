/* FORMA — мобильные UI-примитивы.
   Нижние шторки (вместо десктопных модалок), тосты, скачивание файлов,
   баннер активной GPS-записи, haptics, pull-to-refresh. */

(function () {
  const Fit = (window.Fit = window.Fit || {});
  const qs = Fit.qs || ((s, r) => (r || document).querySelector(s));

  /* ------------------------------------------------------------------ */
  /* Haptics — короткая тактильная отдача, если устройство умеет         */
  /* ------------------------------------------------------------------ */

  function haptic(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    } catch (e) {}
  }
  Fit.haptic = haptic;

  /* ------------------------------------------------------------------ */
  /* Нижняя шторка                                                        */
  /* ------------------------------------------------------------------ */

  let openSheet = null;

  const sheet = {
    /**
     * opens({ title, body, foot, onClose })
     * body/foot — HTML-строки. Кнопки с data-sheet-close закрывают шторку.
     */
    open(opts) {
      if (openSheet) sheet.close(true);
      opts = opts || {};
      const back = document.createElement("div");
      back.className = "m-sheet-back";
      back.innerHTML =
        '<div class="m-sheet" role="dialog" aria-modal="true" aria-label="' +
        Fit.esc(opts.title || "") + '">' +
        '<div class="grab"></div>' +
        '<div class="sh-head"><h3>' + Fit.esc(opts.title || "") + "</h3>" +
        '<button class="icon-btn" data-sheet-close aria-label="Закрыть">' + Fit.iconSvg("close") + "</button></div>" +
        '<div class="sh-body">' + (opts.body || "") + "</div>" +
        (opts.foot ? '<div class="sh-foot">' + opts.foot + "</div>" : "") +
        "</div>";
      document.body.appendChild(back);
      document.body.classList.add("no-scroll");
      openSheet = { el: back, onClose: opts.onClose };

      // Закрытие по фону, по кнопке и по Escape.
      back.addEventListener("click", (e) => {
        if (e.target === back) sheet.close();
        if (e.target.closest("[data-sheet-close]")) sheet.close();
      });
      const onKey = (e) => {
        if (e.key === "Escape") sheet.close();
      };
      document.addEventListener("keydown", onKey);
      back._onKey = onKey;

      // Свайп вниз за «ручку» закрывает шторку.
      enableSwipeDown(back.querySelector(".m-sheet"));
      return back;
    },
    close(immediate) {
      if (!openSheet) return;
      const { el, onClose } = openSheet;
      openSheet = null;
      if (el._onKey) document.removeEventListener("keydown", el._onKey);
      document.body.classList.remove("no-scroll");
      if (onClose) {
        try {
          onClose();
        } catch (e) {}
      }
      if (immediate) {
        el.remove();
        return;
      }
      el.style.transition = "opacity .2s";
      el.style.opacity = "0";
      const s = el.querySelector(".m-sheet");
      if (s) s.style.transform = "translateY(100%)";
      setTimeout(() => el.remove(), 240);
    },
    isOpen() {
      return !!openSheet;
    }
  };
  Fit.mSheet = sheet;

  function enableSwipeDown(el) {
    if (!el) return;
    let startY = 0;
    let dy = 0;
    let dragging = false;
    const head = el.querySelector(".grab");
    const area = head || el;
    area.style.touchAction = "none";
    area.addEventListener(
      "touchstart",
      (e) => {
        startY = e.touches[0].clientY;
        dy = 0;
        dragging = true;
        el.style.transition = "none";
      },
      { passive: true }
    );
    area.addEventListener(
      "touchmove",
      (e) => {
        if (!dragging) return;
        dy = e.touches[0].clientY - startY;
        if (dy > 0) el.style.transform = "translateY(" + dy + "px)";
      },
      { passive: true }
    );
    const end = () => {
      if (!dragging) return;
      dragging = false;
      el.style.transition = "transform .26s cubic-bezier(.22,1,.36,1)";
      if (dy > 110) {
        sheet.close();
      } else {
        el.style.transform = "";
      }
    };
    area.addEventListener("touchend", end);
    area.addEventListener("touchcancel", end);
  }

  /* ------------------------------------------------------------------ */
  /* Тосты                                                               */
  /* ------------------------------------------------------------------ */

  function toast(msg, kind, ms) {
    let host = qs("#m-toast-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "m-toast-host";
      host.className = "m-toast-host";
      document.body.appendChild(host);
    }
    const ic =
      kind === "error" ? "⚠️" : kind === "ok" ? "✅" : kind === "warn" ? "⚡" : "ℹ️";
    const t = document.createElement("div");
    t.className = "m-toast " + (kind || "");
    t.innerHTML =
      '<span class="ic">' + ic + '</span><span class="tx">' + Fit.esc(msg) + "</span>";
    host.appendChild(t);
    setTimeout(() => {
      t.classList.add("out");
      setTimeout(() => t.remove(), 260);
    }, ms || 3200);
    if (kind === "ok" || kind === "error") haptic(kind === "ok" ? 12 : [18, 60, 18]);
    return t;
  }
  Fit.mToast = toast;

  /* ------------------------------------------------------------------ */
  /* Скачивание файлов (CSV/JSON)                                         */
  /* ------------------------------------------------------------------ */

  function downloadCsv(name, content) {
    downloadFile(name, content, "text/csv;charset=utf-8");
  }

  function downloadFile(name, content, mime) {
    try {
      // BOM нужен, чтобы Excel корректно открыл кириллицу в CSV.
      const blob = new Blob(["﻿" + content], { type: mime || "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name || "export";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    } catch (e) {
      toast("Не удалось сохранить файл", "error");
      return false;
    }
  }
  Fit.downloadCsv = downloadCsv;
  Fit.downloadFile = downloadFile;

  /* ------------------------------------------------------------------ */
  /* Баннер активной GPS-записи — виден на любом экране                   */
  /* ------------------------------------------------------------------ */

  let banner = null;

  function updateBanner() {
    if (!Fit.gps) return;
    const rec = Fit.gps.isRecording();
    if (!rec) {
      if (banner) {
        banner.remove();
        banner = null;
      }
      return;
    }
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "gps-rec-banner";
      banner.innerHTML =
        '<span class="dot"></span><span class="lbl">GPS-запись идёт</span>' +
        '<button data-gps-stop>Остановить</button>';
      banner.querySelector("[data-gps-stop]").addEventListener("click", async () => {
        const s = Fit.gps.snapshot();
        if (s && s.distance < 10 && s.elapsed < 60) {
          const ok = await Fit.confirmDialog("Запись почти пустая. Сохранить её?");
          if (!ok) {
            Fit.gps.discard();
            return;
          }
        }
        Fit.gps.stop({ save: true });
        Fit.renderTo();
      });
      document.body.appendChild(banner);
    }
    const s = Fit.gps.snapshot();
    if (s) {
      const lbl = banner.querySelector(".lbl");
      lbl.textContent =
        (s.paused ? (s.autoPaused ? "Автопауза · " : "Пауза · ") : "") +
        s.elapsedLabel + " · " + s.distanceLabel + " км";
    }
  }

  function initBanner() {
    if (!Fit.gps) return;
    Fit.gps.on("tick", updateBanner);
    Fit.gps.on("start", updateBanner);
    Fit.gps.on("stop", updateBanner);
    Fit.gps.on("discarded", updateBanner);
    updateBanner();
  }
  Fit.initGpsBanner = initBanner;

  /* ------------------------------------------------------------------ */
  /* Pull-to-refresh                                                     */
  /* ------------------------------------------------------------------ */

  function enablePullToRefresh(container) {
    if (!container) return;
    const indicator = document.createElement("div");
    indicator.style.cssText =
      "position:absolute;top:0;left:50%;transform:translateX(-50%);width:34px;height:34px;margin-top:6px;" +
      "border-radius:50%;background:var(--card);border:1px solid var(--line);display:grid;place-content:center;" +
      "opacity:0;transition:opacity .2s;pointer-events:none;z-index:30";
    indicator.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
      '<path d="M12 5v14"/><path d="m8 11 4 4 4-4"/></svg>';
    // Вешаем индикатор на стабильного предка: сам #view перерисовывается
    // рендерером, и вложенный элемент исчез бы вместе со старой разметкой.
    const host = container.parentElement || document.body;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(indicator);

    let startY = null;
    const canPull = () => window.scrollY <= 0;
    container.addEventListener(
      "touchstart",
      (e) => {
        if (!canPull()) return;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );
    container.addEventListener(
      "touchmove",
      (e) => {
        if (startY == null) return;
        const dy = e.touches[0].clientY - startY;
        if (dy > 70) {
          startY = null;
          indicator.style.opacity = "1";
          indicator.querySelector("svg").style.animation = "bootspin .8s linear infinite";
          haptic(14);
          setTimeout(() => {
            indicator.style.opacity = "0";
            Fit.renderTo();
            haptic(10);
          }, 520);
        }
      },
      { passive: true }
    );
    container.addEventListener(
      "touchend",
      () => {
        startY = null;
        indicator.style.opacity = "0";
        const s = indicator.querySelector("svg");
        if (s) s.style.animation = "";
      },
      { passive: true }
    );
  }
  Fit.enablePullToRefresh = enablePullToRefresh;
})();
