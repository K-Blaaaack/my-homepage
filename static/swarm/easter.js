/*
 * Swarm Cursors — 导航栏控制器 + 加载后自动播放一次
 *
 *  · 引擎 /swarm/swarm-cursors.js 只在需要时下载（~150KB，不进首屏）
 *  · SWARM_ENABLED 是总开关；关掉后这套东西完全不出现（?swarm=1 可临时打开）
 *  · 导航栏右侧的小组件负责全部控制：播放/停止、进度、层数、速度、声音、退出
 *  · 引擎自带的那条底部控制栏已经删掉，控制权只在这里
 *  · Alt+Shift+S 同效；?swarm=0 关掉自动播放；系统开了"减少动态效果"也不自动播
 */
(() => {
  "use strict";

  /* ───────────────────────────── 总开关 ─────────────────────────────
   * false = 整套效果下线：不下载引擎、不自动播放、导航栏/折叠菜单里也不建控件。
   * 想临时看一眼：地址后加 ?swarm=1（只对这次访问生效）。
   * ──────────────────────────────────────────────────────────────── */
  const SWARM_ENABLED = false;

  // 引擎带版本号：配合 /swarm/* 的 immutable 缓存，首次拉一次，之后走本地缓存。
  // 改了引擎就把 VER 往后挪一位（浏览器会重新拉新文件）。
  const VER = "20261106d";
  const SRC = "/swarm/swarm-cursors.js?v=" + VER;
  const AUTO_SPEED = 3;      // 自动播放 2×：整段十来秒压到 6～8 秒
  const AUTO_EXIT_MS = 15000; // 上限：从开播算起最多 15 秒
  const EXIT_AFTER_COMPLETE = 1600; // 整页画完之后，停 1.6 秒再退场
  const STALL_EXIT = 1500;         // 首屏画完、剩下的要等滚动 → 停 1.5 秒就退场（不自动滚屏）
  const START_DELAY = 0;     // 启动序列一放开就接管，抢在真实页面露头之前铺上遮罩
  const Z_INDEX = 9000;      // 覆盖层压在导航栏之下（--z-ovl），控制器才点得到

  const params = new URLSearchParams(location.search);
  const autoOff = params.get("swarm") === "0" || location.hash === "#swarm0";
  const reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const wide = !window.matchMedia || matchMedia("(min-width: 768px)").matches; // 手机不自动播，按钮仍可用

  const forced = params.get("swarm") === "1";
  if (!SWARM_ENABLED && !forced) {
    // 关掉时连挂载点一起摘掉，导航栏布局和原来一模一样
    for (const m of document.querySelectorAll("[data-swarm-ctl]")) m.remove();
    window.SwarmCursorsEnabled = false;
    return;
  }
  window.SwarmCursorsEnabled = true;

  window.SwarmCursorsConfig = Object.assign({ zIndex: Z_INDEX }, window.SwarmCursorsConfig || {});

  let loading = null;
  let speed = AUTO_SPEED;

  /* ------------------------------------------------------------ 引擎加载 */

  function load() {
    if (window.SwarmCursors) return Promise.resolve(window.SwarmCursors);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.onload = () => (window.SwarmCursors ? resolve(window.SwarmCursors) : reject(new Error("引擎缺失")));
      s.onerror = () => {
        loading = null;
        reject(new Error("无法加载 " + SRC));
      };
      document.head.appendChild(s);
    });
    return loading;
  }

  function play(opts) {
    return load()
      .then((api) => {
        if (api.isRunning()) return false;
        return api.start(Object.assign({ speed, muted: false, exitOnComplete: EXIT_AFTER_COMPLETE }, opts));
      })
      .catch((err) => {
        console.warn("[swarm]", err.message);
        paint({ running: false });
        return false;
      });
  }

  function toggle() {
    const api = window.SwarmCursors;
    if (api && api.isRunning()) api.stop(true);
    else play();
  }

  /* -------------------------------------------------------------- 小组件 */

  const MARKUP =
    '<button class="swarm-btn" data-swarm-act="play" type="button" aria-pressed="false" aria-label="用光标群重建本页（Alt+Shift+S）" title="用光标群重建本页（Alt+Shift+S）">' +
    '<span class="swarm-ic" aria-hidden="true"></span><span class="swarm-label">Swarm</span></button>' +
    '<div class="swarm-live"><span class="swarm-meter" aria-hidden="true"><i data-swarm-bar></i></span>' +
    '<span class="swarm-num"><b data-swarm-done>0</b>/<span data-swarm-total>0</span></span>' +
    '<button class="swarm-mini" data-swarm-act="speed" type="button" aria-label="重建速度" title="重建速度">1×</button>' +
    '<button class="swarm-mini" data-swarm-act="sound" type="button" aria-label="声音" title="声音（M）" aria-pressed="false">♪</button>' +
    '<button class="swarm-mini swarm-x" data-swarm-act="stop" type="button" aria-label="退出重建" title="退出（Esc）">✕</button></div>';

  const mounts = () => Array.from(document.querySelectorAll("[data-swarm-ctl]"));

  function closeMenu() {
    const burger = document.getElementById("burger");
    const mob = document.getElementById("mob");
    if (mob) mob.classList.remove("open");
    if (burger) {
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    }
  }

  function paint(st) {
    const on = !!(st && st.running);
    document.documentElement.classList.toggle("swarm-on", on);
    for (const m of mounts()) {
      m.dataset.on = on ? "true" : "false";
      const play = m.querySelector('[data-swarm-act="play"]');
      if (!play) continue;
      play.setAttribute("aria-pressed", on ? "true" : "false");
      play.title = on ? "停止并回到页面（Esc）" : "用光标群重建本页（Alt+Shift+S）";
      if (!on) continue;
      const pct = Math.round((st.progress || 0) * 100);
      const bar = m.querySelector("[data-swarm-bar]");
      if (bar) bar.style.width = pct + "%";
      const done = m.querySelector("[data-swarm-done]");
      if (done) done.textContent = (st.done || 0).toLocaleString();
      const total = m.querySelector("[data-swarm-total]");
      if (total) total.textContent = (st.total || 0).toLocaleString();
      const sp = m.querySelector('[data-swarm-act="speed"]');
      if (sp) sp.textContent = (st.speed || speed) + "×";
      const snd = m.querySelector('[data-swarm-act="sound"]');
      if (snd) {
        snd.setAttribute("aria-pressed", st.muted ? "false" : "true");
        snd.title = st.muted ? "打开声音" : "静音（M）";
      }
    }
  }

  function bind() {
    for (const mount of mounts()) {
      if (mount.dataset.built) continue;
      mount.dataset.built = "1";
      mount.innerHTML = MARKUP;

      mount.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-swarm-act]");
        if (!btn) return;
        const api = window.SwarmCursors;
        const act = btn.dataset.swarmAct;
        if (act === "play") {
          if (api && api.isRunning()) {
            api.stop(true);
          } else {
            closeMenu();
            play();
          }
        } else if (act === "stop") {
          closeMenu();
          if (api) api.stop(true);
        } else if (act === "speed") {
          const cur = (api && api.status().speed) || speed;
          speed = cur >= 3 ? 1 : cur + 1;
          if (api) api.setSpeed(speed);
          btn.textContent = speed + "×";
        } else if (act === "sound") {
          if (api) api.toggleSound();
        }
      });
    }
    paint(window.SwarmCursors ? window.SwarmCursors.status() : { running: false });
  }

  addEventListener("swarm:start", () => paint(window.SwarmCursors.status()));
  addEventListener("swarm:status", (e) => paint(e.detail));
  addEventListener("swarm:end", () => paint({ running: false }));

  addEventListener(
    "keydown",
    (e) => {
      if (!e.altKey || !e.shiftKey) return;
      if (e.key !== "S" && e.key !== "s" && e.code !== "KeyS") return;
      e.preventDefault();
      e.stopPropagation();
      toggle();
    },
    true
  );

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();

  watchContent();
  window.SwarmCursorsPlay = () => play();

  /* ------------------------------------------------------ 等内容、别打架 */

  /**
   * 文章页/列表页的正文是运行时从内容仓库拉的（.post-loading / .remote-loading 占位）。
   * 启动序列 ready ≠ 正文到位：此时拍快照会拍到"正在拉取…"，随后正文替换 → 蓝图画的是旧的。
   * 所以先等占位消失，再等一小段静默期；超时还没到位就这一轮不播。
   */
  const CONTENT_WAIT = 6000;
  const CONTENT_QUIET = 280;
  const BUSY_SEL = ".post-loading, .remote-loading";

  function contentReady(deadlineMs = CONTENT_WAIT) {
    const root = document.getElementById("main") || document.body;
    if (!root) return Promise.resolve(true);
    const busy = () => !!root.querySelector(BUSY_SEL);
    if (!busy()) return Promise.resolve(true);

    return new Promise((resolve) => {
      let done = false;
      let quietSince = 0;
      let deadline = 0;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearInterval(tick);
        clearTimeout(deadline);
        obs.disconnect();
        resolve(ok);
      };
      const obs = new MutationObserver(() => {
        if (!busy()) quietSince = quietSince || performance.now();
      });
      obs.observe(root, { childList: true, subtree: true, characterData: true });
      const tick = setInterval(() => {
        if (busy()) {
          quietSince = 0;
          return;
        }
        if (!quietSince) quietSince = performance.now();
        if (performance.now() - quietSince >= CONTENT_QUIET) finish(true);
      }, 80);
      deadline = setTimeout(() => finish(!busy()), deadlineMs);
    });
  }

  /**
   * 播放期间正文被整块换掉（远端文章晚到）→ 立刻退场，别对着旧蓝图硬画。
   * 只在文章页盯 .post-content：首页的新闻列表本来就会自己刷新，那不叫打架。
   */
  function watchContent() {
    const page = (document.documentElement.dataset.page || "").toLowerCase();
    if (page !== "post" && page !== "404") return;
    const art = document.querySelector(".post-content");
    if (!art) return;

    let obs = null;
    addEventListener("swarm:start", () => {
      if (obs) obs.disconnect();
      obs = new MutationObserver((muts) => {
        let heavy = 0;
        for (const m of muts) {
          if (m.type !== "childList") continue;
          heavy += m.addedNodes.length + m.removedNodes.length;
        }
        if (heavy < 3) return; // 零星补几个节点不算换正文
        const api = window.SwarmCursors;
        if (api && api.isRunning()) api.stop(true);
      });
      obs.observe(art, { childList: true, subtree: true });
    });
    addEventListener("swarm:end", () => {
      if (obs) {
        obs.disconnect();
        obs = null;
      }
    });
  }

  /* ---------------------------------------------------------- 自动播放一次 */

  /** 立刻收掉启动遮罩：swarm 的空白画布会同时盖上，用户看不到真实页面的闪动 */
  function dropLoader() {
    const l = document.getElementById("loader");
    if (l) {
      l.style.transition = "none";
      l.style.display = "none";
      l.setAttribute("aria-hidden", "true");
    }
    const w = document.getElementById("mainWrap");
    if (w) w.classList.add("show");
    document.documentElement.classList.remove("no-js");
    document.documentElement.classList.add("js");
  }

  function whenBootReady(cb) {
    const store = window.__kb && window.__kb.store;
    const settled = (p) => p === "ready" || p === "degraded" || p === "skipped" || p === "fail";

    if (!store) {
      if (document.readyState === "complete") setTimeout(cb, START_DELAY);
      else addEventListener("load", () => setTimeout(cb, START_DELAY), { once: true });
      return;
    }
    if (settled(store.state.boot.phase)) {
      setTimeout(cb, START_DELAY);
      return;
    }
    let off = null;
    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      setTimeout(cb, START_DELAY);
    };
    const stopWatch = store.subscribe((s) => {
      if (!settled(s.boot.phase)) return;
      if (off) off();
      fire();
    });
    off = stopWatch;
    // 兜底：启动序列卡住也要播；只播一次，用户中途关掉了就不再拉起来
    setTimeout(() => {
      if (off) off();
      fire();
    }, 8000);
  }

  if (!autoOff && !reduce && wide) {
    whenBootReady(() => {
      if (document.hidden) return;
      dropLoader();
      contentReady().then((ready) => {
        if (!ready) {
          console.info("[swarm] 正文还在拉取，本轮不播");
          return;
        }
        if (window.scrollY > 40) return; // 已经在读的人不打扰
        play({
          speed: AUTO_SPEED,
          muted: true,
          tour: false, // 不替用户滚页面
          stallExit: STALL_EXIT,
          autoExit: AUTO_EXIT_MS,
          exitOnComplete: EXIT_AFTER_COMPLETE,
        });
      });
    });
  }
})();
