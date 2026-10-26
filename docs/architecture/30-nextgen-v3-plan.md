# 下一代站点架构规划（V3）：静态内容层 + 运行时内核

> 状态：草案 v0.1，待 YG 评审 ｜ 2026-10-27 ｜ 作者：lead
> 上游证据：[00-current-state.md](./00-current-state.md)（现状审计）、[metrics/baseline.json](./metrics/baseline.json)
> 关系说明：本文**推翻** [10-target-architecture.md](./10-target-architecture.md) 与 [20-migration-roadmap.md](./20-migration-roadmap.md) 的核心结论「继续用 Hugo 做内核」。那两份文档的审计数据、视觉契约、质量门禁设计继续有效，只换引擎。
> 配套规格：[31-boot-sequence-spec.md](./31-boot-sequence-spec.md)（启动序列）

---

## 0. 结论先行

1. **推翻的是「引擎 + 单体实现」，不是「静态交付」。** V3 = 自有构建内核（内容 → HTML/清单/索引）+ 自有运行时内核（状态层 + 覆盖层 + 启动序列）+ 单一视觉契约。产物仍是纯静态文件，仍上 Cloudflare Pages，没有服务端。
2. **内容不动、URL 不动、样式不动。** 21 篇 Markdown、81 个 HTML 路径、`--signal:#18d1ff` 与 0 圆角/1px 线/45° 切角的 ARK 令牌全部保留。改的是「怎么生成、怎么运行、怎么验收」。
3. **加载动画变真实的前提，是站点真的有活要干。** 现在的 PRTS 终端是 17 行 `setTimeout`（4 个定时器，5.8s 固定时长，无失败路径），Hugo 静态页在首屏没有任何可等待的工作，所以它只能演。V3 引入真实的运行时工作（内核模块、文章清单、搜索索引、首屏图片解码、视图挂载），动画才有资格叫「启动序列」。
4. **从 Strata 学的是分层与状态驱动，不是它的窗口式 UX、白色玻璃、运行时拉 GitHub raw。** 文章仍是独立页面、可滚动、可被搜索引擎直接抓取；状态层只接管覆盖层（搜索/命令面板/目录/预览）。
5. **先落地看得见的部分（样式分层 → 运行时内核 → 启动序列），最后才换构建内核。** 风险最大的一步放在有 parity 门禁之后，线上任何时刻都可构建、可回滚。

---

## 1. 现状复核（本次实测，2026-10-27）

| 项 | 实测值 | 采集方式 |
|---|---|---|
| Hugo | v0.168.0+extended+withdeploy | `hugo version` |
| 构建 | **42 ms**，141 页 / 81 HTML / 163 文件 / 826,482 B | `hugo --gc --minify -d /tmp/kbout` |
| 模板层 | 20 文件 / 392 行；`aria-*` 0 个 | `find layouts` / 审计 |
| 样式 | `assets/css/main.css` **548 行 / 36,278 B / gzip 9,927 B**，14 节 | `wc -l` |
| 脚本 | `assets/js/main.js` **192 行 / 7,813 B / gzip 3,105 B**，9 个 IIFE | `wc -l` |
| 内容 | 21 篇 md；`data/{news,stack,links}.toml` | `find content` |
| 工程化 | **无 CI、无 tag、无测试、无预算门禁** | `.github` 不存在，`git tag` 空 |
| 部署 | 仓库内无任何部署配置；`public/` 停在 10 月 9 日（比源码少 26 文件） | 审计 §5.2 |

### 1.1 现有「框架」到底是什么

不是 Hugo 本身，而是这四件事的耦合体：

1. **Hugo 模板即业务逻辑**：导航链接写两遍、箭头 SVG 内联 5 份、11 处内联 style、`_default/list.html` 脱离 baseof 自成一份 HTML → 58 个 tag 页是 0 链接空壳。
2. **单体 CSS**：548 行单文件，令牌、组件、页面、动效、响应式混在一处，任何改动都要读全文。
3. **单体 JS**：192 行 9 个 IIFE，无模块边界、无状态层、无错误边界，启动动画与导航/标签/复制按钮挤在同一个执行上下文。
4. **零验收**：没有 CI、没有预算、没有视觉回归、没有部署记录。改坏了只能靠人眼。

