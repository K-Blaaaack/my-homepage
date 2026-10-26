# 10 · 目标架构（V2）：分层、可验证、可自动发布的静态站点平台

> 状态：Accepted ｜ 日期：2026-10-26 ｜ 维护：architect
> 上游：[00-current-state.md](./00-current-state.md)（审计基线） ｜ 下游：[adr/](./adr/) 0001–0006、[30-poc-report.md](./30-poc-report.md)（流水线原型实测）
> 视觉契约：[../ARK-STYLE-GUIDE.md](../ARK-STYLE-GUIDE.md)、[../视觉设计白皮书.md](../视觉设计白皮书.md)
>
> **一句话**：继续用 Hugo 0.168 extended 作为构建内核，不做框架迁移；把当前「单仓手写站点」重整为五层可分离、每层可机器校验、发布可原子回滚的静态站点平台。
>
> **本文只描述目标态与落地动作，不实施站点改动。** 站点文件的改写由后续任务执行，本文给出可复现的命令与配置片段。

---

## 0. 约束与不变量

以下 7 条是架构的"宪法"，任何后续改动不得违反；违反即视为架构回归，须开 ADR。

| # | 不变量 | 含义 | 机器化校验（见 §6.4） |
|---|---|---|---|
| I1 | Hugo 是唯一构建内核 | 不引入 SSR/ISR/客户端框架；产物是纯静态文件 | CI 只跑 `hugo` + 后处理，无 `next/vite build` 入口 |
| I2 | 单一信号色 `#18d1ff` | 全站只有一个强调色；状态色（`--state/--warn/--danger`）仅表状态 | `--signal` 声明次数 = 1 且值固定 |
| I3 | 设计令牌唯一入口 | `theme/kb-ark/assets/css/tokens.css` 是 `:root` 的唯一出现位置 | `:root` 块数 = 1（tokens.css 之外为 0） |
| I4 | 0 圆角 / 1px 线 / 45° 切角 | 视觉几何不因拆分或新增组件而漂移 | 非 0 `border-radius` 出现数 ≤ 2（且值 ≤ 4px） |
| I5 | 无运行时服务端 | 不引入需要常驻进程的能力（搜索、评论均为构建期或第三方静态方案） | 交付层只有静态文件 |
| I6 | 令牌文档与代码同源 | `ARK-STYLE-GUIDE.md` §2.5 的令牌表必须与 `tokens.css` 逐值一致 | 文档↔代码令牌集合 diff 为空 |
| I7 | 内容与表现分离 | 模板不承载自然语言文案；品牌/展示内容走 `data/` 或 front matter | 模板内 ≥6 连续中文字符的命中数纳入告警审计 |
| I8 | 颜色/尺寸只来自令牌或参数 | 模板、内联样式、`<meta>` 中不得出现十六进制色值或魔法尺寸；一律 `var(--x)` 或 `site.Params` 注入 | `layouts/` 与产物 HTML 中十六进制色值命中 = 0（`tokens.css` 之外） |

**为什么把 I3/I6 写成硬约束**：CSS 从 1 个 548 行文件拆成 11 个文件后，"令牌只有一处定义"从"物理事实"退化为"约定事实"。约定必须被 CI 校验，否则第一次热修就会在组件里写死一个 `#18d1ff`，半年后站点出现两种青色。

---

## 1. 分层架构

### 1.1 分层图

```
        ┌──────────────────────── L4 质量层 QUALITY（横切，不产出页面）────────────────────────┐
        │  令牌唯一性 · 体积预算 · HTML 校验 · 内部链接 · a11y · Lighthouse · 视觉契约断言      │
        │  产物：门禁报告 + 非零退出码                                     失败：红线变软 → 漂移  │
        └──────────▲───────────────────────▲───────────────────────▲──────────────────────────┘
                   │ 校验                   │ 校验                  │ 校验
   ┌───────────────┴──────────┐  ┌─────────┴──────────────┐  ┌─────┴───────────────────────┐
   │ L0 内容层 CONTENT        │  │ L1 构建层 BUILD        │  │ L2 资源层 ASSETS            │
   │ content/ data/ static/   │─►│ hugo.toml              │─►│ Hugo Pipes: css/js/img      │
   │ archetypes/              │  │ theme/kb-ark/layouts/  │  │ 拆分 → 打包 → 指纹 → SRI    │
   │ 产物：页面源 + 结构化数据│  │ 产物：public/ 141+ 页  │  │ 产物：main.<hash>.css/js    │
   │ 失败：字段漂移/死链      │  │ 失败：版本漂移/废弃 API│  │ 失败：令牌重复/CSS 不生效   │
   └──────────────────────────┘  └─────────┬──────────────┘  └─────┬───────────────────────┘
                                           │ public/               │ 资源 URL
                                           ▼                       ▼
                              ┌─────────────────────────────────────────────────┐
                              │ L3 交付层 DELIVERY · Cloudflare Pages           │
                              │ 原子部署 · 缓存分层 · 回滚三件套 · 最小权限令牌 │
                              │ 产物：线上 deployment id + 可回滚快照           │
                              │ 失败：缓存中毒/无法回滚/无部署溯源              │
                              └─────────────────────────────────────────────────┘
```

### 1.2 各层职责、产物与失败模式

| 层 | 职责 | 输入 | 产物 | 典型失败模式 | 可观测点 |
|---|---|---|---|---|---|
| **L0 内容层** | 定义"有什么内容、长什么样"；内容作者唯一入口 | Markdown + front matter + `data/*.toml` | 可渲染页面源、taxonomy 词表、结构化展示数据 | ① front matter 字段不一致（现状：`tag` 与 `tags` 并存，3 篇用 `tag`）② 图片散落无 bundle ③ 模板写死文案导致改内容要改代码 | 字段频次统计、bundle 覆盖率、模板中文字符串命中数 |
| **L1 构建层** | 模板渲染、taxonomy/分页/输出格式、站点级配置 | L0 + 主题模板 | `public/`（81 HTML + 60 XML + 静态文件，共 163 文件 / 826,482 B） | ① Hugo 版本漂移（本地 0.168 / 文档记录 CF 曾为 0.147.7）② 废弃 API（当前 `.Site.Data` 告警）③ **模板没有统一骨架**：`_default/list.html` 是独立完整 HTML（19 行，自带 `<head>`、引 `/css/error.css`、不 `range .Pages`）→ **58 个 taxonomy 页全是 0 链接空壳**（实测 `tags/编译` 574 B）④ 颜色写死在模板（`theme-color = #000000`，与 `--ink #080a0b` 冲突） | 构建耗时、页数、WARN 数量、baseof 覆盖率、term 页链接数、模板内色值命中数 |
| **L2 资源层** | CSS/JS/图片/字体的转换、合并、指纹、完整性 | `theme/kb-ark/assets/**`、`static/**`、content 图片 | `main.<hash>.css`、`main.<hash>.js`、`*.webp` 多尺寸 | ① 令牌重复定义漂移 ② 拆分后层叠顺序改变导致样式回退 ③ 固定 URL + 长缓存 → 老 CSS 配新 HTML ④ 图片无宽高 → CLS | 拆包体积、gzip、指纹是否随内容变化、`integrity` 是否存在 |
| **L3 交付层** | 把产物原子地放到边缘、设定缓存语义、支撑回滚 | `public/` + `_headers` + 部署凭证 | CF Pages deployment（不可变）+ 生产别名 | ① 本地直传无溯源 ② HTML 被长缓存 ③ 回滚只能靠"再传一次旧目录" ④ Token 权限过大 | deployment id、响应头（`cache-control`/`cf-cache-status`）、回滚耗时 |
| **L4 质量层** | 把 I1–I7 与预算变成可执行断言；决定"能不能发" | L0–L3 的全部产物 | 门禁报告、阻断结论 | ① 门禁写成 `continue-on-error` ② 预算无基线 ③ 只测首页 ④ 告警阈值靠人肉看 | CI 退出码、预算文件 diff、Lighthouse 分位数 |

**层间契约（单向依赖）**：

- L0 **不得**引用 L1/L2 的内部实现（内容里不写 CSS 类、不写模板函数）。
- L1 **不得**直接拼 CSS/JS 字符串（资源必须走 L2）。
- L2 **不得**读取 `content/`（除 Hugo 图片处理所需的 page resources）。
- L3 **只**消费 `public/` 目录，不执行构建。
- L4 **只读**：不修改任何层，只给结论。

---

## 2. 目录契约

### 2.1 选型：目录约定（推荐）而非 Hugo Module

三个候选及结论（论证见 [adr/0003-theme-extraction.md](./adr/0003-theme-extraction.md)）：

