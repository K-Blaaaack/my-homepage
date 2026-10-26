/**
 * debug.js —— ?boot=debug 的计时面板（独立动态 chunk，只有 debug 模式才加载）。
 * 从 boot.js 抽出来是为了把入口 gzip 压回预算内：调试面板约 700 B gz，不该算在首屏里。
 */
const DBG = '> [ DBG  ] ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 终端内追加计时面板（只复用已有 .loader-line 类，不新增样式）。 */
export async function debugPanel(term, store, result, stages, win) {
  const conn = (store.state.prefs && store.state.prefs.connection) || null;
  const weightOf = (id) => {
    const s = (stages || []).find((x) => x.id === id);
    return s ? s.weight : '?';
  };
  const rows = Object.keys(result.timings).map((id) => DBG + id + ' ' + result.timings[id].toFixed(0) + ' ms · w' + weightOf(id));
  rows.push(DBG + 'total ' + result.totalMs.toFixed(0) + ' ms · ' + (conn ? 'conn ' + (conn.type || 'n/a') : 'conn n/a'));
  rows.forEach((r) => term.write(r, 'dim'));
  store.setBoot({ timings: result.timings });

  // 末行是完整 JSON（无前缀，选中即可复制），CI 也可以直接读 console 的 BOOT_METRICS 行
  const payload = {
    total_ms: Number(result.totalMs.toFixed(1)),
    degraded: !!result.degraded,
    stages: Object.keys(result.timings).reduce((acc, id) => {
      acc[id] = { ms: Number(result.timings[id].toFixed(1)), weight: weightOf(id) };
      return acc;
    }, {}),
    errors: result.errors,
    connection: conn ? conn.type || null : null,
  };
  const json = JSON.stringify(payload);
  term.write(json, 'dim');
  try {
    if (win) win.__bootMetrics = payload;
    console.log('BOOT_METRICS ' + json);
    console.table(payload.stages);
  } catch { /* 忽略 */ }
  await sleep(2000); // 留出观察时间；finally 仍会移除遮罩
}