V3 要拆的就是这四条。

### 1.2 启动动画的真实状态（专项证据）

`layouts/partials/loader.html` + `assets/js/main.js:1-72`：

- 17 行文案硬编码在 JS 数组里，每行一个 `delay`（0 → 5200ms），第 17 行是彩蛋。
- 进度条 = `(line.delay / 5800) * 100`，**与任何真实工作无关**。
- 固定 6000ms 后 `loader.classList.add('hide')`，与页面是否真的可用无关。
- 冷却：cookie `prts_played` 5 分钟（`head/loader.html` 在 `<head>` 里预判并打 `prts-skip`）。
- **无失败路径**：任何资源失败它也照样播完、照样显示「加载完成」。
- **无 JS 时首页永久黑屏**：`.main-wrap` 默认 `opacity:0`，只有 JS 加 `.show` 才可见；没有 `<noscript>` 兜底。

结论：它是一个**动画**，不是一个**启动序列**。V3 要把它变成后者，规格见 [31-boot-sequence-spec.md](./31-boot-sequence-spec.md)。

---

## 2. 参考仓库：提取什么，拒绝什么

### 2.1 Strata 的真实结构（读代码得出，不是读 README）

```
index.html                 只有 canvas + 加载状态，其余 DOM 由组件自建
assets/javascript/
  main.js                  引导：CDN 依赖 → 平台资源 → 文章数据 → 初始化（含超时/失败）
  platform.js              平台检测（pointer:coarse 优先于 UA）
  core/data.js             配置、meta 枚举、raw 拉取、marked 渲染、全文搜索
  core/window-manager.js   纯逻辑窗口栈（92 行，零 DOM，发布订阅）
  core/background.js       加载动画 + 四面体（388 行，状态机 + 真实检查点）
  core/branding.js         随机数学曲线生成 favicon + 标题随状态变化
  core/search-ui.js        搜索结果渲染（跨平台共用）
  platforms/{desktop,mobile}/   同一状态源，两套视图，接口只有 initComponents()/reveal()
assets/css/{tokens,desktop,mobile}.css
```

关键实现细节（值得学的部分）：

- **加载是状态机**：`idle → point → grow1 → hold1 → grow2 → link1 → hold2 → link2 → dimension → rotate | fail`。`hold1` 等 `markedReadyFlag`，`hold2` 等 `dataReadyFlag`——**硬检查点**；其余阶段内部用随机时长填满——**软检查点**。失败时线条变红、保留静态帧、点击重试。
- **状态层零 DOM**：`window-manager.js` 只维护 `stack` 并 `notify()`，侧栏/标签栏/文章窗口/页面标题全是它的投影。
- **平台层最小接口**：`initComponents()` + `reveal()`，桌面/手机各自实现，`main.js` 不知道差异。
- **数据层契约**：`meta.json`（文章清单，push 时由 Actions 生成）+ raw 拉正文，不消耗 API 配额；相对路径媒体自动重写为绝对地址。

### 2.2 移植矩阵