| 方案 | 形态 | 关键成本 | 结论 |
|---|---|---|---|
| **A 目录约定（推荐）** | 仓库根即站点根；表现层收进 `theme/kb-ark/`，用经典 `themesDir` + `theme = ["kb-ark"]` | 一次性 `git mv`；主题/站点边界靠 CI 与评审维持 | **采纳** |
| B Hugo Module | 主题独立仓库，`[[module.imports]]` + `go.mod` 锁版本 | 构建链引入 Go；CI/CF 需 `GOPROXY` 网络；本地迭代需 `replace` | 暂不采纳（触发器见 §7） |
| C `site/` + `theme/` 双根 | 站点源码进 `site/`，主题进 `theme/` | 部署根变更（`hugo -s site`）、Cloudflare 构建设置变更、所有脚本/文档路径改写；单站点无收益 | 暂不采纳 |

**决策理由（一句话）**：单站点、单维护者、现有 Cloudflare Pages 直传链已跑通 → 目录约定用最低迁移成本换来 90% 的分层收益；Module 的复用价值只有在"第二个站点"出现时才兑现，届时再付 Go 工具链的成本。

### 2.2 目标文件树

```
my-homepage/
├── hugo.toml                     # L1：站点配置（唯一构建入口；含 theme/themesDir）
├── package.json                  # L2：构建工具链（postcss/lightningcss/pagefind/html-validate…）
├── package-lock.json             #      版本锁定（CI 用 npm ci）
├── postcss.config.cjs            # L2：CSS 转换配置（lightningcss）
├── archetypes/
│   └── posts.md                  # L0：新文章骨架（强制 front matter schema，见 §4.1）
├── content/                      # L0：内容（page bundle 优先）
│   ├── posts/<slug>/index.md     #      文章 + 同目录媒体
│   ├── stack/index.md            #      技术栈页（type: stack）
│   └── pages/{info,wip}.md       #      独立页
├── data/                         # L0：结构化展示数据（links / news / stack / profile）
│   ├── links.toml
│   ├── news.toml
│   ├── stack.toml
│   └── profile.toml              #      新增：承接 profile.html 里写死的文案
├── static/                       # L3 透传：站点级、非处理资产
│   ├── _headers                  #      CF Pages 缓存与安全头
│   ├── _redirects                #      可选：由 aliases 生成（脚本产出）
│   ├── robots.txt                #      或由 hugo.toml enableRobotsTXT 生成
│   ├── CNAME                     #      自定义域记录（Pages 下仅作文档用途）
│   ├── favicon*.png|ico          #      品牌图标（站点级，不进主题）
│   ├── apple-touch-icon.png
│   ├── icon-192.png / icon-512.png
│   └── img/{logo-square.svg, logo-wide.svg}
├── theme/
│   └── kb-ark/                   # L1+L2：表现层（唯一主题）
│       ├── theme.toml
│       ├── layouts/
│       │   ├── _default/{baseof,single,list}.html
│       │   ├── partials/
│       │   │   ├── head/{css,js,critical,meta,opengraph,jsonld,loader}.html
│       │   │   ├── nav.html hero.html news.html profile.html links.html
│       │   │   ├── about.html footer.html svg-defs.html loader.html
│       │   │   └── skip-link.html
│       │   ├── posts/{list,single}.html
│       │   ├── stack/single.html
│       │   ├── taxonomy.html / term.html      # 新增：替换当前无 baseof 的 list.html
│       │   └── 404.html
│       ├── assets/
│       │   ├── css/
│       │   │   ├── tokens.css                 # ★ 唯一 :root（令牌唯一来源）
│       │   │   ├── base.css                   # reset + html/body + 链接/focus/selection
│       │   │   ├── layout.css                 # nav/mob/sec/foot/page-box 骨架
│       │   │   ├── components/{hero,panel,tabs,list,chip,button,badge,card,loader,chroma}.css
│       │   │   ├── pages/{post,stack,error}.css
│       │   │   └── motion.css                 # .rv/.vis + 兜底动画 + reduced-motion
│       │   └── js/
│       │       ├── main.js                    # 入口：import 下列模块
│       │       ├── modules/{boot,scrollspy,inpage,burger,tabs,reveal,copy,hero-date,particles}.js
│       │       └── preflight.js               # 可选：抽离的 pre-paint gate（见 §3.5）
│       └── static/                            # 主题通用资产（本次为空；品牌图不进主题）
├── scripts/ci/                   # L4：门禁脚本（pipeline 负责实现，本文件只定义契约）
│   ├── check-tokens.mjs
│   ├── check-links.mjs
│   └── check-budget.mjs
├── docs/                         # 文档（不发布）
│   ├── ARK-STYLE-GUIDE.md
│   ├── 视觉设计白皮书.md
│   └── architecture/{00,10,30}-*.md, adr/, metrics/
├── backup/                       # 冻结归档（不参与构建）
│   └── README.md                 #      说明"只读、勿从 backup 取资产"
├── nextgen/                      # 流水线原型输出（pipeline 所有，git 忽略产物）
└── public/                       # 构建产物（git 忽略；CI 产物）
```

**为什么不把站点也塞进 `site/`**：单站点下，`site/` 目录只是给"多站点单仓"预留的概念，代价是部署根、脚本、文档路径全改，收益为零。保持"仓库根 = 站点根"让 `hugo` 无参数可跑、让 Cloudflare 构建设置不动、让所有 `content/...` 相对路径继续有效。

### 2.3 迁移映射表（覆盖当前每个目录）

当前实测：20 个模板文件 / 392 行；CSS 1 文件 548 行 / 36,278 B（gzip 9,962 B）；JS 1 文件 192 行 / 7,813 B（gzip 3,106 B）；Hugo 0.168.0 extended，141 页，构建 43 ms，`public/` 1.3 M。

| 当前路径 | 目标路径 | 动作 | 备注 / 风险 |
|---|---|---|---|
| `hugo.toml` | `hugo.toml`（原地改） | 改配置 | 增 `theme`/`themesDir`、`outputs.home=[HTML,RSS]`、`taxonomies` 增 category/series、`enableRobotsTXT`、`imaging`、`markup` 保留；版本基线写入注释 |
| `content/posts/*.md`（单文件） | `content/posts/<slug>/index.md` | 转为 page bundle | 17 篇单文件；无图的可暂不转，但新内容必须 bundle（§4.2）；`git mv` 保历史 |
| `content/posts/{hyps-hub,ai-dev-brief,poweredge-r730-fanctl}/index.md` | 原地 | 不改 | 已是 bundle（3 个 + stack 共 4 个） |
| `content/stack/index.md` | 原地（`type: "stack"`） | 不改 | 顶层 leaf bundle 的 `.Type` 陷阱已在白皮书 §9 记录，保留显式 `type` |
| `content/{info,wip,测试}.md` | `content/pages/{info,wip}.md`；`测试.md` 删除或改 `draft: true` | 移动/清理 | `测试.md` 是占位内容，会污染 sitemap 与搜索结果 |
| `content/posts/a-posts.md`（未跟踪） | 决定去留 | 清理 | `git status` 唯一未跟踪文件；不得带进 V2 基线 |
| `layouts/`（20 文件 / 392 行） | `theme/kb-ark/layouts/` | `git mv` 整体 | 保留目录结构；`partials/head/*` 随之进入主题 |
| `layouts/_default/list.html` | `theme/.../layouts/taxonomy.html` + `term.html` | **重写** | 当前是绕过 baseof 的独立 HTML（自带 `<head>`、引 `/css/error.css`），是"两套 head"的根源 |
| `layouts/404.html` | `theme/.../layouts/404.html` | 重写走 baseof | 去掉 `/css/error.css` 第二套样式表 |
| `layouts/partials/{hero,nav,news,profile,links,about,footer,svg-defs,loader}.html` | 同名进主题 `partials/` | 移动 | `profile.html` 的写死文案抽到 `data/profile.toml` |
| `layouts/partials/head/{css,js,loader}.html` | 主题 `partials/head/`，新增 `critical.html`、`meta.html`、`opengraph.html`、`jsonld.html` | 移动 + 扩展 | `css/js` 改写为 §3.3 管线；`loader.html` 改名为 `preflight.html`（pre-paint gate） |
| `assets/css/main.css`（548 行 / 14 节标题） | `theme/kb-ark/assets/css/` 11 个文件 | **拆分** | 拆分映射见 §3.1；**层叠顺序不得改变** |
| `assets/js/main.js`（192 行 / 8 个 IIFE） | `theme/kb-ark/assets/js/main.js` + 9 个模块 | **拆分** | 模块边界见 §3.5；行为不变 |
| `static/css/error.css`（3,225 B） | `theme/kb-ark/assets/css/pages/error.css` | **并入管线** | 目标态不再有第二套未指纹化样式表 |
| `static/img/logo-{square,wide}.svg` | `static/img/`（**不动**） | 保留 | 品牌资产属站点，不进主题；主题通过 `params.logo*` 读取 |
| `static/favicon*`、`static/icon-*`、`static/apple-touch-icon.png` | `static/`（**不动**） | 保留 | 浅色主题 favicon 变体为已知待办（白皮书 §7.3 / §9 #9） |
| `static/CNAME` | `static/CNAME`（**不动**） | 保留 | CF Pages 自定义域由平台维护；文件仅作记录 |
| `data/{links,news,stack}.toml` | `data/`（原地，改消费方式） | 改模板 | `.Site.Data.*` → `hugo.Data.*`（Hugo 0.156+ 新 API），消除构建 WARN |
| `backup/`（7 文件，旧纯静态版） | `backup/`（**不动**） | 冻结 | 不参与构建、不被引用；加 `backup/README.md` 说明"只读归档" |
| `docs/` | `docs/`（原地）+ 新增 `architecture/` | 扩展 | 不发布；`docs/architecture/*` 为 V2 文档集 |
| `public/` | `public/`（**不进版本库**） | 保持忽略 | 现状 1.3 M；V2 由 CI 产出并以产物快照归档 |
| `resources/` | 原地忽略 | 不变 | Hugo 图片/资源缓存；CI 每次干净构建 |
| `.hugo_build.lock`、`.playwright-mcp/`、`opencode.json` | 原地 | 不变 | 非架构资产 |
| `.github/`（当前**不存在**） | 新增 `workflows/{ci,deploy}.yml` | 新增 | 见 §5；由 pipeline 实现，本文件给契约 |

