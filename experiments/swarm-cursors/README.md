# Swarm Cursors · 移植版（导航栏控制器 + 加载后自动播放 + 本地缓存）

把「页面被擦成空白 → 一群多人协作光标把它重新画回来」这个效果，从 Chrome 扩展搬成一个可嵌入的独立引擎，接在本站上：**真实页面还没露头就先盖上空白画布**，播一遍再退场；**画好的组件当场就能点**，不用等整页画完；开关在导航栏（移动端在折叠菜单里）；引擎首次拉取后走浏览器缓存。

## 来源与致谢

| 角色 | 出处 |
| --- | --- |
| 效果原作（光标、群体物理、建造编排、标尺、声音） | Joel Califa · <https://califa.github.io/swarm-site/> |
| 指向任意页面的那一层（快照 → 空白 → 重建） | DhvanilPatel · <https://github.com/DhvanilPatel/swarm-cursors> |

上游两个项目**都没有开源许可**，本目录只是个人站内的移植实验，不对外分发；要公开复用请先征得 Joel Califa（以及扩展作者）同意。

## 落地位置

| 文件 | 作用 |
| --- | --- |
| [`static/swarm/swarm-cursors.js`](../../static/swarm/swarm-cursors.js) | 引擎（149 KB / gzip ≈ 39 KB）。去掉 `chrome.*` 耦合与自带的底部控制栏；光标只渲染"正在干活"的那些 |
| [`static/swarm/easter.js`](../../static/swarm/easter.js) | 控制器（≈3 KB）：等启动序列 ready → 自动播一次 → 9 秒后退场；负责建出导航栏 / 折叠菜单里的两个挂载点 |
| [`templates/partials/nav.mjs`](../../templates/partials/nav.mjs) | 两处挂载点 `[data-swarm-ctl]`：顶栏右侧、折叠菜单末尾（结构由 JS 建，省首页 HTML 字节） |
| [`src/styles/components.css`](../../src/styles/components.css) | 控制器样式（全吃 tokens）；`html.swarm-on` 时抬高层级：顶栏 9050 / 折叠菜单 9020 / 覆盖层 9000 |
| `templates/_default/baseof.mjs` | 全站 `</body>` 前加 `<script defer src="/swarm/easter.js">` |
| [`demo.html`](demo.html) | 独立演示页，`file://` 直接打开就能跑 |

## 总开关（当前：关）

`static/swarm/easter.js` 顶部一行：

```js
const SWARM_ENABLED = false; // true = 开；false = 整套下线
```

关掉之后：**不下载引擎**（0 请求）、不自动播放、顶栏和折叠菜单里也不建控件（挂载点一起摘掉），页面和没这批代码时一模一样。

临时看效果：地址后加 `?swarm=1`，只对这一次访问生效，不用改代码。

## 控制方式

**桌面**：导航栏右侧的 `▷ SWARM`。空闲只占一个描边小按钮；播放时原地展开 `进度条 · 层数/总层数 · 速度 · 声音 · ✕`。

**移动端（< 768px）**：顶栏只留品牌与汉堡，控制器收进折叠菜单里，同一个组件、同一套状态。菜单在播放时会被抬到覆盖层之上，所以随时能打开菜单改速度 / 静音 / 退出。

| 状态 | 能做什么 |
| --- | --- |
| 空闲 | 点一下开播（带声音）；<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd> 同效 |
| 播放中 | 1×/2×/3×、静音/开声、✕ 立即退场（Esc 同效） |

### 自动播放的规则

- 启动序列一放开（`ready` / `degraded` / `skipped` / `fail`）就**同步接管**：立刻收掉启动遮罩、同一帧把空白画布铺上，用户看不到真实页面的闪动
- **等内容**：正文还在 `正在从内容仓库拉取…` 时不拍快照，等占位消失 + 280ms 静默再开播；6 秒还没到位就这一轮不播；用户已经在读（`scrollY > 40`）也不打扰
- 3× 速度、**静音**起步（浏览器不给自动播放的音频开锁）
- **不替你滚页面**：只画当前这一屏，画完就停 1.6 秒退场；如果首屏画完、剩下的必须滚动才有（引擎会卡住等），停 1.5 秒也退场，不会僵在半截
- 上限 15 秒兜底；播放中用户主动滚轮 → 光标继续追着你画，这次的定时退场取消（滚到哪画到哪）
- 手机（< 768px）不自动播，按钮照样能用；`prefers-reduced-motion: reduce` 也不自动播
- `?swarm=0` 或 `#swarm0` 关掉自动播放

## 画好就能用（不用等整页画完）