| # | 理念 | Strata 的做法 | V3 的落法 | 为什么不同 |
|---|---|---|---|---|
| 1 | 分层与单向依赖 | 数据/状态/平台/样式/视觉五层 | 内容/构建/运行时/平台/样式/交付六层，依赖单向 | 我们要保留构建期产物，多一层 |
| 2 | 状态层纯逻辑 | 窗口栈 + 发布订阅，零 DOM | `core/store.js`：覆盖层栈 + 搜索 + 偏好，纯 reducer，零 DOM | 同样思路，但只管覆盖层 |
| 3 | 视图是状态的投影 | tabbar/sidebar/article-view 各自订阅 | 覆盖层（搜索/命令面板/目录/预览）各自订阅 | 正文不接管，保留 MPA |
| 4 | 平台分离、接口最小 | `initComponents()/reveal()` | `initPlatform()/reveal()`，desktop/mobile 两套 | 直接采用 |
| 5 | 启动 = 真实状态机 | 软检查点 + 硬检查点 + 失败重试 | 同构，但每个 `[ OK ]` 必须携带真实度量（字节/条数/耗时） | 更严：禁止伪造行 |
| 6 | 内容与页面解耦 | 双仓 + config.json + meta.json | 单仓 + 构建期生成 `meta.json` 与索引分片 | 个人站规模不需要双仓 |
| 7 | 程序化品牌 | 随机数学曲线 favicon + 标题随栈顶变化 | favicon 保留静态资产；**标题随覆盖层状态变化**（`K-BLACK · 搜索`） | 视觉资产已定型，不动 logo |
| 8 | 视觉 z 轴分层 | canvas → 搜索 → 文章窗 → 侧栏/Dock | 内容 → 覆盖层 → 终端 → toast，z 轴常量集中在 tokens | 采用 |
| 9 | 原生 ESM / 按需 import | 无打包，CDN 动态 import | 原生 ESM 源码 + esbuild 产物；第三方库**本地 vendor**，不挂 CDN | 中国网络 + 完整性 + CSP |

### 2.3 明确不学（以及理由）

| 不学 | 理由 |
|---|---|
| 运行时从 GitHub raw 拉正文 | 首屏依赖第三方网络；国内 raw 不稳定；SEO 归零；单点故障。我们构建期预渲染 |
| 全量客户端建 DOM（index.html 只有 canvas） | 无 JS 即白屏；爬虫/读屏/分享卡片全部失效；与现有 81 个可索引页面冲突 |
| 白色玻璃 + `border-radius:6/8/20px` | 与 ARK 契约冲突（0 圆角、1px 线、45° 切角、单一信号色） |
| 全屏 `overflow:hidden` 的画布式窗口 | 会摧毁现有长文滚动阅读、锚点导航、浏览器查找、打印 |
| 双仓分离 | 21 篇文章、单人维护，双仓只增加一次跨仓同步成本 |
| CDN 运行时依赖 marked / highlight.js | 可用性、SRI、CSP、离线全部变差；构建期渲染更稳 |
| 搜索结果固定上限 5 条 | 我们有 21 篇 + 标签 + 页面，需要分组结果与键盘导航 |

---

## 3. V3 目标架构

### 3.1 分层图

```
┌──────────────────────── L5 质量层 QUALITY（横切） ────────────────────────┐
│ 预算门禁 · HTML 校验 · 链接检查 · a11y · 视觉回归 · URL parity · boot 真实性 │
└──────▲───────────────▲────────────────▲───────────────▲──────────────────┘
       │               │                │               │
┌──────┴──────┐ ┌──────┴───────┐ ┌──────┴──────┐ ┌──────┴──────┐
│ L0 内容层   │ │ L1 构建内核  │ │ L2 运行时   │ │ L4 样式层   │
│ md + fm     │→│ 自有 Node    │→│ 内核(浏览器)│ │ tokens/…    │
│ data/*.toml │ │ 路由/清单/索引│ │ store/boot  │ │ 5 层 + 平台 │
└─────────────┘ └──────┬───────┘ └──────┬──────┘ └──────┬──────┘
                       │ public/        │ 增强           │ 打包产物
                       ▼                ▼                ▼
              ┌──────────────────────────────────────────────┐
              │ L3 交付层 · Cloudflare Pages（原子部署 + 回滚）│
              └──────────────────────────────────────────────┘
```

与 V2 的差别只有一处，但很关键：**L1 从 Hugo 换成自有构建内核，并新增 L2 运行时内核**。V2 的 L2「资源层」并入 L1 与 L4。

### 3.2 目录契约