### 2.4 主题/站点边界规则（可评审、可 grep）

1. 主题内**不得**出现 `K-Black`、邮箱、GitHub 账号等站点身份信息 —— 一律走 `site.Params`。
2. 主题内**不得**读取 `data/`（数据属站点）—— 需要数据时由站点模板把数据作为 `dict` 传给主题 partial。
3. 主题内**不得**引用站点 `static/` 具体文件名 —— 通过 `params.logoSquare` 之类参数注入。
4. 站点内**不得**再出现 `assets/css/*.css` 与 `layouts/`（迁移完成后目录应不存在）；站点级覆盖只允许 `assets/css/site-overrides.css`（且不得声明 `--signal`）。
5. 主题 `layouts/` 的文件名与 `hugo.toml` 的输出格式一一对应，禁止"游离的独立 HTML"。

CI 断言（全部为阻断项）：

```bash
# 1) 主题不含站点身份
! rg -n 'K-Black|k-black@|K-Blaaaack' theme/kb-ark/layouts theme/kb-ark/assets
# 2) 主题不读 data/
! rg -n 'hugo\.Data|\.Site\.Data' theme/kb-ark/layouts
# 3) 站点不再有平行模板/样式目录
test ! -d layouts && test ! -e assets/css
```

---

## 3. 资源架构（L2）

### 3.1 CSS 拆分：548 行 → 11 文件，层叠顺序不变

拆分原则：**物理拆分、逻辑不变**。当前 14 个分节标题按出现顺序映射为文件与文件内顺序，`@import` 一律不用（顺序只由 `partials/head/css.html` 的显式列表决定，见 §3.3）；v1 **不引入 `@layer`**（会改变层叠语义，属独立 ADR）。

| 现 `main.css` 分节 | 行范围（约） | 目标文件 | 预估行数 |
|---|---|---|---|
| 01 Reset | 26 | `base.css` | ~15 |
| 02 Design Tokens | 29–86 | **`tokens.css`** | ~60 |
| 03 Stage（html/body/链接/focus/selection） | 89–107 | `base.css` | ~25 |
| 04 Geometry（45° 切角） | 110–120 | `components/panel.css`（`.cut` 与面板共用） | ~15 |
| 05 Atmosphere（粒子/光池/扫描线） | 123–148 | `components/hero.css` | ~30 |
| 06 Topbar & Navigation | 151–184 | `layout.css`（nav/mob）+ `components/badge` 无关 | ~40 |
| 07 Hero | 187–213 | `components/hero.css` | ~30 |
| 08 Section System | 216–229 | `layout.css` | ~15 |
| 09 Components（徽标/面板/Tab/列表/Chip/按钮） | 232–312 | `components/{badge,panel,tabs,list,chip,button}.css` | ~90 |
| 10 Page Blocks（档案/技术栈/链接/关于/页脚/独立页） | 315–398 | `layout.css` + `pages/{stack,error}.css` + `components/card.css` | ~90 |
| 11 Content（正文/代码/chroma/PRTS 终端） | 401–493 | `pages/post.css` + `components/{chroma,loader}.css` | ~90 |
| 12 Motion（.rv/.vis/兜底） | 496–515 | `motion.css` | ~25 |
| 13 Desktop Spacing | 518–524 | `layout.css`（追加在文件末，保持后置） | ~5 |
| 14 Responsive & Accessibility | 527–548 | `layout.css` 末尾 + `motion.css`（reduced-motion 部分） | ~20 |

**顺序契约**（写死在一个地方，`partials/head/css.html`）：

```
tokens.css → base.css → layout.css → components/*.css（按字母序但显式列举）
→ pages/*.css → motion.css
```

最后两条尤其不可换位：`motion.css` 里 `.rv` 与 `html.prts-skip` 依赖出现在 `layout.css` 之后才能覆盖；`pages/post.css` 的 `.post-content` 选择器权重低于 `components/*`，顺序变动会改变覆盖关系。**验收方法**：拆分前后对同一批页面截图逐像素比对（见 §6.2「渲染等价」）。

### 3.2 令牌唯一来源（I3/I6）与防漂移

**权威链路（单向，禁止旁路）**：

```
docs/ARK-STYLE-GUIDE.md §2.5（人读契约）
        ⇅ 必须逐值一致（CI diff）
theme/kb-ark/assets/css/tokens.css  ← 唯一 :root 定义（机器唯一来源）
        ↓ var(--x) 只读引用
base/layout/components/pages/motion
```

`tokens.css` 的结构（与现行 02 节逐值一致，仅去掉"兼容层"别名——别名保留但集中在 `tokens.css` 末尾的 `/* compat */` 区，且 CI 断言别名只指向已声明令牌）：

```css
/* tokens.css · v1 · 唯一 :root。任何组件不得声明设计令牌。 */
:root{
  /* ink / paper / signal / state / type / tracking / geometry / motion / texture */
  --ink:#080a0b; --ink-2:#0e1112; --ink-3:#141819; --ink-4:#1a1f21;
  --rule:#242a2d; --line:#333b3f; --line-h:#4a5459;
  --paper:#f4f6f6; --paper-2:#c3cbcd; --muted:#8d9396; --disabled:#5a6165;
  --signal:#18d1ff; --signal-d:#0f9dc4; --signal-dim:rgba(24,209,255,.12);
  --state:#c8eb21; --warn:#e0a34a; --danger:#e0524f;
  --cut-lg:14px; --cut-md:10px; --cut-sm:7px; --cut-xs:4px;
  --t-fast:.18s; --t-base:.28s; --t-slow:.35s; --t-reveal:.7s;
  --ease:cubic-bezier(.22,.8,.2,1); --ease-out:ease-out;
}
```

**四道防漂移闸门**（`scripts/ci/check-tokens.mjs` 的契约，pipeline 实现）：

