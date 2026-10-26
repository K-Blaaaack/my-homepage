/**
 * platform.js —— 平台探测。pointer:coarse 优先于 UA。
 * 纯函数，可在无 DOM 环境（Node）里安全调用。
 */

function mq(win, query) {
  try {
    return typeof win.matchMedia === 'function' ? win.matchMedia(query).matches : false;
  } catch { return false; }
}

export function detectPlatform(win = globalThis) {
  const nav = (win && win.navigator) || {};
  const coarse = mq(win, '(pointer:coarse)');
  const hover = mq(win, '(hover:hover)');
  const reducedMotion = mq(win, '(prefers-reduced-motion:reduce)');
  const touch = (nav.maxTouchPoints || 0) > 0;
  const ua = nav.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
  // 判定顺序：pointer:coarse > hover:hover > 触摸点 > UA
  const mobile = coarse ? true : hover ? false : (touch || uaMobile);

  let connection = null;
  try {
    const c = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (c) connection = { type: c.effectiveType || c.type || null, saveData: !!c.saveData, rtt: c.rtt || null };
  } catch { /* 忽略 */ }

  return {
    platform: mobile ? 'mobile' : 'desktop',
    pointer: coarse ? 'coarse' : 'fine',
    touch,
    hover,
    reducedMotion,
    saveData: !!(connection && connection.saveData),
    connection,
    dpr: (win && win.devicePixelRatio) || 1,
    width: (win && win.innerWidth) || 0,
    height: (win && win.innerHeight) || 0,
  };
}

/** 把探测结果写到 <html> 的 data-* 上，供 CSS 与调试使用。 */
export function applyPlatform(p, doc = globalThis.document) {
  if (!doc || !doc.documentElement) return p;
  const el = doc.documentElement;
  el.dataset.platform = p.platform;
  el.dataset.pointer = p.pointer;
  el.dataset.motion = p.reducedMotion ? 'reduce' : 'full';
  return p;
}