```
my-homepage/
├── content/                     # L0 唯一内容源（保持现状）
│   ├── posts/<slug>/index.md    #   page bundle，媒体同目录
│   ├── pages/{info,stack,wip}/
│   └── _meta/site.toml          #   站点级文案（替代模板内硬编码中文）
├── data/                        # L0 结构化展示数据（保持现状）
├── build/                       # L1 构建内核（新）
│   ├── index.mjs                #   入口：load → render → emit → report
│   ├── markdown.mjs             #   remark/rehype + shiki 高亮
│   ├── routes.mjs               #   路由表：/、/posts/、/posts/<slug>/、/tags/…
│   ├── manifest.mjs             #   生成 meta.json / search-index / tags.json
│   ├── images.mjs               #   sharp：webp + srcset + 尺寸
│   └── feeds.mjs                #   RSS / sitemap / robots
├── src/                         # L2+L4 源码（新，替代 assets/）
│   ├── core/{store,boot,router,data,prefs}.js
│   ├── platforms/{desktop,mobile}/{index,search,toc,peek}.js
│   └── styles/{tokens,base,components,pages,motion,platform-desktop,platform-mobile}.css
├── templates/                   # L1 模板（Web Components 或极简模板函数，不用 Hugo 语法）
├── static/                      # 原样拷贝
├── dist/                        # 构建产物（gitignore；替代 public/）
└── docs/                        # 架构与 runbook
```

迁移期 `nextgen/css/` 的 5 个文件直接演进为 `src/styles/`，不浪费已有工作。

### 3.3 运行时内核（L2）职责边界

只做四件事，**不接管正文路由**：

| 模块 | 职责 | 不做什么 |
|---|---|---|
| `store.js` | 状态 + 发布订阅：`{ overlays[], search, prefs, boot }` | 不碰 DOM、不发请求 |
| `router.js` | 覆盖层开/关/聚焦；URL hash 同步（`#search`、`#toc`） | 不拦截 `<a>` 到文章的跳转 |
| `data.js` | 加载并缓存 `meta.json` / 索引分片，超时与降级 | 不渲染 Markdown |
| `boot.js` | 启动状态机（见 31 号文档） | 不承载业务 |

渐进增强契约（硬性）：

- **无 JS**：页面完整可读、可导航、可搜索（`/search/` 提供纯表单 + 静态结果页）。
- **有 JS**：搜索变为覆盖层、`/` 唤起、目录跟随、文章预览、标签栈。
- **JS 失败**：不得出现遮罩残留或空白；`boot` 的 finally 必须移除遮罩。

---

## 4. 专项：PRTS 启动序列（摘要）

完整规格见 [31-boot-sequence-spec.md](./31-boot-sequence-spec.md)，这里只钉三件事：

1. **视觉零改动**：`.loader / .loader-terminal / .loader-term-bar / .loader-line(.show/.dim/.gold/.red) / .loader-progress / .loader-pbar / .loader-pbar-fill / .loader-ptxt / html.prts-skip` 全部复用，只新增 `.loader-line.warn` 与重试按钮（复用 `.cut` 按钮配方）。
2. **行 = 检查点**：6 个阶段替代 17 行假文案，每行携带真实度量（`[ OK ] 文章清单 21 篇 · 84 ms`），失败行红色 + `点击重试`（只重跑失败阶段）。
3. **必须能失败**：单阶段超时 3s、全局 2.5s 强制放行（`[WARN] 启动超时，先行放行`）、`prefers-reduced-motion` 直接跳过、无 JS 用 `<noscript>` 隐藏遮罩——顺手修掉现在「无 JS 永久黑屏」的缺陷。

---

## 5. 关键决策（待 YG 拍板，附建议默认值）

| # | 决策 | 选项 | 建议 | 理由 |
|---|---|---|---|---|
| D1 | 构建内核 | A 自研 Node ／ B 保留 Hugo ／ C Astro/Eleventy | **A**，B 作为兜底 | 只有自研才能同时产出运行时需要的 `meta.json`+索引+路由表；B 的触发器见 §8 |
| D2 | 渲染形态 | A 静态 MPA + 渐进增强 ／ B 全客户端渲染 | **A** | SEO、无 JS 可用、首屏、现有 URL 全部保住 |
| D3 | 内容源 | A 单仓 ／ B 双仓（Strata 式） | **A** | 21 篇、单人维护；双仓收益为零 |
| D4 | 搜索 | A 自研 JSON 索引 ／ B Pagefind | **A**（先），B 作为 >100 篇时的升级路径 | 21 篇总量 < 60 KB，自研可做分组/键盘/中文双字切分 |
| D5 | 启动动画频率 | A 每会话一次 + `?boot=1` 重放 ／ B 每次访问 | **A**，上限 2.5s | 现在 5 分钟冷却 + 6s 遮挡，实际体验是「每次回来都被拦」 |
| D6 | 是否保留 Hugo 过渡 | A 保留到 parity 通过 ／ B 立刻删 | **A** | 双构建跑 2 周，产物 diff 为零再删 |

