# 启动序列规格（Boot Sequence Spec）

> 状态：草案 v0.1 ｜ 2026-10-27 ｜ 上游：[30-nextgen-v3-plan.md](./30-nextgen-v3-plan.md) §4
> 目标：把 `layouts/partials/loader.html` + `assets/js/main.js:1-72` 的**装饰动画**改造成**真实启动状态机**，视觉零改动。

---

## 1. 问题定义

### 1.1 现状（证据）

| 事实 | 位置 | 后果 |
|---|---|---|
| 17 行文案硬编码，每行一个 `delay`（0→5200ms） | `assets/js/main.js:38-49` | 文案与实际加载无关 |
| 进度 = `line.delay / 5800` | `main.js:56-57` | 进度条是时间轴，不是工作量 |
| 固定 6000ms 后隐藏 | `main.js:69-71` | 页面早就绪也要等满 6s |
| 无失败路径 | 全文 | 资源失败也显示「加载完成」 |
| `.main-wrap{opacity:0}` 只由 JS 打开 | `main.css` / `baseof.html` | **无 JS 时首页永久黑屏** |
| 5 分钟 cookie 冷却 | `head/loader.html` | 用户每 5 分钟被拦一次 |

### 1.2 为什么「装饰」变不成「功能」

Hugo 静态页在首屏**没有任何可等待的工作**：HTML 到了，CSS 到了，JS 到了，就结束了。没有真实工作，动画只能演。

所以本规格有一个前置条件：**V3 必须引入真实的可等待工作**（§3）。这是 30 号文档里 S2 先于 S3 的原因。

---

## 2. 设计目标与非目标

**目标**

1. 每一行都对应一个可观测事件（网络、解析、解码、挂载），并携带真实度量。
2. 能失败、能重试、能降级；失败时用户知道「哪一步失败了」。
3. 总时长可控：p75 ≤ 1.2s，硬上限 2.5s 后强制放行。
4. 视觉零改动：复用现有 `.loader-*` 类与 ARK 令牌。
5. 可观测：`performance.mark/measure`，可导出到 CI。

**非目标**

- 不做「艺术化」重设计；不引入新字体/新色值/新圆角。
- 不做首屏骨架屏（skeleton）——正文本身已是静态 HTML，遮罩消失即内容就绪。
- 不追求「每次都播」；重复访问应当直接进入。

---

## 3. 真实工作清单（V3 引入）

| 工作 | 来源 | 是否阻塞首屏 | 典型耗时 | 失败影响 |
|---|---|---|---|---|
| 运行时内核模块 | `import('./core/boot.js')`（~6 KB gzip） | 是 | 20–80 ms | 覆盖层不可用，正文可用 |
| 文章清单 `meta.json` | 构建期生成（21 篇，~3 KB） | 是 | 15–60 ms | 搜索/标签不可用 |
| 搜索索引分片 | 构建期生成（~40 KB，按首字分片） | 否（可后台） | 30–120 ms | 搜索降级为清单过滤 |
| 首屏媒体解码 | `img.decode()`（hero/公告图） | 是 | 10–60 ms | 图片稍后出现 |
| 视图挂载 | 覆盖层初始化 + 一次 rAF 量测 | 是 | 5–20 ms | 交互缺失 |
| 字体（若有自托管子集） | `document.fonts.ready` | 是 | 0–150 ms | 回退系统字体 |

> 若某项工作在某页面不存在（例如文章页没有 hero 图），该 stage 权重归零并**不渲染该行**，而不是渲染一行假的「完成」。

---

## 4. 状态机

### 4.1 阶段与迁移

```
idle
 └─(boot())→ shell ─→ core ─→ manifest ─→ index ─→ media ─→ views ─→ ready
                  │        │            │         │        │
                  └────────┴────────────┴─────────┴────────┴─→ fail(step)
                                                                  └─(retry)→ 该 stage 重跑
ready ─(flavor 400ms)→ idle（移除遮罩）
任意阶段 ─(全局 2.5s)→ degraded（放行 + [WARN]）
```

### 4.2 阶段定义

