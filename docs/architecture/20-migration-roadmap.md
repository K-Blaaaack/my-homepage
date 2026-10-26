# 迁移路线图：从「手写单仓站点」到「分层静态站点平台」

> 版本 v0.1（草案，待 YG 评审）｜2026-10-26
> 上游文档：[现状审计](00-current-state.md) · [目标架构](10-target-architecture.md) · [流水线原型报告](30-poc-report.md)
> 适用范围：`k-black.top` 全站（Hugo 0.168 extended，141 页，21 篇）

---

## 1. 这份文档解决什么

现状审计告诉我们「哪里薄」，目标架构告诉我们「应该长什么样」，这份文档回答唯一剩下的问题：**按什么顺序改、每步怎么验收、出错怎么退回来。**

三个硬约束贯穿全程：

| 约束 | 含义 | 违反的后果 |
|---|---|---|
| 站点永远可构建 | 任何阶段结束后 `hugo --gc --minify` 必须成功 | 改到一半线上无法发布 |
| 视觉不变 | 设计令牌唯一来源，页面像素级不回归 | 架构升级变成重设计 |
| 每步可回滚 | 阶段末打 tag + 保留上一版产物 | 出问题只能熬夜手改 |

---

## 2. 基线数字（改动前必须记住）

| 指标 | 当前值（审计实测） | 采集方式 |
|---|---|---|
| 全量构建 | **36 ms**（3 次一致，wall 67 ms） | `hugo --gc --minify` |
| 页数 / 产物 | 141 页（81 HTML + 60 XML）/ 163 文件 / 826,482 B | 产物统计 |
| HTML 总量 | 338,217 B（首页 12,819 B，gzip 3,857 B） | 产物统计 |
| CSS | 36,278 B / gzip 9,927 B（`main.css` 14 节）＋ `error.css` 3,225 B（未指纹） | `assets/css` |
| JS | 7,813 B / gzip 3,105 B（192 行） | `assets/js/main.js` |
| 图片 | 343,580 B（webp 269,026 + 图标 74,554） | `content/**` + `static/` |
| 模板层 | 20 文件 / 392 行；11 处内联 style；`aria-*` 数量 0 | `layouts/` |
| 工程化 | 无 CI、无测试、无 tag、无预算门禁、`public/` 停留在 10 月 9 日旧构建 | — |
| 托管 | Cloudflare（Pages 默认头，HTML `max-age=0`） | 线上响应头 |

**任何阶段的验收都以这张表为参照：只能变好，不能变坏。**

审计还挖出三处「数字之外」的结构性问题，它们不是性能问题，而是**架构缺层**，必须在 S3 之前修掉：

1. `layouts/_default/list.html` 是一份**脱离 baseof 的独立 HTML**（无 nav、无 main 地标、只有 error.css），且没有 `range .Pages` → 58 个 tag 页全是 0 链接空壳，占 HTML 页 71.6%，却全进了 sitemap。
2. 元数据层空白：canonical / OG / Twitter / JSON-LD 各 0/81，无 `robots.txt`，首页 RSS 被 `hugo.toml` 关掉；22 页共用同一句 description，16 篇正文的 `summary` 从未被渲染。
3. `public/` 与源码不同步：比源码少 26 个文件（hyps-hub、ai-dev-brief、8 张截图、16 个 tag 页），残留 4 个过期资源，其中两个是无指纹旧文件。

---

## 3. 阶段总览

| 阶段 | 目标 | 投入 | 主要产出 | 退出标准（硬） |
|---|---|---|---|---|
| S0 | 基线冻结 | 0.5 人日 | tag、部署 runbook、产物快照 | 能从 tag 一键重建出与线上一致的产物 |
| S1 | 工程骨架 | 1 人日 | CI 校验链、版本锁定、脚本入口 | PR 上 CI 全绿；故意破坏能被拦 |
| S2 | 资源管线 | 1.5 人日 | CSS 拆分打包、JS 打包、图片管线、SRI | 预算门禁全绿 + 视觉回归零 diff |
| S3 | 内容与元数据 | 1.5 人日 | front matter schema、taxonomy 修正、OG/JSON-LD/RSS/robots | 结构化数据校验通过（含 categories 页） |
| S4 | 能力与交付 | 2 人日 | Pagefind 搜索、a11y 修复、自动发布 + 预览 | 预览环境可用；a11y 清单清零 |
| S5 | 收口 | 0.5 人日 | 文档同步、旧目录归档、ADR 置 accepted | 新人照 runbook 能独立发一版 |