```bash
cd theme/kb-ark/assets/css

# ① :root 只允许出现在 tokens.css（其余文件 0 命中）
rg -n ':root\s*\{' --glob '*.css' --glob '!tokens.css' && exit 1

# ② --signal 全仓只声明一次，且值必须是 #18d1ff
test "$(rg -o --no-filename '^\s*--signal\s*:' . | wc -l)" -eq 1 || exit 1
test "$(rg -o --no-filename '--signal\s*:\s*#[0-9a-fA-F]{6}' . | tr 'A-F' 'a-f')" = "--signal:#18d1ff" || exit 1

# ③ 组件内不得硬编码颜色（tokens.css 之外，0 命中；豁免须同行写 /* token-exempt: 原因 */）
rg -n '#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[0-9]' --glob '*.css' --glob '!tokens.css' \
  | rg -v 'token-exempt' && exit 1

# ④ 文档↔代码令牌集合一致（I6）：两边都输出 "名:值" 排序后 diff
rg -o --no-filename -- '--[a-z0-9-]+:#[0-9a-fA-F]{3,8}' tokens.css | sort > /tmp/code.tokens
awk '/^```css/{f=1;next}/^```/{f=0}f' ../../../../../docs/ARK-STYLE-GUIDE.md | rg -o -- '--[a-z0-9-]+:#[0-9a-fA-F]{3,8}' | sort > /tmp/doc.tokens
diff -u /tmp/doc.tokens /tmp/code.tokens || exit 1

# ⑤ 引用的令牌必须已声明（未声明 var() = 运行时静默失效）
rg -o --no-filename 'var\(\s*--[a-z0-9-]+' --glob '*.css' | sed 's/var(\s*//' | sort -u > /tmp/used
rg -o --no-filename '^\s*(--[a-z0-9-]+)\s*:' tokens.css | tr -d ' :' | sort -u > /tmp/decl
comm -23 /tmp/used /tmp/decl | (! read -r _) || { echo "undeclared token"; exit 1; }
```

**豁免机制**：允许组件声明**私有**变量（`--_cut`、`--_gap`），规则是必须以 `--_` 开头并在同一规则块内使用；CI 断言 `--[a-z]`（非 `--_`）的声明只出现在 `tokens.css`。

**变更流程**：改令牌 = 同时改 `tokens.css` + `ARK-STYLE-GUIDE.md` §2.5 + `视觉设计白皮书.md` §2 + 在 `tokens.css` 顶部 bump `v1.x` 注释；四处缺一即 CI 红。

### 3.3 打包、指纹与 SRI

工具链（`package.json`，版本锁定，CI 用 `npm ci`）：

```json
{
  "name": "my-homepage-build",
  "private": true,
  "scripts": {
    "css:build": "postcss theme/kb-ark/assets/css/bundle.css -o /tmp/x.css"
  },
  "devDependencies": {
    "postcss": "8.5.x",
    "postcss-cli": "11.x",
    "postcss-lightningcss": "1.x",
    "lightningcss": "1.x",
    "pagefind": "1.x",
    "html-validate": "9.x",
    "@lhci/cli": "0.14.x"
  }
}
```

`postcss.config.cjs`（CSS 嵌套 + 浏览器目标 + 生产压缩）：

```js
const lightning = require("postcss-lightningcss");
const prod = process.env.NODE_ENV === "production";
module.exports = {
  plugins: [
    lightning({
      browsers: "chrome >= 100, firefox >= 100, safari >= 15, edge >= 100",
      lightningcss: { minify: prod, sourceMap: !prod, drafts: { nesting: true } },
    }),
  ],
};
```

`partials/head/css.html`（**唯一的资源顺序定义 + 指纹 + SRI**）：

```go-html-template
{{- $parts := slice
  "css/tokens.css" "css/base.css" "css/layout.css"
  "css/components/hero.css" "css/components/panel.css" "css/components/tabs.css"
  "css/components/list.css" "css/components/chip.css" "css/components/button.css"
  "css/components/badge.css" "css/components/card.css" "css/components/loader.css"
  "css/components/chroma.css"
  "css/pages/post.css" "css/pages/stack.css" "css/pages/error.css"
  "css/motion.css" -}}
{{- $res := slice -}}
{{- range $parts }}{{ with resources.Get . }}{{ $res = $res | append . }}{{ end }}{{ end -}}
{{- $css := resources.Concat "css/bundle.css" $res
      | css.PostCSS (dict "config" "postcss.config.cjs")
      | fingerprint "sha384" -}}
<link rel="stylesheet" href="{{ $css.RelPermalink }}"
      integrity="{{ $css.Data.Integrity }}" crossorigin="anonymous">
```

要点：

- `resources.Concat` 负责**合并**（顺序即层叠顺序，无需 `@import`/`postcss-import`）；`css.PostCSS` 负责**转换与压缩**；`fingerprint` 负责**内容哈希 + SRI**。
- 生产 `NODE_ENV=production` 由 CI 设置（`env: NODE_ENV: production`），Hugo 调用的是本机 `postcss` 二进制，因此 CI 必须先 `npm ci`；CF Pages Git 集成同样会跑 `npm ci`。
- 文件名形如 `css/bundle.<sha384>.css`（Hugo 默认用 hex hash 作文件名），配合 `_headers` 的 `immutable`。
- `hugo server` 下不设 `NODE_ENV`，输出 sourcemap 便于调试；CI 断言产物无 `.map`。

### 3.4 关键 CSS 内联

首屏（顶栏 + Hero + 兜底显现）内联，其余走 `<link>`：

```go-html-template
{{- /* critical: tokens + base + nav + hero + motion 兜底，≤ 8 KB raw */ -}}
{{- $crit := slice "css/tokens.css" "css/base.css" "css/layout.css"
      "css/components/hero.css" "css/motion.css" -}}
{{- $r := slice }}{{ range $crit }}{{ with resources.Get . }}{{ $r = $r | append . }}{{ end }}{{ end }}
{{- $inline := resources.Concat "css/critical.css" $r
      | css.PostCSS (dict "config" "postcss.config.cjs") | minify -}}
<style>{{ $inline.Content | safeCSS }}</style>
<link rel="preload" as="style" href="{{ $css.RelPermalink }}"
      integrity="{{ $css.Data.Integrity }}" crossorigin="anonymous"
      onload="this.rel='stylesheet';this.onload=null">
<noscript><link rel="stylesheet" href="{{ $css.RelPermalink }}"></noscript>
```

- 预算：内联 CSS ≤ **8 KB raw**（当前 tokens+base+hero+motion 约 11 KB 源码，压缩后约 5.5 KB，留 30% 余量）。
- 首屏不使用 `onload` 的 `media="print"` 技巧（Safari 兼容差异），用 `rel=preload` + `onload` + `noscript` 兜底。
- 解析顺序：内联 `<style>` 必须在 `<link rel=preload>` 之前，避免 FOUC 期间样式为空。

### 3.5 JS：Hugo 内嵌 esbuild，无需 Node

现状 192 行 = 8 个 IIFE（PRTS 启动、导航 scroll spy、页内滚动、burger、tabs、reveal、代码复制、hero 日期、粒子）。拆成 ESM 模块，**行为保持不变**；入口显式 import，`js.Build` 打包为 IIFE（保持全局执行语义，避免改成 module 后 defer 时序变化）。

```go-html-template
{{- $opts := dict "target" "es2020" "format" "iife"
      "minify" (not hugo.IsDevelopment)
      "sourceMap" (cond hugo.IsDevelopment "linked" "") -}}
{{- $js := resources.Get "js/main.js" | js.Build $opts | fingerprint "sha384" -}}
<script src="{{ $js.RelPermalink }}" integrity="{{ $js.Data.Integrity }}"
        crossorigin="anonymous" defer></script>
```

模块划分（每个模块自带 `init()`，入口按需调用）：

| 模块 | 职责 | 触发条件 |
|---|---|---|
| `boot.js` | PRTS 启动序列（17 行、进度条、6s 收尾、cookie） | `.loader` 存在时 |
| `scrollspy.js` | 导航高亮（`ids=["news","profile","links","about"]`） | 首页 |
| `inpage.js` | 页内锚点平滑滚动拦截 | 首页 |
| `burger.js` | 移动菜单开合（**补 `aria-expanded`/`aria-label`**） | `#burger` 存在 |
| `tabs.js` | 公告筛选 | `.tab` 存在 |
| `reveal.js` | IntersectionObserver + `.rv` 兜底 | 始终 |
| `copy.js` | 代码复制按钮 | `.post-content pre` 存在 |
| `hero-date.js` / `particles.js` | Hero 日期、20 个粒子 | 首页 |

**内联脚本收敛**：现状有 2 段内联 `<script>`（`head/js.html` 的运行时长计算、`head/loader.html` 的 pre-paint gate）。目标：

- 运行时长计算 → 并入 `boot.js`（读 `data-start`/`data-deploy` 属性，参数由模板写入，避免内联）。
- pre-paint gate **必须**保留内联（要在 `<body>` 解析前给 `<html>` 打 `prts-skip`），但收敛为**唯一一段**内联脚本，其 `sha256` 写入 CSP（§7）。

**行为等价验收**：拆分后用无头浏览器对比拆分前后的 `.loader` 出现/隐藏时序、`.rv.vis` 数量、cookie 写入、tab 切换结果（§6.2）。

### 3.6 字体：默认不自托管；启用须过预算与授权