| # | id | 行文案模板（真实值填充） | 真实工作 | 证据 | 权重 | 超时 |
|---|---|---|---|---|---|---|
| 1 | `shell` | `> P.R.T.S. NATIVE RHODES ISLAND TERMINAL SERVICE` | 首帧后（`requestAnimationFrame`）确认关键 CSS 已应用 | `document.styleSheets.length > 0` + mark | 5 | — |
| 2 | `core` | `> [  OK  ] 运行时内核 <KB> KB · <ms> ms` | 动态 `import()` 内核 | `PerformanceResourceTiming` | 20 | 3s |
| 3 | `manifest` | `> [  OK  ] 文章清单 <n> 篇 · <ms> ms` | `fetch('meta.json')` + `JSON.parse` + schema 校验 | resource timing + `n` | 25 | 3s |
| 4 | `index` | `> [  OK  ] 搜索索引 <n> 条 · <KB> KB` | `fetch('search/index.<hash>.json')` | resource timing | 15 | 3s |
| 5 | `media` | `> [  OK  ] 首屏媒体 <n> 张 · decode <ms> ms` | `Promise.all(imgs.map(i=>i.decode()))` | `decode()` resolve | 20 | 2s |
| 6 | `views` | `> [  OK  ] 视图挂载 搜索 / 目录 / 标签` | `initPlatform()` + 一次 rAF | mark | 15 | 1s |

**软检查点**（只允许发生在 stage 内部，不得跨越 stage）：

- `index` 分片 > 1 时，行文本追加 `(2/3)`，进度按分片数在**本阶段权重内**推进。
- `media` 多图时，按已解码张数推进。
- 禁止：用 `setTimeout` 凭空推进任何百分比。

### 4.3 彩蛋（ready 之后）

现有 17 行里的氛围文案保留，但**只能在 `ready` 之后**播放，且不阻塞遮罩消失：

```
> 欢迎回来，博士
> K-BLACK TERMINAL 已就绪
> ACCESS GRANTED
> [????] Dr.预言家，不准忘記我        ← 400ms 后淡入，红色，可跳过
```

规则：**彩蛋不得替代检查点**。若 `ready` 在 300ms 内到达，彩蛋整体跳过（用户不需要等待氛围）。

---

## 5. 检查点契约

```js
/**
 * @typedef {Object} Stage
 * @property {string} id          唯一标识，也是 performance mark 名
 * @property {string} label       行文案前缀（中文，真实语义）
 * @property {number} weight      权重（所有启用 stage 之和归一化到 100）
 * @property {number} timeout     单阶段超时 ms
 * @property {() => Promise<{detail:string, ok?:boolean}>} run
 *          必须返回真实度量；内部必须 await 真实工作
 */
```

约束（`check:boot` 机器校验）：

1. `run` 函数体内必须出现 `await` / `fetch` / `decode` / `import(` 至少一处。
2. stage 定义对象中禁止出现 `setTimeout` / `setInterval`。
3. 渲染出的 `[ OK ]` 行数 === 实际 resolve 的 stage 数。
4. 任何 `[ OK ]` 行必须包含至少一个数字（字节/条数/耗时）。

---

## 6. 进度模型

```
progress = Σ(已完成 stage 的 weight) / Σ(启用 stage 的 weight)
```

- 阶段内不做百分比插值，只用 CSS `transition: width var(--t-fast) linear` 平滑（现有样式）。
- 进度**永不回退**；重试时从该阶段起点继续。
- 总权重不足 100 时按比例归一化，不出现「卡在 97%」。

---

## 7. 视觉与文案

- 容器与配色完全沿用 `.loader` 系列类；只新增：
  - `.loader-line.warn` → `color: var(--warn)`（超时降级）
  - `.loader-retry` → 复用 `.cut` 按钮配方（0 圆角、1px `--line`、hover `--line-h`、文字 `--signal`）
- 行格式统一：`> [  OK  ] <label> <detail>`；失败：`> [ FAIL ] <label> · <reason>`。
- 不使用 emoji、不使用彩色进度条、不新增动画曲线（沿用 `--t-fast/--t-slow`）。

---

## 8. 失败、超时、重试、降级

| 场景 | 行为 |
|---|---|
| 单阶段失败 | 该行红色 `[ FAIL ]`；终端底部出现 `点击重试`；其余已完成的 stage 保留，不重跑 |
| 单阶段超时（3s） | 视为失败，文案 `[ FAIL ] <label> · 超时` |
| 全局超时（2.5s） | `[ WARN ] 启动超时，先行放行`；遮罩淡出；后台继续，完成后静默更新状态（debug 面板可见） |
| 清单失败但内核 OK | 降级：搜索不可用（入口置灰 + tooltip），正文照常 |
| 索引失败 | 降级：搜索改为清单本地过滤，不阻塞 |
| 连续失败 2 次 | 记住 `boot:failed`，本会话不再自动播放，直接放行 |
| `prefers-reduced-motion` | 不播放终端，仅 150ms 淡出交接 |
| 无 JS | `<noscript>` 注入 `.loader{display:none}.main-wrap{opacity:1}` |
| 打印 | `@media print` 隐藏 loader（补一条即可） |