合计约 **7 人日**，按阶段串行、阶段内并行。**不追求一次全上，S0–S2 是必须项，S3–S5 可以按兴趣切片。**

---

## 4. 各阶段任务

### S0 · 基线冻结（0.5 人日）

目的：给后面每一步准备一个「确定的过去」。没有基线，所有「变快了/变慢了」都是感觉。

- [ ] `git tag v1.0-baseline`（**需要 YG 确认后执行**，本次不自动打 tag）
- [ ] 把当前 `public/` 打包成 `backup/releases/2026-10-26.tar.gz`（或记录 Cloudflare 上对应 deployment id）
- [ ] **核对线上与源码的差距**：审计已证实本地 `public/` 停留在 10 月 9 日（缺 26 文件），先确认线上是同一版还是已发新内容，差距写进 runbook。这一步不修任何东西，只把事实钉住
- [ ] 写 `docs/runbook.md`：发布到底怎么发的——`hugo` 后用 wrangler 直传？面板拖拽？命令、账号、域名、回滚入口，全部写死（当前仓库**没有任何部署记录**，这是最大的一处知识缺口）
- [ ] 把 `docs/architecture/metrics/baseline.json` 提交，作为预算门禁的初始值

**退出标准**：换一台机器，照 runbook 能从 tag 重建出与线上完全一致的 `main.<hash>.css` / `main.<hash>.js`。
**回滚**：本阶段只增不改，无需回滚。

---

### S1 · 工程骨架（1 人日）

目的：让「改坏了」这件事在合并前就被发现，而不是在线上。

- [ ] `.github/workflows/ci.yml`：固定 Hugo 版本 → 构建 → HTML 校验 → 内部链接检查 → 体积预算 → Pagefind 索引（原型已具备，见 30-poc-report）
- [ ] 版本锁定：CI 与本地统一 Hugo 版本（`.hugo-version` + workflow `env.HUGO_VERSION`），禁用「本地能构建、CI 不能」的漂移
- [ ] `package.json` 统一入口：`build` / `check` / `preview`，其它脚本一律被这三个调用
- [ ] PR 模板 + 分支保护：CI 必须绿才能合；`docs/` 变更同样走 CI（文档也会写错路径）
- [ ] 冒烟测试：构建后必须存在 `/index.html`、`/posts/index.html`、`/404.html`、`/sitemap.xml`，缺一即失败

**退出标准**：故意改坏一个内链、故意把 CSS 加大 20 KB、故意删掉 `/posts/`，三次都必须被 CI 拦住。
**回滚**：删 workflow 即恢复，不影响构建产物。

---

### S2 · 资源管线（1.5 人日）

目的：把「一个 548 行的 CSS 文件」拆成「一套有层级的样式系统」，同时不增加字节。

- [ ] CSS 拆为 `tokens / base / components / pages / motion` 五层；**`:root` 只允许出现在 tokens 层**，CI 加一条「令牌不得重复定义」的检查
- [ ] Hugo Pipes + postcss(lightningcss) 打包，输出 `main.<hash>.css` + sourcemap；CSS 加 SRI
- [ ] 关键 CSS：首屏（导航 + hero + 公告）内联进 `<head>`，其余异步加载；预算：内联 ≤ 4 KB gzip
- [ ] JS 走 esbuild（target es2020、minify、保留 IIFE），PRTS 启动动画与导航逻辑分块，非首页不加载动画块
- [ ] 图片管线：文章内图片改 page bundle + `.Resources.GetMatch`，输出 webp + `srcset` + 显式 `width/height`（当前 webp 无尺寸属性，CLS 风险点）
- [ ] 静态图标（favicon / logo）从 `static/` 迁到 `assets/` 走指纹，解决「无指纹无法长缓存」
- [ ] 字体决策：维持系统字体栈（现状，0 字节）还是自托管子集（+80~150 KB）；**默认维持现状**，理由写进 ADR-0002