与白皮书 §2.4 一致：**默认零 WebFont**，纯本地回退（`--cjk/--display/--tech/--serif/--mono`）。若未来要锁定显示字体，按以下条件执行（缺一不可）：

1. 字体授权允许 Web 分发（HarmonyOS Sans / MiSans 等需自行确认，白皮书 §7.3/附录 D.3）。
2. 子集化后总量 ≤ **120 KB woff2**，face 数 ≤ 2。
3. `font-display: swap` + `rel=preload` + 仅 ASCII/拉丁子集（CJK 正文用系统栈，永不全量自托管）。

```bash
# 子集：只取 logo/标题用到的字形，拉丁 + 少量标点
pyftsubset display.ttf --text-file=glyphs.txt --flavor=woff2 \
  --layout-features='kern,liga' --no-hinting --desubroutinize \
  --output-file=theme/kb-ark/static/fonts/kb-display.woff2
```

> 现状：`logo-*.svg` 内已用子集化字体（1081 KB → 3.7 KB，白皮书 §7.1），不需要额外 WebFont。**V2 不引入新字体**。

### 3.7 图片管线

规则：

1. 文章图片必须与 `index.md` 同目录（page bundle），用 shortcode 引用，禁止直接写 `<img src="...">`。
2. 统一输出 WebP，`q=82`，最长边 ≤ 1200 px；`srcset` 480/768/1200。
3. **必须**带 `width`/`height`（防 CLS）与 `loading`（首图 `eager` + `fetchpriority=high`，其余 `lazy`）。
4. 单文图片总量 ≤ **1.5 MB**；单图 ≤ **500 KB**（CI 预算）。

```go-html-template
{{/* layouts/shortcodes/img.html */}}
{{- $src := .Get "src" -}}
{{- $res := .Page.Resources.GetMatch $src -}}
{{- if not $res }}{{ errorf "img: %q not found in bundle %s" $src .Page.File.Path }}{{ end -}}
{{- $w := slice 480 768 1200 -}}
{{- $set := slice -}}
{{- range $w -}}
  {{- $v := $res.Resize (printf "%dx webp q82" .) -}}
  {{- $set = $set | append (printf "%s %dw" $v.RelPermalink $v.Width) -}}
{{- end -}}
{{- $hi := $res.Resize "1200x webp q82" -}}
<img src="{{ $hi.RelPermalink }}" srcset="{{ delimit $set ", " }}"
     sizes="(max-width: 768px) 100vw, 780px"
     width="{{ $hi.Width }}" height="{{ $hi.Height }}"
     loading="{{ .Get "loading" | default "lazy" }}"
     {{ if eq (.Get "loading") "eager" }}fetchpriority="high"{{ end }}
     decoding="async" alt="{{ .Get "alt" | default "" }}">
```

`hugo.toml`：

```toml
[imaging]
  quality = 82
  resampleFilter = "lanczos"
  [imaging.webp]
    quality = 82
```

---

## 4. 内容模型（L0）

### 4.1 统一 front matter schema

现状字段频次：`title` 21、`draft` 18、`date` 18、`tags` 16、`summary` 16、`categories` 16、`tag` 3（独立页）、`type` 1。缺失：`description`、`series`、`cover`、`updated`、`aliases`、`lastmod`。

目标 schema（TOML 或 YAML 均可，站点内统一一种；Hugo 两者都支持）：

| 字段 | 类型 | 必填 | 约束 | 用途 |
|---|---|---|---|---|
| `title` | string | ✅ | ≤ 60 字（CJK 计 2） | `<title>`/OG |
| `date` | datetime | ✅ | ISO 8601 带时区 | 排序、RSS、JSON-LD |
| `description` | string | ✅ | 40–120 字 | meta description / OG / 搜索结果摘要 |
| `summary` | string | ⬜ | ≤ 200 字 | 列表页摘要（缺省回退 `description`） |
| `draft` | bool | ✅ | 生产构建必须 false | 草稿隔离 |
| `tags` | string[] | ✅ | 1–6 个 | taxonomy `tags` |
| `categories` | string[] | ✅ | 恰好 1 个，白名单内 | taxonomy `categories` |
| `series` | string | ⬜ | 与 `series_weight` 成对 | taxonomy `series`，连载导航 |
| `series_weight` | int | ⬜ | 1–999 | 系列内排序 |
| `cover` | table | ⬜ | `{image, alt, caption}`；`image` 必须在 bundle 内 | 列表卡/OG 图 |
| `updated` | datetime | ⬜ | ≥ `date` | 展示"更新于"；缺省用 `lastmod`（git） |
| `aliases` | string[] | ⬜ | 以 `/` 开头且以 `/` 结尾 | 旧链接迁移（Hugo 生成跳转页） |
| `slug` | string | ⬜ | 小写连字符 | 自定义 URL |
| `type` | string | ⬜ | `posts`/`stack`/`page` | 顶层 leaf bundle 的选择器（`.Type` 陷阱） |
| `toc` | bool | ⬜ | 默认 false | 文章目录 |
| `robots` | string | ⬜ | 默认 `index,follow` | 单页索引控制 |
| `sitemap` | table | ⬜ | `{priority, changefreq}` | sitemap 微调 |

`archetypes/posts.md`（新文章骨架，`hugo new posts/<slug>/index.md` 生成）：

```toml
+++
title = "{{ replace .File.ContentBaseName "-" " " | title }}"
date = {{ .Date }}
description = ""
summary = ""
draft = true
tags = []
categories = ["技术笔记"]
# series = ""
# series_weight = 10
# cover = { image = "cover.webp", alt = "" }
# updated = {{ .Date }}
# aliases = []
+++
```

CI 断言（阻断）：`description` 缺失/超长、`categories` 不在白名单、`series` 无 `series_weight`、`cover.image` 不存在于 bundle、`draft=true` 出现在已发布（非 PR）分支。

### 4.2 page bundle 规范

- **有媒体 → 必须 bundle**：`content/posts/<slug>/index.md` + `cover.webp` + `screenshots/*.webp`。
- **纯文本 → 允许单文件**：`content/posts/<slug>.md`。迁移期保留存量单文件，新内容强制 bundle。
- 图片引用一律 `![alt](相对路径)` 或 `{{</* img src="..." alt="..." */>}}`，禁止外链图床（可用性与隐私）。
- 文件名小写、连字符；中文文件名仅允许在 `content/` 正文，不进 URL（用 `slug` 覆盖）。

### 4.3 taxonomy 保留策略

```toml
[taxonomies]
  tag = "tags"
  category = "categories"
  series = "series"
```

| taxonomy | 决策 | 规则 |
|---|---|---|
| `tags` | **保留** | 自由词表；每篇 1–6 个；大小写归一；禁止与 category 同义重复 |
| `categories` | **保留但收紧** | 白名单 3 个：`技术笔记`、`站点公告`、`生活记录`；新增需改本节 + CI 白名单（一次 PR） |
| `series` | **新增** | 仅用于 ≥3 篇的连载（如"内核编译"）；词表由 front matter 自然生成，不另建数据文件 |

- 每个 taxonomy 必须有权重化 term 页模板（`taxonomy.html`/`term.html`，走 baseof），当前缺失。
- term 页需 `noindex` 之外的正常索引；`/tags/` 与 `/categories/` 进入 sitemap。
- 词表膨胀治理：`tags` 超过 60 个不同值、或单 tag 仅 1 篇时，CI 告警（不阻断），提示合并。

### 4.4 草稿与预览流程

| 场景 | 命令 | 说明 |
|---|---|---|
| 本地写作 | `hugo server -D --navigateToChanged --port 1313` | 含草稿；`--renderToMemory` 仅在 `public/` 权限异常时加（白皮书 §10.3） |
| PR 预览 | CF Pages **preview deployment**（`--branch=pr-<n>`） | 只读预览 URL，不替换生产别名 |
| 生产构建 | `hugo --gc --minify --enableGitInfo --panicOnWarning` | `--panicOnWarning` 让废弃 API 直接失败（迁移完成后开启） |
| 单页校验 | `hugo --renderToMemory --printPathWarnings --printUnusedTemplates` | 模板未使用/路径冲突可见 |

规则：`draft: true` 的内容不得进入生产构建；`future: true` 同理。PR 流水线允许 `--buildDrafts` 但产物只用于预览，不上传生产。

### 4.5 数据文件契约

- `data/*.toml` 是**展示性内容**的唯一入口；模板不再写死自然语言（I7）。
- 访问方式统一 `hugo.Data.<file>`（Hugo 0.156+），消除当前 5 处 `.Site.Data` 废弃告警。
- 新增 `data/profile.toml`：承接 `layouts/partials/profile.html` 里写死的自我介绍、技术栈精选、兴趣标签。
- schema 轻校验：每个数据文件必须有顶层 `[[items]]` 或 `[[groups]]` 或 `[featured]`，字段缺失时 CI 报错（避免模板静默渲染空块）。