---

## 6. 路线图

总投入约 **10 人日**（单人）；与 AI 结对按 60% 折算约 **6 天**。原则：**用户可见的价值先到，风险最大的后置**。

| 阶段 | 目标 | 产出 | 退出标准（硬） | 回滚 |
|---|---|---|---|---|
| **S0** 基线冻结 0.5d | 给后面每一步一个「确定的过去」 | `v1.0-baseline` tag、`dist` 快照、`docs/runbook.md` | 换机器照 runbook 能重建同一产物 | 只增不改 |
| **S1** 样式分层 1d | 548 行 → 7 个文件，字节不增 | `src/styles/*`、lightningcss 打包、`:root` 唯一性检查 | 视觉回归 0 diff；CSS gzip ≤ 9.9 KB；`check:tokens` 绿 | 保留 `assets/css/main.css` 原件 |
| **S2** 运行时内核 1.5d | store/router/data + 覆盖层 | `src/core/*`、搜索覆盖层、`/` 唤起、`meta.json` 消费 | 无 JS 全站可用；有 JS 覆盖层可用；JS gzip ≤ 6 KB | 特性开关 `?kernel=0` |
| **S3** 启动序列 1d | 动画变状态机 | `src/core/boot.js`、6 阶段、失败重试、debug 面板 | 31 号文档 §12 验收清单全绿；`check:boot` 静态检查绿 | 回退到旧 loader（保留文件） |
| **S4** 构建内核 3d | Hugo 退场 | `build/*.mjs`、模板、RSS/sitemap/robots、图片管线 | 81 个 URL 1:1 对齐；正文文本 diff 为空；构建 < 1.5s | 双构建并存，随时切回 Hugo |
| **S5** 内容与元数据 1.5d | SEO/a11y 补齐 | canonical/OG/JSON-LD、term 页真实列表、front matter schema | 0 个空壳 tag 页；a11y 清单清零；结构化数据校验通过 | 逐条可 revert |
| **S6** 交付与门禁 1d | 自动发布 + 可回滚 | CI、`_headers`、wrangler 部署、回滚演练 | 故意改坏内链/超预算/删 `/posts/` 三次都被拦 | 禁用 workflow 即回退 |
| **S7** 收口 0.5d | 文档同步 | 白皮书/风格指南路径更新、ADR accepted | 新人照 runbook 独立发一版 | — |

### 6.1 阶段依赖

```
S0 ─┬─ S1 ──────────────┬─ S6
    ├─ S2 ── S3 ────────┤
    └─ S4 ── S5 ────────┘
```

S1/S2 可并行；S3 依赖 S2 的 store；S4 独立于 S2/S3（只需 L0 契约），但 S5 依赖 S4 的模板层。

### 6.2 为什么把 S4 放在后面

换构建内核是唯一「改错了会全站挂」的动作。等 S1–S3 把样式、运行时、启动序列都验证过，S4 只需要对一份**已知正确**的页面结构做 parity 对比；反之先换引擎，会在调试构建器的同时调试样式与脚本，故障域重叠。

---

## 7. 质量门禁（可机器执行）