**退出标准**：预算门禁全绿（CSS gzip ≤ 9.5 KB、JS gzip ≤ 3.0 KB、首页 HTML gzip ≤ 3.8 KB），且首页/文章/列表/移动四种视口截图与基线 diff 为 0。
**回滚**：产物是纯增量；保留 `assets/css/main.css` 原件直到 S2 验收通过，删新管线即回退。

---

### S3 · 内容与元数据（1.5 人日）

目的：让「内容」与「模板」彻底解耦，并补上搜索引擎与社交平台需要的信息。

- [ ] 统一 front matter schema：`title / date / updated / summary / tags / categories / series / cover / draft / aliases`，配 `archetypes/posts.md` 模板
- [ ] **修 taxonomy bug**：`hugo.toml` 的 `[taxonomies]` 只声明了 `tag = "tags"`，覆盖了 Hugo 默认值，导致 16 篇带 `categories` 的文章**没有生成 `/categories/` 页面**（产物目录只有 `tags/`）。改为同时声明 `tag`/`category`/`series`
- [ ] 单文件文章 → page bundle：分批迁移（一次 3~5 篇，每批单独 PR），保持 `aliases` 兼容旧 URL
- [ ] SEO：`canonical`、`og:*`、`twitter:card`、`JSON-LD`（`Person` + `BlogPosting`），404 页给 `<meta name="robots" content="noindex">`
- [ ] `robots.txt` + RSS（当前 `outputs.home = ["HTML"]` 关掉了 feed）；`sitemap.xml` 补 `lastmod`
- [ ] 首页写死数据（`layouts/partials/profile.html` 的精选标签）迁入 `data/profile.toml`，与 `data/stack.toml` 一致

**退出标准**：`/categories/技术笔记/` 可访问；每篇文章有 OG 卡片；RSS 解析器可读；结构化数据无报错。
**回滚**：taxonomy 改动会影响 URL 结构，先只加不删；page bundle 迁移逐批可单独 revert。

---

### S4 · 能力与交付（2 人日）

- [ ] **搜索**：Pagefind 索引 + `/search/` 页，键盘可达；中文按「单字 + 双字」切分建索引，权重：标题 > summary > 正文
- [ ] **a11y 清零**：skip link、`main` 地标、burger 加 `aria-expanded`/`aria-label`、去掉 `maximum-scale=1,user-scalable=no`（禁缩放违反 WCAG 1.4.4）、`focus-visible` 全站可见、正文对比度复核
- [ ] **发布自动化**：Cloudflare Pages + wrangler（Actions 内 `pages deploy`），PR 出预览环境、main 出生产；secrets 最小权限（仅 Cloudflare token）
- [ ] **缓存策略**：`_headers` 给 `/css/*` `/js/*` `/img/*` 加 `immutable, max-age=31536000`，HTML 维持短缓存
- [ ] **回滚演练**：一次真实的「发坏 → 用上一版 deployment 回滚 → 记录耗时」演练，写进 runbook
- [ ] 可选：uptime 监控 + 每次发布后跑一次 Lighthouse（预算：LCP < 1.2s，CLS < 0.05，INP < 200ms）

**退出标准**：搜索能用；a11y 清单全清；一次完整发布 + 一次回滚演练完成并留档。
**回滚**：Cloudflare 上一版 deployment 一键回退；CI 部署步骤可单独禁用。

---

### S5 · 收口（0.5 人日）

- [ ] 同步 `docs/视觉设计白皮书.md`：CSS 路径从 `assets/css/main.css` 改为 `assets/css/{tokens,base,components,pages,motion}.css`，并强调「令牌仍只有一份」
- [ ] `docs/ARK-STYLE-GUIDE.md` 增补「拆分后如何复制令牌」小节
- [ ] `backup/` 下的旧静态页（`index.html` 33 KB 等，7 个文件）归档到 `backup/legacy-static/` 并从构建视野移出
- [ ] ADR 全部置为 accepted，README 索引更新，S0–S4 的实测数字回填基线表