```toml
# data/profile.toml（目标）
[intro]
  label = "INTRODUCTION"
  heading = "关于我"
  paragraphs = ["…", "…"]

[stack]
  label = "STACK 技术栈"
  heading = "技术栈"
  tags = ["Linux", "Arch Linux", "Kernel 编译"]

[interests]
  label = "INTERESTS 兴趣"
  heading = "兴趣"
  tags = ["开源软件 / 技术分享", "Homelab / NAS"]
```

---

## 5. 交付架构（L3）

### 5.1 现状（实测，2026-10-26）

| 项 | 结论 | 证据 |
|---|---|---|
| 托管平台 | **Cloudflare**（边缘） | `k-black.top` A/AAAA 指向 `2606:4700:30xx`；响应头 `server: cloudflare` |
| 产品形态 | **Cloudflare Pages**（Direct Upload 特征） | HTML 响应 `cache-control: public, max-age=0, must-revalidate`（Pages 默认）、`cf-cache-status: DYNAMIC`、带 `speculation-rules` |
| GitHub Pages | **未启用** | `gh api repos/K-Blaaaack/my-homepage/pages` → 404，`has_pages=false` |
| 仓库 CI | **无** | 无 `.github/`；无 tags |
| 发布方式 | **待确认**：极可能是本地 `hugo` 后 `wrangler pages deploy` 或面板直传 | 无 workflow、无 tags、无部署记录 |
| 产物一致性 | 线上 = 当前 main 构建 | 线上引用 `main.e4295677….css` / `main.aa85e15….js`，与本地 `hugo --gc --minify` 指纹一致，无二次加工 |
| 缓存现状 | HTML 短缓存（`max-age=0`），资产同为短缓存 | 资产未设 `immutable`，指纹化收益未兑现 |

> 结论：**发布链路完全手工、无溯源、无回滚预案**。这是 V2 交付层要解决的核心问题。

### 5.2 目标流程

```
git tag v2.0.0  ──►  GitHub Actions (deploy.yml)
                        │  1. checkout + setup-node(20) + setup-hugo(0.168.0 extended)
                        │  2. npm ci                      # postcss/lightningcss 等锁版本
                        │  3. hugo --gc --minify --enableGitInfo --panicOnWarning
                        │  4. 质量门禁（与 ci.yml 同一套，见 §6.1）  ← 红灯即停
                        │  5. 打包 dist.tar.gz + 上传 artifact
                        ▼
                 CF Pages 预览部署 (--branch=ci-<sha>)
                        │  6. 冒烟：首页/文章/404/资源状态码 + 指纹校验
                        ▼
                 CF Pages 生产部署 (--branch=main)  ← 原子切换生产别名
                        │  7. 线上快检（headers、关键页面 200）
                        ▼
                 成功：GitHub Release 附 dist.tar.gz；失败：自动回滚上一 deployment
```

**关键点**：先部署到预览分支做冒烟，再提升到生产 → 用平台自身的 deployment 机制实现"原子 + 可回滚"，不手工覆盖文件。

### 5.3 构建与发布命令

```bash
# 本地完全复现 CI（写进 README 与 docs）
export NODE_ENV=production
npm ci
hugo --gc --minify --enableGitInfo --panicOnWarning
npm run check            # 门禁脚本（pipeline 实现，契约见 §6.1）

# 发布（Direct Upload，默认路径）
npx wrangler pages deploy public \
  --project-name k-black \
  --branch main \
  --commit-dirty=true

# 预览（PR / 发布前冒烟）
npx wrangler pages deploy public --project-name k-black --branch "ci-$(git rev-parse --short HEAD)"
```

`hugo.toml` 需要的最小变更：

```toml
baseURL = "https://k-black.top/"
title = "K-BLACK"
theme = ["kb-ark"]
themesDir = "theme"
enableRobotsTXT = true
defaultContentLanguage = "zh-cn"

[outputs]
  home = ["HTML", "RSS"]
  section = ["HTML", "RSS"]
  taxonomy = ["HTML"]
  term = ["HTML"]

[taxonomies]
  tag = "tags"
  category = "categories"
  series = "series"

[params]
  themeColor = "#080a0b"     # 由模板输出，避免 layouts 里写死色值
  logoSquare = "/img/logo-square.svg"
  logoWide = "/img/logo-wide.svg"
```

### 5.4 缓存与安全头（`static/_headers`）

```text
# 默认：安全头（所有响应）
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
  X-Frame-Options: DENY

# HTML：短缓存 + 必须回源校验（与 Pages 默认一致，显式声明以防平台默认变更）
/*.html
  Cache-Control: public, max-age=0, must-revalidate

# 指纹化资产：一年不可变（文件名含内容哈希，改内容必然换 URL）
/css/*
  Cache-Control: public, max-age=31536000, immutable
/js/*
  Cache-Control: public, max-age=31536000, immutable
/img/*
  Cache-Control: public, max-age=604800

# 站点级小图标：中等缓存
/favicon.ico
  Cache-Control: public, max-age=86400
```

- 现状痛点（白皮书 §9 #6「样式改了线上不生效」）：HTML 短缓存 + 资产未 immutable → 每次都要回源。目标态：HTML 每次回源（`max-age=0`）、资产命中强缓存（`immutable`），靠指纹换 URL 失效。
- 静态资源必须**全部**进入指纹管线；`static/` 下只允许图标、`_headers`、`robots.txt` 等"低频、可接受回源"的文件。

### 5.5 回滚（三件套）

| 手段 | 命令/入口 | 时延 | 适用 |
|---|---|---|---|
| ① 平台回滚 | CF 面板 Deployments → Rollback；或 `POST /accounts/{account_id}/pages/projects/k-black/deployments/{deployment_id}/rollback` | 秒级 | 线上立刻止损 |
| ② 产物快照 | `gh release download v2.0.0 -p dist.tar.gz && tar xzf dist.tar.gz -C dist && npx wrangler pages deploy dist --project-name k-black --branch main` | 1–2 min | 平台 deployment 已过期/被清 |
| ③ 源码回退 | `git checkout v2.0.0 && gh workflow run deploy.yml -f ref=v2.0.0` | 3–6 min | 需要重建（依赖升级、Hugo 版本变更） |

配套强制项：

- **每个生产发布必须打 tag**（`vMAJOR.MINOR.PATCH`），tag 即回滚锚点。
- **每次发布上传 `dist.tar.gz`**：Actions artifact（90 天）+ GitHub Release 附件（永久）。
- 发布前记录 `deployment id` 到 Release 说明，回滚时直接引用。
- 回滚演练：每季度在预览项目上跑一次"②→线上比对"，确认快照可用（避免"以为能回滚"）。

### 5.6 Secrets 与最小权限

| 名称 | 类型 | 权限范围 | 备注 |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | **仅** `Account → Cloudflare Pages: Edit`，绑定单账号 | 禁止 Global API Key / 全账号 Token |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | 只读用途 | 可由 repo variable 提供 |
| `CF_PAGES_PROJECT` | Variable | `k-black` | 非敏感 |

- GitHub Environment `production` 绑定必需审批人；deploy job 只能在该 environment 下取到 token。
- workflow 权限：`permissions: { contents: read }`（上传 Release 时才加 `contents: write`，且拆到独立 job）。
- PR 流水线（`ci.yml`）**不注入任何 secret**、不做部署。
- 轮换：token 90 天轮换一次；离职/换机即吊销。

### 5.7 可选升级路径

| 升级 | 触发条件 | 动作 | 成本 |
|---|---|---|---|
| CF Pages **Git 集成** | 希望 push 即发、免本地直传 | 在 Pages 项目里连接仓库，构建设置 `HUGO_VERSION=0.168.0`、`NODE_VERSION=20`、build `npm ci && hugo --gc --minify --enableGitInfo`、输出 `public` | 失去"预览→冒烟→生产"两段式；CF 构建环境需能跑 npm（有网络） |
| GitHub Pages | 需要完全开源、去厂商依赖 | 加 `actions/deploy-pages`，产物不变 | 失去 CF 边缘缓存与 `_headers`；自定义域需改 DNS |
| 双写（CF + 备份桶） | 容灾要求 | 产物同步到 R2/S3 | 增加一致性负担，非必要不做 |