- 每个画完的组件（`it.done`）自动接管鼠标：悬停出现 1px 蓝色描边，光标变指针
- 点它 → **立刻撤掉遮罩**（不播退场动画），下一帧把这一下转发给**真实页面上的同名元素**：链接/按钮直接 `click()`，输入框/下拉框 `focus()`
- 于是"读完这一段就想点进去看"这件事，在重建进行到一半时就能做；点空白处不会误触
- 想关掉这个行为：`start({ interactive: false })`

## 文章页不打架（内容竞态）

文章正文是运行时从内容仓库拉的（`.post-loading` / `.remote-loading`），**启动序列 ready ≠ 正文到位**：早先版本在 624ms 就开播，而正文 877ms 才替换进来 —— 蓝图拍的是"正在拉取…"，画完也对不上，点击还会落到错位的元素上。

现在三层处理：

| 时机 | 处理 |
| --- | --- |
| 开播前 | `contentReady()`：等 `.post-loading / .remote-loading` 消失，再等 280ms DOM 静默；6 秒没到位 → 本轮不播（`console.info` 留一行） |
| 开播前 | `scrollY > 40` 说明人已经在读 → 不打扰 |
| 播放中 | 文章页盯 `.post-content`：单次增删 ≥3 个节点（正文被整块替换）→ 立刻 `stop(true)` 退场 |

首页的新闻列表本来就会自己刷新（远端 sync 追加条目），那不算打架，所以监听只挂在文章页（`data-page="post"` / `404`）的正文节点上。

## 缓存与体积

- 引擎请求带版本号：`/swarm/swarm-cursors.js?v=20261106a`
- `static/_headers` 里给 `/swarm/*` 配了 `Cache-Control: public, max-age=31536000, immutable`（构建后进 `dist/_headers`，Cloudflare Pages 生效）→ **首次访问拉一次，之后走浏览器磁盘缓存，不占首屏带宽**
- 改了引擎就把 `easter.js` 里的 `VER` 递增一位，URL 一变浏览器才会重新拉；不改就永远是本地缓存
- 本地 `scripts/serve.mjs` 对所有响应写 `no-store`，所以本地预览看不出缓存效果，线上才生效
- 引擎不进首屏预算：它是 `defer` 加载器在启动序列之后才注入的 `<script>`

## 引擎 API

```js
SwarmCursors.start({
  speed: 2,
  autoExit: 12000,      // 上限：从开播算起最多播多久（0 = 不限）
  exitOnComplete: 1600, // 整页画完之后再停多久退场（0 = 画完也不退）
  muted: true,
  interactive: true,    // 画完的组件可点
  screenshot, hidePage, onComplete,
});
SwarmCursors.stop(true);        // 淡出回真实页面；false = 立刻撕掉
SwarmCursors.toggle();
SwarmCursors.isRunning();
SwarmCursors.status();          // { running, complete, started, agents, worked, done, total,
                                //   progress, speed, muted, blocked, tour, seconds }
SwarmCursors.setSpeed(3);
SwarmCursors.setMuted(true);
SwarmCursors.toggleSound();
SwarmCursors.setTour(true);     // 自动滚屏（原来的 Tour，UI 撤了，API 留着）
```

事件（都挂在 `window` 上）：

| 事件 | 时机 | detail |
| --- | --- | --- |
| `swarm:start` | 画面已接管 | `{ speed, autoExit, muted }` |
| `swarm:status` | 播放中约 8 次/秒 | 同 `status()` |
| `swarm:complete` | 整页画完（需要滚到底才会触发） | `{}` |
| `swarm:end` | 退场开始 | `{}` |

层级由引入方决定：

```js
window.SwarmCursorsConfig = { zIndex: 9000 }; // 必须在引擎脚本之前执行
```

## 画面收敛（去掉了"乱飞"的光标）

| 项 | 原来 | 现在 |
| --- | --- | --- |
| 空闲 / 追鼠标 / 结尾飞散 | 全部渲染 | 不渲染 |
| 赶路中（刚领到任务、还没到图元） | 渲染 | **不渲染**（看它负责的图元最近 320ms 有没有在变） |
| ⌥-复制任务 | 渲染（在副本之间来回飞，最吵） | **不渲染** |
| 1～4px 的装饰小点 | 渲染 | 不渲染 |
| 开场绕 favicon 群飞 | 18 只 | 0 |
| 同时在场 | 8～48 | 6～12 |
| 结尾 flock | 36 只 | 10 只（且不渲染） |

效果：画面上只剩"正在画东西的那几只"，其余时间几乎看不到光标在飘。

## 它是怎么做到的