---

## 5. 依赖与并行

```
S0 ──> S1 ──> S2 ──┬──> S4 ──> S5
                   │
              S3 ──┘        （S3 可与 S2 并行，但 S3 的 OG 图依赖 S2 的图片管线）
```

- S2 与 S3 可并行推进（写集不重叠：`assets/` vs `content/` + `layouts/`）
- S4 的发布自动化依赖 S1 的 CI 骨架
- S5 必须在全部阶段之后，否则文档会二次漂移

---

## 6. 风险与回滚

| 风险 | 触发信号 | 处置 |
|---|---|---|
| CSS 拆分导致视觉回归 | 截图 diff 出现肉眼可见差异 | 保留 `main.css` 原件，用 `@import` 顺序拼接直到 diff 归零 |
| taxonomy 改动破坏旧 URL | 外部链接 404 | 先加 `aliases`，观察 30 天再清理 |
| CI 卡在依赖安装（无网/慢网） | checkout 后超时 | 依赖锁定 + cache；校验脚本用纯 Node，零依赖优先 |
| Cloudflare token 权限过大 | token 可改 DNS | 只给 Pages 编辑权限，单独建 token |
| 预算门禁误伤 | 正常内容被拦 | 预算按「相对基线不劣化」而非绝对阈值；超标可人工豁免但需写理由 |
| 拆分后令牌漂移 | 两处不同 `--signal` | CI 检查 `:root` 出现次数 = 1 |

**统一回滚口径**：每个阶段一个 tag（`v1.1-s1`…），任何阶段出问题 → `git checkout <上一个 tag>` → 重新构建 → wrangler 部署上一版产物。**不靠"手改回去"。**

---

## 7. 不做清单（同样重要）

| 不做 | 原因 |
|---|---|
| 迁到 Next.js / Astro / SvelteKit | 21 篇文章、0 交互需求，换框架只换来构建复杂度与运行时依赖，收益为负（ADR-0001） |
| 引入 Tailwind 或任何原子化框架 | 现有 CSS 只有 9.9 KB gzip 且令牌体系已成，重写等于把设计契约打散（ADR-0002） |
| 上 CMS / 后台 | 单人维护、Git 就是最好的 CMS |
| 评论系统 / 统计 SDK | 隐私成本 > 价值；需要时用自托管方案单独评估 |
| 客户端水合 / SPA 路由 | 静态站的核心优势是零 JS 也能读；现有 3.1 KB JS 已够用 |
| 自托管全套字体 | 中文字体子集化成本高，系统字体栈在当前设计下已达标（除非视觉回归证明必须） |
| 多语言 i18n | 单语言 zh-cn；预留 `languages` 结构即可，不提前翻译 |

---

## 8. 需要 YG 拍板的 5 件事

1. **发布方式**：继续本地 `hugo` + 手动直传，还是接 GitHub Actions 自动发布（含预览环境）？——影响 S1/S4 的范围
2. **发 tag 权限**：S0 的 `v1.0-baseline` 由谁打、能否接受仓库出现 tag
3. **主题抽离粒度**：`layouts/` 留在本站（目录约定），还是抽成独立 Hugo Module 供其它项目复用？——影响 S3 之后所有路径
4. **字体**：维持系统字体栈（0 成本），还是自托管子集（视觉更稳、体积 +100 KB 量级）
5. **搜索上线时间**：S4 的 Pagefind 是先上（+索引体积约 100~300 KB），还是等内容过 50 篇再上

---

## 9. 验收总表

| 检查项 | 命令 / 方式 | 通过标准 |
|---|---|---|
| 可构建 | `hugo --gc --minify` | 退出码 0，141 页（或更多） |
| 预算 | `npm run check` | 全绿，无超标 |
| 链接 | 内部链接扫描脚本 | 0 死链 |
| 视觉 | 四视口截图 diff | 0 差异（S0 基线对比） |
| 结构化数据 | Schema 校验 | 0 error |
| a11y | 清单逐条 + axe 扫描 | 0 critical |
| 回滚 | runbook 演练 | ≤ 5 分钟恢复上一版 |