**默认保留 Direct Upload**：它让"质量门禁 → 预览 → 生产"的顺序由我们控制，而不是由平台构建触发；代价是必须用 tag + 快照补上溯源。

---

## 6. 质量门禁与预算（L4）

### 6.1 门禁流水线（顺序固定，前者失败不跑后者）

```bash
npm ci                                                                     # 1
hugo --gc --minify --enableGitInfo --panicOnWarning                        # 2 构建
node scripts/ci/check-tokens.mjs                                           # 3 令牌唯一性/视觉契约
npx html-validate "public/**/*.html"                                       # 4 HTML 规范
node scripts/ci/check-links.mjs public                                     # 5 内部链接/锚点
node scripts/ci/check-budget.mjs                                           # 6 体积预算（读 nextgen/budget.json）
npx pagefind --site public                                                 # 7 搜索索引（启用后）
npx @lhci/cli autorun --collect.staticDistDir=public --assert.preset=lighthouse:recommended  # 8 性能/a11y/SEO
npx pa11y-ci --sitemap http://127.0.0.1:8080/sitemap.xml                   # 9 a11y 实测（本地 http server）
```

契约：每个脚本 **退出码非 0 = 阻断**；输出必须包含"指标 / 实测值 / 阈值 / 结论"四段，便于在 PR 里定位。脚本由 pipeline 实现（`scripts/ci/`），本文件只定义输入输出与阈值。

### 6.2 阈值表（数字，实测基线 2026-10-26）

**基线**：首页 HTML 15,392 B（gzip 4,096 B）；CSS 36,278 B（gzip 9,962 B）；JS 7,813 B（gzip 3,106 B）；构建 43 ms / 141 页；`public/` 1.3 M。

| # | 指标 | 采集方式 | 基线 | 阈值 | 级别 |
|---|---|---|---|---|---|
| 1 | 首页 HTML gzip | `check-budget.mjs` 读 `public/index.html` | 4.1 KB | **≤ 8 KB** | 阻断 |
| 2 | 文章页 HTML gzip（取 95 分位） | 同上，扫 `public/posts/**/index.html` | ~5–8 KB | **≤ 12 KB** | 阻断 |
| 3 | 其他页 HTML gzip | 同上 | ~2 KB | **≤ 6 KB** | 阻断 |
| 4 | CSS 总 gzip | 扫 `public/css/*.css` | 9.7 KB | **≤ 12 KB** | 阻断 |
| 5 | JS 总 gzip | 扫 `public/js/*.js` | 3.0 KB | **≤ 8 KB** | 阻断 |
| 6 | 首屏内联 CSS（raw） | 解析 HTML `<style>` 长度 | ~5.5 KB | **≤ 8 KB** | 阻断 |
| 7 | 单页 HTML raw | 同上 | 15.4 KB | **≤ 40 KB** | 阻断 |
| 8 | 字体字节 | 扫 `public/fonts/**` | 0 | **= 0**（启用后 ≤ 120 KB） | 阻断 |
| 9 | 单图大小 | 扫 `public/**/*.{webp,png,jpg}` | — | **≤ 500 KB** | 阻断 |
| 10 | 单文图片总量 | 按 bundle 目录聚合 | — | **≤ 1.5 MB** | 阻断 |
| 11 | 站点总产物 | `du -sb public` | 1.3 MB | **≤ 60 MB** | 告警 |
| 12 | 构建耗时 | `time hugo` | 43 ms | **≤ 5 s**（>3 s 告警） | 阻断 |
| 13 | 页面数 | 解析构建输出 | 141 | **≥ 141**（防误删） | 阻断 |
| 14 | 构建 WARN | `--panicOnWarning` | 1（`.Site.Data`） | **= 0** | 阻断 |
| 15 | 断链（内部 + 锚点） | `check-links.mjs` | 待测 | **= 0** | 阻断 |
| 16 | 外链可达性 | 同上（仅告警） | 待测 | 失败率 ≤ 5% | 告警 |
| 17 | HTML 校验错误 | `html-validate` | 待测 | **= 0 error**（warning ≤ 20） | 阻断 |
| 18 | Lighthouse Performance（mobile） | LHCI，3 次中位数 | 待测 | **≥ 95** | 阻断 |
| 19 | Lighthouse Accessibility | LHCI | 待测 | **= 100** | 阻断 |
| 20 | Lighthouse Best Practices / SEO | LHCI | 待测 | **≥ 95** | 阻断 |
| 21 | LCP（p75, mobile） | LHCI | 待测 | **≤ 2.0 s** | 阻断 |
| 22 | CLS（p75） | LHCI | 待测 | **≤ 0.02** | 阻断 |
| 23 | INP（p75）/ TBT 代理 | LHCI | 待测 | **≤ 120 ms** / TBT ≤ 200 ms | 阻断 |
| 24 | TTFB | LHCI | 待测 | **≤ 400 ms** | 告警 |
| 25 | axe serious + critical | pa11y-ci | 待测 | **= 0** | 阻断 |
| 26 | 正文对比度 | 令牌计算 + axe | `#c3cbcd` on `#080a0b` | **≥ 4.5:1** | 阻断 |
| 27 | 令牌 `:root` 块数 | `check-tokens.mjs` | 1 | **= 1** | 阻断 |
| 28 | `--signal` 声明数 / 值 | 同上 | 1 / `#18d1ff` | **= 1 / 固定值** | 阻断 |
| 29 | 组件硬编码色值 | 同上 | 0 | **= 0**（豁免 ≤ 3 且需注释） | 阻断 |
| 30 | 非 0 `border-radius` | 同上 | 0 | **≤ 2**，值 ≤ 4px | 阻断 |
| 31 | 内联 `style=` 属性 | `check-tokens.mjs` 扫 layouts | 11 | **= 0** | 阻断 |
| 32 | Pagefind 索引体积 | `du -sb public/pagefind` | — | **≤ 400 KB**（gzip ≤ 120 KB） | 阻断 |
| 33 | 渲染等价（拆分前后） | 无头浏览器截图逐像素比对（5 个页面） | — | 差异像素 ≤ 0.1% | 阻断（一次性迁移门禁） |

**阈值来源**：1–7 以实测基线 ×（1.2–2.0）留出功能余量；18–25 取 Core Web Vitals 的 "good" 分界并略收紧（个人站无业务压力，应收紧）；27–31 直接来自 I2–I7。

### 6.3 阻断策略与容差

1. **PR 到 main**：1–17、27–33 全部阻断；18–25 跑一次 mobile，未达标阻断（PR 阶段就暴露，不留到生产）。
2. **main 分支**：全量跑，18–25 取 3 次中位数；单次抖动不判负。
3. **发布**：`deploy.yml` 的 deploy job `needs: quality`，任何阻断项红灯 → 不部署、不发 Release。
4. **容差**：性能类指标允许 **5%** 一次性容差（Lighthouse 环境方差），二次仍超阈值即阻断；不得用 `continue-on-error` 绕过。
5. **豁免**：仅允许"临时豁免"——PR 内修改 `budget.json` 并附原因 + 到期日，需架构评审（本文件 §6.2 同步更新）；豁免条目在 CI 输出中显式列出，过期后自动失效（脚本校验日期）。
6. **预算单一来源**：`nextgen/budget.json` 是机器可读副本（pipeline 维护），数值必须与本节一致；不一致时以本节为准并修 `budget.json`（CI 可加一致性断言）。

### 6.4 视觉契约的机器化断言

除 §3.2 的令牌检查，还要锁住"舟味"的几何与动效契约（否则拆分/新增组件时最易漂移）：

| 契约 | 断言 | 级别 |
|---|---|---|
| 0 圆角 | 非 0 `border-radius` ≤ 2 处且 ≤ 4px | 阻断 |
| 1px 线 | 边框声明中 `1px`/`2px` 之外无 `3px+` 实线（装饰性粗边） | 告警 |
| 45° 切角 | `clip-path:polygon(...)` 中的切角值必须引用 `--cut-*` | 阻断 |
| 单信号色 | `--signal` 只声明一次；`#18d1ff` 字面量只出现在 `tokens.css` | 阻断 |
| 动效区间 | `transition-duration`/`animation-duration` 不在 180–350ms（交互）或 500–900ms（显现）区间 → 告警 | 告警 |
| 无回弹 | 出现 `cubic-bezier` 第二/四控制点 < 0（bounce/elastic 特征） | 阻断 |
| reduced-motion | `motion.css` 必须包含 `@media(prefers-reduced-motion:reduce)` 块 | 阻断 |
| 隐藏态安全 | `.rv` 隐藏态不得出现 `clip-path`/`visibility:hidden`/`display:none` | 阻断 |
| 兜底动画 | `@keyframes rvSafe` 存在且被 `.rv` 引用 | 阻断 |