1. **快照**：遍历 DOM（含 open shadow root），拆成 blueprint —— 盒子 → rect；文本块（连计算样式、链接、行内代码、图标、`::before`/`::after`）→ text；单边描边和 `<hr>` → 钢笔线；`img/svg/video/canvas/iframe` → 媒体；重复兄弟节点 → 一个 master + 若干 duplicates；共享左边缘与基线 → 标尺参考线
2. **擦白**：shadow root 里的全屏层盖住页面，自带底色。盖之前先偷偷滚一遍，把懒加载图触发出来
3. **重建**：每个光标跑一段小生成器脚本，任务从上往下解锁，子任务等父盒子、复制品等 master —— 十字准星拉框（带 `W × H` 徽标）、I-beam 打字、钢笔工具、标尺参考线、⌥-拖拽复制
4. **声音**：Web Audio 实时合成，没有音频文件；音符落在 E 大调五声音阶的八分网格上，按光标位置做声像

## 已做的验证

- `npm run build` + `npm run check` 全绿（首页 HTML gzip 4.39 KB，引擎懒加载不进预算；CSS 选择器白名单已登记 12 个新选择器）
- 桌面 1440×900（3×、不自动滚屏）：0.87s 开播 → 6.33s 退场（首屏画完 + 卡住 1.5s），滚动位置始终在顶部，全程无报错
- 光标可见性采样：播放中途一帧只露 1～4 只，且都贴在正在拖的框 / 正在打的字上；闲逛、赶路、复制、1px 小点全部隐藏
- 无闪屏：采样到 `#loader` 变 `display:none` 的那一帧，`swarm-rebuild` 已在、`.bg` 透明度已是 1，而 `#mainWrap` 仍是 0 —— 空白画布先于真实页面
- 画完即退场：开 tour 跑到全部 220 层完成（22.27s），`swarm:end` 落在 23.88s（正好 +1.6s）
- 画好即点：重建到一半点首页 `READ MORE`（重建层里已有热区）→ 遮罩撤掉、真实链接被点、跳到 `#profile`，全程不用等画完
- 播放中点击导航里的声音 / 速度 / ✕ 都生效（顶栏确实在覆盖层之上）
- 手机 390×844：不自动播；汉堡 → 菜单里的控制器可开播、改速度、退出；播放中再开菜单可关闭（层级 9020 < 顶栏 9050）
- Esc 退出、`?swarm=0`、`file://` 打开 `demo.html`（含独立控制条）均正常
- 缓存：`dist/_headers` 含 `/swarm/*` immutable 规则，引擎请求带 `?v=`
- 文章页：正文到位后才开播（1088ms 起播，之前是 624ms 拍空正文）；首页 640ms 起播；两页都在 12s 上限收尾，无 pageerror
- 慢网兜底：把内容仓库的请求拖 12 秒，站点自己降级成 noscript 正文 → 占位消失后照常播，画完 +1.6s 退场

## 已知限制

- 视觉重建不是克隆：动画定格在按下那一刻；Web component 重建为普通元素；上限约 4000 层 / 40000px
- 没有截图输入时，`canvas`、正在播放的 `video`、跨域 `iframe` 只是占位块（要真实像素就 `start({ screenshot, hidePage:true })`，结束时实现 `window.__swarmUnhide()`）
- 自动播放意味着**每次整页加载都要把 149 KB 引擎跑一遍**（首次下载、之后走缓存）；嫌吵就 `?swarm=0`
- 播放时顶栏浮在空白画布上，画布下方也画了一份顶栏（被真顶栏盖住）；换主题时留意这层叠
- 本地 serve 不支持 `_headers`，缓存行为只能在线上验证

## 调参

`static/swarm/easter.js`：

```js
const VER = "20261106a";   // 改引擎就递增：URL 变化才会重新拉
const AUTO_SPEED = 3;             // 自动播放速度
const AUTO_EXIT_MS = 15000;       // 上限：从开播算起最多 15 秒
const STALL_EXIT = 1500;          // 画到"要滚动才有活"后，停 1.5 秒就退场
const EXIT_AFTER_COMPLETE = 1600; // 画完之后再停多久退场
const START_DELAY = 0;            // 启动序列一放开就接管
const Z_INDEX = 9000;             // 覆盖层层级（顶栏 = --z-ovl + 50，折叠菜单 = +20）
```

`static/swarm/swarm-cursors.js` 顶部：

```js
const MIN_AGENTS = 6;      // 同时在场的最少光标
const MAX_AGENTS = 12;     // 滚动越快追加到多少
const FLOCK_AGENTS = 10;   // 结尾 flock 的规模（不可见）
const INTRO_AGENTS = 0;    // 开场绕图标群飞：已关
const MAX_ITEMS = 4000;    // 图层上限
const MAX_WORLD_H = 40000; // 重建高度上限
const COLORS = [...];      // 光标配色
const NAMES = [...];       // 光标名牌
```