---

## 9. 冷却与重放

- 默认：`sessionStorage['boot:seen']`，**每会话一次**。
- 强制重放：`?boot=1`（调试/分享用），`?boot=debug` 额外显示计时面板。
- 不做 5 分钟 cookie 冷却（现有机制会让回访用户反复被拦）。
- 首次访问（无 `boot:seen`）才播完整序列；回访直接进入，保留 120ms 淡入。

---

## 10. 可观测性

```js
performance.mark('boot:start');
// 每个 stage
performance.mark(`boot:${stage.id}:start`);
performance.mark(`boot:${stage.id}:end`);
performance.measure(`boot:${stage.id}`, `boot:${stage.id}:start`, `boot:${stage.id}:end`);
performance.mark('boot:ready');
```

- debug 面板（`?boot=debug`）显示：每阶段耗时、总耗时、失败原因、网络类型（`navigator.connection`）。
- CI 侧：Playwright 打开首页（清 storage），采集 `performance.getEntriesByName('boot:*')`，写入 `docs/architecture/metrics/boot.json`，与基线比较，回归 > 30% 报警。

---

## 11. 参考实现骨架

```js
// src/core/boot.js —— 启动状态机：真实检查点驱动，禁止伪造
const STAGES = [
  { id: 'shell', weight: 5, timeout: 0, run: async () => ({ detail: 'terminal v4.12.06' }) },
  { id: 'core', weight: 20, timeout: 3000, run: async () => {
      const t0 = performance.now();
      await import('./store.js');            // 真实模块加载
      return { detail: (performance.now() - t0).toFixed(0) + ' ms' };
    } },
  { id: 'manifest', weight: 25, timeout: 3000, run: async () => {
      const res = await fetch('/meta.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const meta = await res.json();
      return { detail: meta.articles.length + ' 篇' };
    } },
  // index / media / views 同构
];

export async function boot({ onLine, onProgress, onFail, onDone }) {
  const enabled = STAGES.filter((s) => s.weight > 0);
  const total = enabled.reduce((n, s) => n + s.weight, 0);
  let done = 0;

  for (const stage of enabled) {
    try {
      const result = await withTimeout(stage.run(), stage.timeout || Infinity);
      done += stage.weight;
      onLine(stage, result);                 // 渲染真实行
      onProgress(done / total);
    } catch (err) {
      onFail(stage, err);                    // 红色行 + 重试
      return { ok: false, stage: stage.id };
    }
  }
  onDone();
  return { ok: true };
}
```

> 说明：`withTimeout` 只用于**兜底**，不用于推进进度；它的存在是为了让失败可见，而不是让流程显得流畅。

---

## 12. 验收清单（可测）

- [ ] 断网打开首页：出现 `[ FAIL ] 文章清单 · 网络错误`，可点击重试，正文仍可读。
- [ ] 限速 3G：2.5s 内遮罩消失，出现 `[ WARN ] 启动超时，先行放行`，后台完成。
- [ ] 禁用 JS：首页正文立即可见，无黑色遮罩（`<noscript>` 生效）。
- [ ] 二次访问（同会话）：不播放终端，120ms 淡入。
- [ ] `?boot=1`：完整重放；`?boot=debug`：显示计时面板。
- [ ] `prefers-reduced-motion: reduce`：不播放逐行动画，150ms 交接。
- [ ] 每行文案含真实数字；`check:boot` 静态检查通过。
- [ ] `performance.measure` 有 6 条记录；总耗时 p75 ≤ 1.2s。
- [ ] 打印预览不含终端。
- [ ] 视觉回归：与现有 loader 截图像素 diff = 0（除新增失败/重试态）。

---

## 13. 反模式（明令禁止）

| 反模式 | 为什么禁止 |
|---|---|
| `setTimeout` 驱动的行 | 这就是现在的问题本身 |
| 固定总时长（如 6s）后隐藏 | 与真实就绪无关 |
| 进度条按时间线性推进 | 谎报工作量 |
| 失败也显示「加载完成」 | 用户无法判断是否可用 |
| 把彩蛋当检查点 | 氛围不能替代状态 |
| 遮罩消失依赖动画结束事件 | 动画被跳过/中断时内容永久不可见 |
| 只在首页生效 | 文章页也需要清单/索引/内核 |