| 门禁 | 命令 | 阈值 / 判据 |
|---|---|---|
| 预算 | `npm run check:budget` | CSS gzip ≤ 9.9 KB；JS gzip ≤ 6.0 KB；首页 HTML gzip ≤ 4.5 KB；单页 ≤ 55 KB |
| 令牌唯一 | `check:tokens` | `tokens.css` 之外 `:root` 出现 0 次；十六进制色值在 `src/` 中命中 0 |
| HTML | `html-validate` | 0 error；`<main>`/`<article>` 覆盖率 100% |
| 链接 | `check:links` | 内部链接 0 死链；`sitemap.xml` URL 数 = 实际 HTML 数 − 404 |
| a11y | `check:a11y` | axe 0 critical；viewport 不禁缩放；aria 属性 > 0 |
| URL parity | `check:parity` | 新旧产物 URL 集合 diff = 空 |
| 视觉回归 | `check:visual` | 6 模板 × 3 视口，像素 diff = 0（S1 之后） |
| **启动真实性** | `check:boot` | 每个 stage 的 `run` 内必须含 `await`/`fetch`/`decode`/`import`；stage 定义中禁止 `setTimeout`；文案行数 = stage 数 |

`check:boot` 是这次架构里最特别的一条：**它把「不许假装」写成了 CI 规则**。

---

## 8. 风险与对策

| 风险 | 触发信号 | 对策 |
|---|---|---|
| 自研构建器低估工作量 | S4 超过 4 人日仍未 parity | 立即切 B 方案：Hugo 只做「Markdown→HTML 片段 + 清单」编译器，运行时内核不变 |
| 首屏变慢（多了一次内核/清单请求） | LCP > 1.2s 或 boot p75 > 2.5s | 关键 CSS 内联、清单 `<link rel=preload>`、boot 与首屏解耦（遮罩 800ms 内必须消失） |
| 国内网络导致清单失败 | 失败率 > 1% | 清单与 HTML 同源同 CDN；失败降级为「无搜索但可读」；不依赖 GitHub |
| 视觉漂移 | 回归 diff 非 0 | 令牌先行、组件后改；S1 只搬家不改值 |
| SEO 回退 | GSC 索引数下降 | 静态 HTML 不变、canonical/OG 补齐、sitemap 保留 |
| 单人维护成本上升 | 月均维护 > 2h | 运行时内核控制在 600 行内；每个模块单一职责；文档即规格 |

---

## 9. 与 V2 文档的关系

| V2 文档 | 处置 |
|---|---|
| `00-current-state.md` | **保留**，作为基线证据 |
| `10-target-architecture.md` §0 I1「Hugo 是唯一构建内核」 | **废止**，由本文 §3 取代 |
| `10-target-architecture.md` I2–I8（令牌、几何、无服务端、文档同源） | **保留**，写入 `check:tokens` |
| `20-migration-roadmap.md` S0/S1/S6（基线、CI、交付） | **保留并吸收**为本文 S0/S6 |
| `20-migration-roadmap.md` S2（Hugo Pipes 资源管线） | **废止**，由 S1 + S4 取代 |
| `metrics/baseline.json` | **保留**，作为预算初始值 |

---

## 10. 需要 YG 确认的 5 件事

1. **D1 构建内核自研**——同意，还是先用 Hugo 过渡？
2. **D5 启动动画策略**——每会话一次 + 2.5s 上限，可接受吗？（现在是最多每 5 分钟一次、6s）
3. **视觉绝对不动**——包括不改 logo、不改色值、不改切角，仅允许新增覆盖层与终端内的失败态。确认？
4. **URL 绝对不动**——`/posts/<slug>/`、`/tags/<name>/` 全部保留，不引入 `/blog/` 之类新路径。确认？
5. **首批实施范围**——先做 S1+S2+S3（约 3.5 人日，用户可见：搜索覆盖层 + 真实启动序列），还是连 S4 一起排期？

---

## 附录 A：V3 一句话对照

| 维度 | 现在 | V3 |
|---|---|---|
| 内容 | Markdown + Hugo 模板 | Markdown + 自有构建内核 |
| 页面 | Hugo 渲染的静态 HTML | 自研渲染的静态 HTML（URL 不变） |
| 样式 | 548 行单体 CSS | 7 层 + 平台分流，令牌唯一 |
| 脚本 | 192 行 9 个 IIFE | 内核 4 模块 + 平台 2 套 + 启动状态机 |
| 加载动画 | 17 行假文案，5.8s | 6 个真实检查点，≤2.5s，可失败可重试 |
| 验收 | 人眼 | 8 条机器门禁 |
| 发布 | 手工 | CI + 原子部署 + 回滚演练 |
