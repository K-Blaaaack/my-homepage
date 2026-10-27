/**
 * main.js —— 运行时入口（<script type="module">）。
 * 职责只有三件：建 store、探测平台、驱动 boot。其余全部在动态分包里。
 */
import { createStore } from './store.js';
import { detectPlatform, applyPlatform } from './platform.js';
import { boot, releaseLoader } from './boot.js';

const params = new URLSearchParams(location.search);
const mode = params.get('boot');
const store = createStore();
const platform = applyPlatform(detectPlatform(window), document);

store.setPrefs({
  platform: platform.platform,
  pointer: platform.pointer,
  reducedMotion: platform.reducedMotion,
  connection: platform.connection,
  kernel: params.get('kernel') !== '0',
});
store.setBoot({ debug: mode === 'debug', replay: mode === '1' || mode === 'debug' });

// 安全网：任何未捕获异常 / 未处理拒绝都不允许留下黑屏遮罩
function emergency(err) {
  try {
    store.setBoot((b) => ({ phase: 'fail', errors: { ...b.errors, runtime: String((err && err.message) || err) } }));
    releaseLoader(document);
  } catch { /* 忽略 */ }
}
window.addEventListener('error', (e) => emergency(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => emergency(e.reason));

boot({ store, platform, params, kernel: params.get('kernel') !== '0' })
  .then((r) => {
    if (r && r.ok) store.setBoot({ phase: r.degraded ? 'degraded' : 'ready' });
    else if (r && r.ok === false) store.setBoot({ phase: 'fail' });
  })
  .catch(emergency);

// 调试出口（?boot=debug 时配合 performance.getEntriesByName('boot:*') 使用）
window.__kb = Object.assign(window.__kb || {}, { store, platform, boot });