---

## 7. 演进能力预留

| 能力 | 触发条件 | 落点 | 成本/预算 | 与现架构兼容性 |
|---|---|---|---|---|
| **搜索（Pagefind）** | 文章 ≥ 20 篇（当前 21 篇） | 构建后 `pagefind --site public`；主题 partial `search.html` + `data-pagefind-body` 标注；交互时才加载 | 索引 ≤ 400 KB；构建 +1–3 s | 纯静态，零服务端；ADF 见 [ADR-0004](./adr/0004-search.md) |
| **i18n** | 出现英文读者/内容 | `[languages.en]`；内容 `*.en.md`；`i18n/{zh-cn,en}.toml`；`defaultContentLanguageInSubdir=false` | HTML ×2；构建 ×2 | Hugo 原生；taxonomy 需 `[languages.en.taxonomies]` 同名 |
| **评论/互动** | 有真实讨论需求 | Giscus（GitHub Discussions 存储），点击后加载，首屏零第三方 JS | ≤ 40 KB（懒加载） | 纯前端；隐私政策需说明 |
| **分析（隐私友好）** | 需要阅读量数据 | Plausible 自建 / Umami；`defer` + 事件白名单 | ≤ 2 KB；不得阻塞 LCP | 不引 cookie banner |
| **结构化数据** | 与搜索/SEO 同步上线 | `partials/head/jsonld.html`：`BlogPosting` + `BreadcrumbList` + `Person` + `WebSite` | HTML +0.8 KB | 与 `description/cover/date` 字段天然对齐 |
| **Feed** | 已有 RSS 缺失（当前 `outputs.home=["HTML"]`） | `home=["HTML","RSS"]`；`services.rss.limit=20`；`<link rel=alternate>` | 极小 | 配置即得 |
| **OG/Twitter 卡片** | 分享场景 | `partials/head/opengraph.html`；缺 `cover` 时用站点默认图 | +1 KB | 依赖 §4.1 schema |
| **CSP** | 内联脚本收敛完成后 | `_headers` 加 `Content-Security-Policy`：`script-src 'self' 'sha256-<preflight>'` | — | 需先完成 §3.5 内联收敛 |
| **主题复用（Module 化）** | 出现第二个站点 | 主题目录 `hugo mod init` + tag；`[[module.imports]]` + `go.mod` | Go 工具链进 CI | 目录约定可无损转 Module（见 ADR-0003 迁移路径） |

**预留原则**：所有能力必须满足 I5（无运行时服务端）与 §6.2 的预算；新增能力先改预算（PR + 评审），再写代码 —— 不允许"先上线再补预算"。

---

## 8. 风险登记与开放问题

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **令牌漂移**（拆分后组件写死色值/重复定义） | 视觉契约破坏，I2/I3 失效 | §3.2 四道 CI 闸门 + 文档↔代码 diff + 私有变量命名规则 |
| R2 | **拆分改变层叠**（文件顺序/选择器权重变化） | 视觉回退，且难定位 | 拆分即"物理搬运"；顺序单点定义；5 页逐像素截图比对作迁移门禁 |
| R3 | **Node 供应链**（postcss/lightningcss/html-validate） | CI 中断；恶意包 | `package-lock.json` + `npm ci` + `--ignore-scripts` + 依赖数量上限（dev 依赖 ≤ 12）+ 锁定主版本 |
| R4 | **Hugo 版本漂移**（本地 0.168 / 文档记录 CF 曾 0.147.7） | 构建行为不一致、API 不可用 | CI 固定 `0.168.0` extended；`--panicOnWarning`；`hugo.toml` 注释版本基线；CF Git 集成需显式 `HUGO_VERSION` |
| R5 | **Direct Upload 无溯源** | 无法回答"线上这版是谁发的" | tag + `dist.tar.gz` + deployment id 入 Release；季度回滚演练 |
| R6 | **主题/站点边界侵蚀**（主题读站点 data、写死品牌） | 主题无法复用，分层退化 | §2.4 三条 grep 断言（阻断） |
| R7 | **预算阈值僵化**（改了预算但不改文档） | 门禁形同虚设 | 预算单一来源 + 文档同步断言 + 临时豁免带到期日 |
| R8 | **性能测量噪声**（本地/CI 机器差异） | 误阻断 | LHCI 中位数 + 5% 容差 + 固定 Chrome 版本 |
| R9 | **`.Site.Data` 迁移窗口** | 迁移期 `--panicOnWarning` 会红 | 迁移期先不开 `--panicOnWarning`，替换完成（5 处）后开启；作为独立小 PR |
| R10 | **`content/测试.md` 等占位内容** | 污染 sitemap/搜索 | 迁入 `drafts` 或删除；页面数基线守护（阈值 13） |

**开放问题（需 lead 决策）**：

1. `backup/` 是否在 V2 后删除（当前冻结保留）？
2. `content/posts/a-posts.md`（未跟踪）去留？
3. 是否引入 `series` 的实际内容（当前无连载文章）—— 若无，`series` 只留 schema 不建 taxonomy 也可，但建议一次到位。
4. CF Pages 项目名/账号归属确认（`k-black`），以及 token 由谁持有、轮换责任人。
5. 是否接受 `npm ci` 带来的 CI 时长（约 20–30 s）与供应链面；若否，退化到 Hugo `css.Build`（无 nesting 特性，ADR-0002 备选 B）。

---

## 9. 落地验收（V2 架构"已落地"的判定）

全部满足才算收口（除标注外均为阻断项）：

- [ ] `hugo` 在仓库根无参数可跑；141+ 页；`--panicOnWarning` 零 WARN。
- [ ] `theme/kb-ark/` 存在且包含全部 layouts/assets；仓库根不再有 `layouts/`、`assets/css/`。
- [ ] `tokens.css` 是唯一 `:root`；`--signal` 全局 1 处、值 `#18d1ff`；组件硬编码色 0。
- [ ] CSS 拆分后总量 gzip ≤ 12 KB；JS ≤ 8 KB；首页 HTML gzip ≤ 8 KB。
- [ ] 5 个基准页面拆分前后截图逐像素差异 ≤ 0.1%。
- [ ] `static/_headers` 生效：HTML `max-age=0`、`/css/*` `immutable`、安全头齐全。
- [ ] `.github/workflows/ci.yml` 门禁全绿；`deploy.yml` 走"预览→冒烟→生产"；Release 附 `dist.tar.gz`。
- [ ] 一次回滚演练成功（任选 §5.5 手段 ②）。
- [ ] `.Site.Data` 全部替换为 `hugo.Data`（5 处）。
- [ ] front matter schema 生效：新文章 archetype 可用；`description`/`categories` 校验通过。
- [ ] sitemap.xml / robots.txt / RSS / OG / JSON-LD 全部可访问且结构合法。
- [ ] 文档同步：`ARK-STYLE-GUIDE.md` §2.5 与 `tokens.css` 令牌集合 diff 为空；两份设计文档版本号 bump。

---

## 附：与既有文档的关系

- **不作为**：本站视觉语言的重新定义。视觉契约以 `docs/ARK-STYLE-GUIDE.md` 与 `docs/视觉设计白皮书.md` 为准，本文件只保证架构改动**不破坏**它们。
- **承接**：`00-current-state.md` 的量化问题清单 → 本文的层与门禁；`30-poc-report.md` 的实测数据 → 本文预算基线的校准。
- **ADR 索引**：

| ADR | 结论（一句话） |
|---|---|
| [0001](./adr/0001-hugo-stays.md) | 保留 Hugo，不迁移框架；迁移触发器为"需要类型化组件系统或 >500 页"。 |
| [0002](./adr/0002-asset-pipeline.md) | CSS 走 Hugo Pipes + PostCSS(lightningcss)；JS 走 Hugo 内嵌 esbuild；拒绝 Vite/Tailwind。 |
| [0003](./adr/0003-theme-extraction.md) | 主题用目录约定（`theme/kb-ark` + `themesDir`），不引 Hugo Module；第二站点出现再 Module 化。 |
| [0004](./adr/0004-search.md) | 搜索用 Pagefind（构建期索引、零服务端），不引 Algolia。 |
| [0005](./adr/0005-deploy-and-rollback.md) | Cloudflare Pages Direct Upload + tag/快照/平台回滚三件套；Git 集成留作可选升级。 |
| [0006](./adr/0006-quality-gates.md) | 门禁以体积/性能/令牌为硬阈值，全部阻断；预算单一来源 `nextgen/budget.json`。 |
