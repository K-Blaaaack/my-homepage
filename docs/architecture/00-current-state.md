# 现状审计：K-Black 个人站（Hugo）架构基线

- 审计人：auditor（task-1）
- 审计时间：2026-10-26 23:58–24:05 +08:00
- 审计对象：`/home/kb/github/my-homepage`，HEAD = `6861f8c`
- 结构化数据：[baseline.json](metrics/baseline.json)
- 只读审计：本次未修改 layouts/ assets/ static/ content/ data/ hugo.toml，未 commit

---

## 1. 结论摘要

1. **构建极快、体积极小**：`hugo --gc --minify` 三次均为 **36 ms**（外壳 wall clock 66–67 ms），产物 **141 页 / 163 文件 / 826,482 字节（807 KB）**，HTML 合计 338,217 字节、gzip 73,389 字节。
2. **真正的问题不在性能，在"半成品层"**：58 个 tag 页（占 HTML 页 71.6%）是 **0 篇文章链接的空壳**，平均 575 字节，且全部进 sitemap、0 处入口链接指向 `/tags/`（见 §7.2）。
3. **SEO 元数据层近乎空白**：81 个 HTML 中 canonical / OG / Twitter / JSON-LD **各 0 个**，无 `robots.txt`，首页无 RSS；22 个页面共用同一句 description，59 个页面没有 description（§7）。
4. **`public/` 与源码不同步**：现存 `public/` 是 10 月 9 日的旧构建，比当前源码**少 26 个文件**（hyps-hub、ai-dev-brief、8 张截图、16 个新 tag 页），并残留 4 个过期资源（§5.2）。线上内容落后于仓库，且仓库里没有任何 CI 能发现这件事。
5. **模板层耦合点明确**：4 处已废弃的 `.Site.Data`、1 个完全无调用的 `links.html`、导航链接写两遍、箭头 SVG 内联 5 份、11 处内联 style（§4）。
6. **可访问性有两处硬伤**：viewport 全站禁缩放（81/81 页），移动菜单按钮 0 个 aria 属性（`layouts/` 全仓 aria-* 数量为 0）（§6）。
7. **内容模型有 5 类漂移**：`tag` 单值与 `tags` 数组混用、`categories` 无 taxonomy 声明、`summary` 写了从不渲染、两篇测试内容在生产构建里、URL 用中文 slug（§5.3）。

---

## 2. 审计方法与复现

```bash
cd /home/kb/github/my-homepage
hugo version                                   # v0.168.0+extended+withdeploy linux/amd64
hugo --gc --minify -d /tmp/kb-build/out        # Total in 36 ms（连续 3 次）
find /tmp/kb-build/out -type f | wc -l         # 163
du -sb /tmp/kb-build/out                       # 826482
find /tmp/kb-build/out -name '*.html' -printf '%s\n' | awk '{s+=$1} END{print s}'   # 338217
find /tmp/kb-build/out -name '*.html' -print0 | xargs -0 cat | gzip -9 -c | wc -c   # 73389
gzip -9 -c /tmp/kb-build/out/css/main.<hash>.css | wc -c                            # 9927
gzip -9 -c /tmp/kb-build/out/js/main.<hash>.js   | wc -c                            # 3105
```

口径说明：

- 字节数取**构建产物**，不是源码；gzip 为 `gzip -9` 单文件压缩，非传输层压缩（CDN 的 br/gzip 会略有差异）。
- 构建时间取 Hugo 自报的 `Total in N ms`（不受进程启动开销影响），同时记录 wall clock 供参考。
- 所有结论的证据为「文件:行号」或「命令输出数字」，无法从仓库内确认的写「待验证」。

---

## 3. 与 lead 预扫数字的偏差（复核结果）

预扫的体量级判断全部成立，但有 5 处需要修正，其中 1 处会改变结论：

| 项 | 预扫值 | 本次实测 | 说明 |
|---|---|---|---|
| layouts | 351 行 / 16 文件 | **392 行 / 20 文件** | `find layouts -type f` = 20；`wc -l` 合计 392 |
| CSS 节数 | 13 节 | **14 节** | `main.css:25–527` 依次为 01 Reset … 14 Responsive & Accessibility |
| 构建用时 | ~48 ms | **36 ms**（hugo 自报，3 次一致） | wall clock 66–67 ms |
| 产物体积 | 1.3M / 141 文件 | **826,482 B / 163 文件** | 1.3M/141 是 `public/` 旧构建的 `du -sh`；141 是**页数**不是文件数 |
| `public/` 状态 | 未跟踪 | 未跟踪成立，但准确说是**被 `.gitignore:2` 忽略且内容过期** | 见 §5.2，比"未跟踪"严重 |

成立且可直接引用的数字：Hugo v0.168.0 extended、单语言 `zh-cn`、**141 页**、**21 篇 md**、CSS 36 KB（gzip 9.9 KB）、JS 7.8 KB（gzip 3.1 KB）、HTML 338 KB、首页 gzip 3.9 KB、`.Site.Data` 废弃告警、产物无 `robots.txt` / 无首页 RSS / 无 OG-Twitter-canonical-JSON-LD。

预扫未发现、本次新增的关键事实：

- `public/` 内 4 个过期资源 + 缺 26 个文件（§5.2）
- 58 个 tag 页是空壳（§7.2）
- 22 个页面共用同一句 description，`summary` 字段从未被渲染（§7.1）
- 全仓 `aria-*` 属性数量为 0（§6）
- `layouts/partials/links.html` 无调用点（§4.1）

---

## 4. 量纲对齐：141 页是什么

| 类型 | 数量 | 依据 |
|---|---|---|
| 首页 | 1 | `layouts/index.html` |
| 404 | 1 | `layouts/404.html` |
| 文章列表 | 1 | `layouts/posts/list.html` |
| 文章正文 | 16 | `content/posts/*`（16 篇 `draft: false`）+ 3 个 page bundle |
| tag 索引 `/tags/` | 1 | taxonomy term list |
| tag 终页 `/tags/<name>/` | 57 | 空壳，见 §7.2 |
| 独立页（info/stack/wip/测试） | 4 | `layouts/_default/single.html` |
| **HTML 合计** | **81** | |
| XML（sitemap 1 + RSS 59） | 60 | `out/sitemap.xml`、`out/**/index.xml` |
| **Hugo 统计 Pages** | **141** | 81 + 60 |

其他构建统计（`hugo --gc --minify` 输出）：Non-page files 9（8 张 webp + `fanctl.sh`）、Static files 11、Paginator 0、Processed images 0（未启用 Hugo 图片处理）、Aliases 0。

---

## 5. 维度一：构建与产物

### 5.1 体积构成

| 类别 | 字节 | 占比 | gzip |
|---|---|---|---|
| HTML（81 页） | 338,217 | 40.9% | 73,389 |
| 图片（8 webp + 7 图标/SVG） | 343,580 | 41.6% | — |
| CSS（`main.css` 指纹版 + `error.css`） | 39,503 | 4.8% | 9,927（main） |
| JS（`main.js` 指纹版） | 7,813 | 0.9% | 3,105 |
| sitemap + 59 个 RSS XML | 89,382 | 10.8% | — |
| `fanctl.sh`、`CNAME` | 7,987 | 1.0% | — |

- 单页均值 4,175 字节；首页 12,819 字节（gzip 3,857）。
- **最大页 54,714 字节**：`/posts/poweredge-r730-fanctl/index.html`，其中 9 个 `<pre>` 代码块合计 44,026 字节（占该页 80%）。这是唯一超过 50 KB 的页，其余最大 32,272（`kernel-autobuild-pipeline`）。
- **最大资源 46,882 字节**：`/posts/hyps-hub/screenshots/editor.webp`。6 张截图合计 233,228 字节，占图片总量 68%；`icon-512.png` 31,792 字节为纯静态图标（`static/icon-512.png`）。

### 5.2 `public/` 过期（本次最高价值发现之一）

```
仅 public 有（4）：css/main.css、css/main.fd91c8ec….css、js/main.js、js/main.369e336d….js
仅新构建有（26）：posts/hyps-hub/**（7）、posts/ai-dev-brief/**（3）、16 个 2026-10-17 新增 tag 页
public：141 文件 / du -sh 1.3M     新构建：163 文件 / 826,482 字节
```

- `public/css/main.css`（22,350 B，9 月 27 日）与 `public/js/main.js`（7,331 B）是**无指纹旧文件**，说明曾有一段时间不走 `fingerprint` 管道（现 `layouts/partials/head/css.html:3`、`head/js.html:11` 都走）。
- 两个旧哈希文件 `main.fd91c8ec…`、`main.369e336d…` 没有任何页面引用，是死资产。
- 结论：**当前 `public/` 不能代表源码状态**；任何"线上是什么样"的判断都必须以新构建为准。部署链路无仓库内配置（§8.2），无法从代码确认 `public/` 是否就是线上产物 → **待验证**。

### 5.3 缓存指纹与压缩

- CSS/JS 已指纹：产物名带 SHA-256 前缀（`main.e4295677….css`、`main.aa85e153….js`），可配长缓存。
- `static/css/error.css`（3,225 B）**未指纹**，被 58 个 tag 页 + 404 引用（`layouts/_default/list.html:9`、`layouts/404.html:9`）。
- 无 SRI（`integrity`）属性；无 `preload`/`preconnect`；无外链字体（`main.css` 只用本地 `var(--font)/var(--mono)/var(--display)`，无 `@font-face`、无 Google Fonts）。
- minify 已生效：CSS 源码 gzip 9,862 → 产物 gzip 9,927（CSS 本身已高度紧凑，minify 收益 ≈0）；HTML 压缩由 minify 完成。

### 5.4 搜索与爬虫产物

| 产物 | 状态 | 证据 |
|---|---|---|
| `sitemap.xml` | 有，8,429 B | 含 **80 个 URL**（81 个 HTML 除 404 外全收录）；`/info/`、`/stack/`、`/wip/` 三条无 `lastmod` |
| `robots.txt` | **无** | `hugo.toml` 未设 `enableRobotsTXT` |
| 首页 RSS | **无** | `hugo.toml:31-32` `outputs.home = ["HTML"]` |
| 分区/分类 RSS | 有 59 个 | `posts/index.xml`、`tags/index.xml`、57 个 tag feed |
| 404 | 有，635 B | `layouts/404.html` |

---

## 6. 维度二：代码结构

### 6.1 layouts 分层（20 文件 / 392 行）

```
layouts/
├── 404.html                      20  独立完整 HTML（无 baseof）
├── _default/
│   ├── baseof.html               26  全站骨架：head 元信息 + 4 个 partial 挂点
│   ├── list.html                 19  独立完整 HTML（tag 页专用，不走 baseof）
│   └── single.html               11  info/stack/wip/测试 的兜底页
├── index.html                     7  首页装配（5 个 partial 顺序调用）
├── posts/list.html               18  /posts/ 列表
├── posts/single.html             18  文章正文
├── stack/single.html             21  技术栈页（读 data/stack.toml）
└── partials/ (12 文件)
    ├── nav.html 24 / footer.html 9 / hero.html 19 / news.html 49
    ├── profile.html 41 / about.html 20 / links.html 12（死代码）
    ├── loader.html 33 / svg-defs.html 4
    └── head/{css.html 7, js.html 15, loader.html 19}
```

三种**互不复用**的 HTML 骨架并存，是结构上最该收敛的点：

1. `baseof.html`（22 页走这条路：首页、4 个独立页、/posts/、16 篇文章）
2. `_default/list.html`（58 页：tags 索引 + 57 tag 终页）—— 自带 `<head>`，只加载 `error.css`，**没有 nav、没有 favicon、没有 description**
3. `404.html`（1 页）—— 与 2 高度重复

`baseof.html` 的装配顺序（`layouts/_default/baseof.html:14-24`）：`head/css → head/loader（仅首页）→ loader（仅首页）→ svg-defs → block main → footer → head/js`。

### 6.2 重复片段（可合并项，附行号）

| 重复内容 | 位置 | 次数 |
|---|---|---|
| 5 个导航链接（桌面 + 移动各一份） | `partials/nav.html:9-13` 与 `:19-23` | 2 |
| 返回箭头 SVG `<polyline points="1,1 6,7.5 1,14">` | `_default/single.html:8`、`_default/list.html:16`、`stack/single.html:18`、`404.html:17`、`partials/profile.html:21` | 5 |
| `<svg viewBox="0 0 7 15"><use href="#i-arrow"/></svg>` | `partials/hero.html:15`、`partials/news.html:14,35,45`、`partials/links.html:8`、`posts/list.html:13` | 6 |
| 完整 `<head>` 元信息块 | `baseof.html:3-16`、`_default/list.html:3-10`、`404.html:3-10` | 3 |
| `<div class="sec-hd"><div class="sec-tag">…` 区块头 | `posts/list.html:4`、`stack/single.html:4`、`partials/profile.html:2`、`partials/about.html:2`、`partials/links.html:2` | 5 |

`partials/svg-defs.html:1-4` 已定义 `#i-arrow`、`#i-link` 两个 symbol，但只有 6 处用 `use`，另外 5 处仍内联完整 path —— 同一个图标两套写法。

### 6.3 partials 耦合

- 数据耦合（4 处已废弃 API，全部读 `.Site.Data.*`）：
  - `partials/news.html:7`（`news.featured`）、`:38`（`news.items`）
  - `partials/links.html:4`（`links.items`）
  - `stack/single.html:7`（`stack.groups`）
- 结构耦合：`index.html:2-6` 固定顺序装配 5 个 partial，`hero/news/profile/about` 无法单独复用；`partials/profile.html` 内容全部写死（见 §7.3）。
- 死代码：**`partials/links.html` 无任何调用点**（`grep -rn 'partial "links' layouts/` 无结果），`#links` 锚点在 `nav.html:9-13` 也没有，但 `assets/js/main.js:78-79` 的 scroll-spy 仍在监听 `links` 段。
- 首页专属逻辑散在 3 处：`baseof.html:18`（loader 条件）、`head/loader.html:5`（`.IsHome` gate）、`head/js.html:3`（runtime 计时），三处共同依赖 `hugo.toml:14-15` 的 `startTime`/`lastDeploy`。

### 6.4 `assets/css/main.css`（548 行 / 14 节 / 259 个含 `{` 的行，即规则块与 at-rule 头）

| 节 | 行范围 | 行数 | 拆分判断 |
|---|---|---|---|
| 头部注释 + 01 Reset | 1–28 | 28 | 可合并进 base |
| 02 Design Tokens | 29–88 | 60 | **独立 `tokens.css`**，全站唯一变量源，最该先拆 |
| 03 Stage | 89–109 | 21 | base |
| 04 Geometry 切角 | 110–122 | 13 | 原子工具，可并入 components |
| 05 Atmosphere（粒子/光池/扫描线） | 123–150 | 28 | **独立 `atmosphere.css`**，仅首页用 |
| 06 Topbar & Navigation | 151–186 | 36 | `nav.css` |
| 07 Hero | 187–215 | 29 | `hero.css`（仅首页） |
| 08 Section System | 216–231 | 16 | base |
| 09 Components | 232–314 | 83 | `components.css`（tab/panel/chip/button/list） |
| 10 Page Blocks | 315–400 | 86 | `blocks.css`（profile/stack/links/about/footer/404） |
| 11 Content | 401–495 | 95 | **`content.css`**（正文 + 441 行起的 chroma 语法高亮） |
| 12 Motion | 496–517 | 22 | `motion.css`（含 `prts-skip`） |
| 13 Desktop Spacing | 518–526 | 9 | 可并入 14 |
| 14 Responsive & a11y | 527–548 | 22 | `responsive.css`（含 540 行 `prefers-reduced-motion`） |

拆分判据（不是审美，是可测的）：只有 3 个 `@media`、3 个 `!important`、1 处 `:focus-visible`（`main.css:105`）；259 个规则块里首页专属（hero/atmosphere/loader）约占 90 行，非首页页仍全额加载这 36 KB。CSS 有 20+ 个 `--*` 变量集中定义在 `:root`（`main.css:30-88`），拆文件时 tokens 必须最先独立。

### 6.5 `assets/js/main.js`（192 行 / 9 个 IIFE）

| 模块 | 行 | 职责 | 加载范围 |
|---|---|---|---|
| Boot Sequence | 1–71 | 首页 PRTS 启动动画：cookie 冷却 5 分钟、17 行打字输出、进度条、6 s 后收尾 | 仅首页有 DOM |
| Nav scroll-spy | 73–99 | 滚动高亮当前段（`news/profile/links/about`），`location.pathname` 判定仅首页 | 全站加载、首页生效 |
| In-page nav | 101–116 | 首页内锚点平滑滚动，拦截默认跳转 | 仅首页 |
| Burger | 118–124 | 移动菜单开关 + `body.overflow` 锁定 | 全站 |
| Tabs | 126–134 | 首页新闻区按 `data-c` 过滤（all/post/site/ba） | 仅首页 |
| Reveal | 136–142 | IntersectionObserver 加 `.vis`，把 `.rv` 挂到 7 类元素 | 全站 |
| Code copy | 144–169 | 给 `.post-content pre` 包 `div.code-wrap` + 复制按钮 | 文章页 |
| Hero date | 171–177 | 首页标题下日期 | 仅首页 |
| Particles | 179–192 | 生成 20 个随机粒子 div | 仅首页 |

问题：单个 7.8 KB 文件里 6 个模块只在首页生效，却在 81 个页面全量加载；`Tabs` 与 `news.html:21-24` 的写死 4 个 tab 强耦合；`Reveal` 对 `.news-item`/`.stack-card` 二次加 `.rv`，与模板里已写的 `rv` class（`news.html:29`、`links.html:5`）语义重叠。

---

## 7. 维度三：内容模型

### 7.1 front matter 字段频次（21 篇 md）

| 字段 | 出现次数 | 备注 |
|---|---|---|
| `title` | 21 | 全部有 |
| `draft` | 18 | `a-posts.md` 为 `true`（且未跟踪） |
| `date` | 17 | 4 个独立页无日期 |
| `tags`（数组） | 16 | 文章统一用这个 |
| `categories`（数组） | 16 | 但**无 taxonomy 声明** |
| `summary` | 16 | **模板从不渲染** |
| `tag`（单值字符串） | 3 | `info.md:2`、`stack/index.md:2`、`wip.md:2` |
| `type` | 1 | `stack/index.md:3` |

### 7.2 分类法只有 tag，且 tag 页是空壳

- `hugo.toml:34-35` 只声明 `tag = "tags"`；16 篇文章的 `categories` 是**死元数据**：无 `/categories/` 页，仅在 `layouts/posts/list.html:10` 被当文本渲染出来。
- **57 个 tag 终页 + 1 个 tags 索引页，共 58 个 HTML，全部 0 篇文章链接**：
  - 直接证据：`out/tags/*/index.html` 中含 `href=/posts/` 的文件数 = **0**，`news-item` = **0**，平均 575 字节，最小 566 / 最大 592。
  - 模板原因：`layouts/_default/list.html:11-17` 只输出 `.Title`、`.Content`（空）、返回按钮，**没有 `range .Pages`**。
- **入口为零**：产物中 `href=/tags/` 出现 **0** 次（`layouts/posts/single.html:10` 的标签用 `<span class=tag>` 而非 `<a>`）。tags 页既没内链也没内容，却全部进了 `sitemap.xml` —— 典型的孤岛 + thin content。
- 分类拼写错误已上生产：`content/posts/test.md` 的 `categories: ["tyest"]`，在 `/posts/index.html` 渲染出 1 次 `<div class=news-date>tyest</div>`。

### 7.3 page bundle 与单文件混用

- bundle（含资源）：`content/posts/ai-dev-brief/`、`hyps-hub/`（6 图）、`poweredge-r730-fanctl/`（含 `fanctl.sh` 7,976 B）、`content/stack/`
- 单文件：其余 17 篇
- 结果：`fanctl.sh` 以 Non-page file 形式发布到 `/posts/poweredge-r730-fanctl/fanctl.sh`，同时正文里 9 个代码块又内联了一遍脚本（`<pre>` 合计 44,026 字节）—— 同一份内容两种分发，页面因此成为全站最大页（54,714 B）。

### 7.4 数据文件与模板写死内容耦合

- `data/stack.toml`（2,698 B）供 `/stack/` 渲染（`stack/single.html:7`），但首页档案卡把同类内容**再写死一遍**：技术栈 12 项硬编码在 `partials/profile.html:14-19`，兴趣 9 项在 `:27-31`，自我介绍 2 段在 `:7-8`。改技术栈要改两个地方，且首页那份是权威呈现（用户实际看到的那份）。
- `data/news.toml`（1,674 B）的 `category` 字段与 `partials/news.html:21-24` 写死的 4 个 tab（`all/post/site/ba`）靠约定对齐，无校验：data 里写新 category，tab 不会出现；tab 里删掉，data 项仍在"最新"里。
- `data/links.toml`（1,248 B）只被死代码 `partials/links.html` 读取 → **这个数据文件当前完全未被使用**。

### 7.5 生产构建里的杂物

| 项 | 证据 | 影响 |
|---|---|---|
| `/测试/` 上线 | `content/测试.md`，`sitemap.xml` 含 `/%E6%B5%8B%E8%AF%95/` | 中文 slug，占位内容 |
| `/posts/test/` 上线 | `content/posts/test.md`（`draft: false`，`summary: "test"`，category `tyest`） | 同上 |
| `a-posts.md` 未跟踪 | `git status` → `?? content/posts/a-posts.md`，`draft: true` | 20 天后仍悬空，误删/误提交风险 |
| `backup/` 旧站 | 7 个被跟踪文件，`backup/index.html` 33,418 B | 与构建无关，占仓库噪音 |
| `.hugo_build.lock` | 0 字节，已被 `.gitignore:6` 覆盖 | 无影响 |

---

## 8. 维度四：工程化

### 8.1 全空的质量设施

| 项 | 状态 | 证据 |
|---|---|---|
| CI | 无 | 无 `.github/`，无 `.gitlab-ci.yml`/`netlify.toml`/`vercel.json`/`wrangler.toml` |
| 构建脚本 | 无 | 无 `Makefile`/`package.json`/`Taskfile`/`justfile` |
| 测试 | 无 | 79 个被跟踪文件里无测试 |
| Lint / 校验 | 无 | 无 HTML 校验、无死链检查、无 a11y 扫描 |
| 版本锁定 | 无 | 无 `.hugo-version`/`.tool-versions`；`hugo.toml` 无 `[module]` 依赖（好消息：**零外部依赖**，锁一个 Hugo 版本即可） |
| 部署配置 | 无 | `layouts/partials/about.html:7` 自述「部署至 Cloudflare Workers」，`static/CNAME:1` = `k-black.top` → 具体链路**待验证** |

### 8.2 部署链路（待验证）

仓库内能确认的只有：`static/CNAME` 内容为 `k-black.top`；`about.html:7` 声称 Cloudflare Workers；`.gitignore:2` 忽略 `public/`。因此 `public/` 很可能是本地手跑 `hugo` 的残留，而非部署源——但**没有任何自动构建**能保证线上 = HEAD，这与 §5.2 的 26 个缺失文件互相印证。

### 8.3 废弃 API 与升级风险

- `.Site.Data` 4 处（Hugo v0.156 起废弃，`WARN` 每次构建都报）：`partials/news.html:7,38`、`partials/links.html:4`、`stack/single.html:7`。
- 无版本锁 + 无 CI ⇒ 下一次 `brew upgrade hugo` 就可能直接构建失败，且没人会在合入前发现。

### 8.4 建议的质量门禁阈值（供 roadmap 直接引用）

| 指标 | 当前基线 | 建议门禁 |
|---|---|---|
| `hugo --gc --minify` 用时 | 36 ms | ≤ 300 ms |
| HTML 总量 | 338,217 B | ≤ 400,000 B |
| HTML gzip 总量 | 73,389 B | ≤ 90,000 B |
| CSS gzip | 9,927 B | ≤ 12,000 B |
| JS gzip | 3,105 B | ≤ 5,000 B |
| 最大单页 | 54,714 B | ≤ 60,000 B |
| 空 tag 页 | 58 | **0** |
| 无 description 的页 | 59 | **0** |
| canonical 覆盖 | 0/81 | **81/81** |
| 构建告警 | 1（`.Site.Data`） | **0** |

---

## 9. 维度五：可访问性与合规

| # | 问题 | 严重度 | 证据 |
|---|---|---|---|
| 1 | viewport 禁缩放 `maximum-scale=1,user-scalable=no` | 高 | `baseof.html:5`、`_default/list.html:5`、`404.html:5`；81/81 页带该属性。违反 WCAG 1.4.4 |
| 2 | 移动菜单按钮无名称无状态 | 高 | `partials/nav.html:15` `<button class="burger" id="burger"><i></i><i></i><i></i></button>`；**全仓 `aria-*` 属性数 = 0**（`grep -rn 'aria-\|role=' layouts/` 无结果）；`main.js:122` 只切 class，不更新 `aria-expanded` |
| 3 | 无 skip link | 中 | `layouts/`、`main.css` 中无 skip-link；`main.css:514` 的 `prts-skip` 是动画冷却标记，与键盘跳转无关 |
| 4 | 无 `main`/`article`/`header` 语义地标 | 中 | 产物 81 页中 `<main>`=0、`<article>`=0、`<header>`=0；正文区是 `div.sec`（`posts/single.html:3`） |
| 5 | 8 张正文截图无 `width`/`height` | 中 | `/posts/hyps-hub/` 6 张、`/posts/ai-dev-brief/` 2 张；模板层 `nav.html:4`、`footer.html:2` 的 img 有尺寸 → 差异来自 markdown `![alt](src)` 无尺寸，Hugo 图片处理未启用（`Processed images: 0`） |
| 6 | tab 组件无 ARIA | 中 | `news.html:21-24` 裸 `<button>`，无 `role=tab`/`aria-selected`；`main.js:129-133` 只切 `.on` |
| 7 | `--disabled` 对比度不足 | 低 | `--disabled:#5a6165`（`main.css:44`）在 `--ink:#080a0b` 上 **3.15:1**，用于 9px 小字（`main.css:165` 的 `.nav-brand-sub`） |
| 8 | 已处理项（保持） | — | `main.css:105` `:focus-visible` 全站统一轮廓；`main.css:540-546` `prefers-reduced-motion` 关动画 + 隐藏粒子/光球 + `.rv` 强制可见；`main.css:529` 竖屏断点与 orientation 组合判断 |

其他对比度实测（`#f4f6f6`/`#c3cbcd`/`#8d9396` on `#080a0b`）= 18.29 / 12.04 / 6.37，正文层级全部达标。

---

## 10. 维度六：SEO（详见 [baseline.json](metrics/baseline.json) 的 `seo_missing`）

| 项 | 状态 | 证据 |
|---|---|---|
| `rel=canonical` | **0/81** | `grep -l canonical` 无结果 |
| Open Graph | **0/81** | 无 `og:*`；`baseof.html:3-16` 无相关标签 |
| Twitter Card | **0/81** | 无 `twitter:*` |
| JSON-LD | **0/81** | 无 `application/ld+json` |
| `robots.txt` | 无 | 未开 `enableRobotsTXT` |
| 首页 RSS | 无 | `hugo.toml:31-32` |
| description 唯一性 | **22/81 有，且内容完全相同**（「K-Black 个人主页」）；59 页没有 | `baseof.html:9` 只读 `.Description`，而正文写的是 `summary`，模板无一处读 `.Summary` |
| tag 页内容 | 58 页空壳 | §7.2 |
| tag 页入口 | 0 | §7.2 |

一句话：站点有 `title`、有 `description`（但重复）、有 `sitemap`、有分区 RSS，**其余元数据层全缺**。修复成本最低、收益最大的三项是：`summary → meta description`、canonical、OG（模板里各 3–6 行）。

---

## 11. 风险清单（按优先级）

### P0 — 影响线上正确性

1. **`public/` 与源码不同步且无自动构建**：缺 26 文件、4 个过期资源（§5.2、§8.2）。修法方向：CI 构建 + 全量替换而非增量覆盖；`public/` 不再作为手工产物。
2. **58 个空 tag 页 + 0 入口 + 全量进 sitemap**（§7.2）。修法方向：`list.html` 补 `range .Pages`，或直接关闭 taxonomy 输出；二者择一，不要停在中间态。

### P1 — 结构性返工点，越晚改越贵

3. **三套 HTML 骨架并存**（`baseof` / `_default/list` / `404`）（§6.1）。tag 页因此丢了 nav、favicon、description、main.css。
4. **`.Site.Data` 4 处已废弃 + 无版本锁**（§8.3）：升级即断，且无 CI 拦。
5. **SEO 元数据层空白 + description 复用**（§10）。
6. **viewport 禁缩放 + burger 零 aria**（§9 #1/#2）：两项都是 1–2 行改动，但影响全站 81 页。
7. **首页内容双份维护**（`profile.html` 写死 vs `data/stack.toml`），`data/links.toml` 完全未被使用（§7.4）。

### P2 — 可清理项

8. `partials/links.html` 死代码 + `main.js:78-79` 仍在监听已不存在的 `#links`（§6.3）。
9. 导航链接/箭头 SVG/区块头重复 2–5 份（§6.2）。
10. 11 处内联 style、129 个产物内联 style 属性（§6.2）。
11. 生产构建里的测试内容与中文 slug（§7.5）。
12. 8 张截图无尺寸 → CLS（§9 #5）；`fanctl.sh` 双份分发导致最大页 54.7 KB（§7.3）。
13. `error.css` 未指纹（§5.3）；`/info/` `/stack/` `/wip/` 在 sitemap 缺 `lastmod`。

---

## 12. 待验证项（仓库内无法确认）

| 项 | 需要什么才能确认 |
|---|---|
| 线上产物是否等于 `public/` | Cloudflare Workers/Pages 的构建命令与产物目录配置 |
| 缓存头（是否 immutable） | CDN 响应头：`curl -I https://k-black.top/css/main.<hash>.css` |
| 真实 TTFB / LCP / CLS | 线上 Lighthouse / CrUX，本地构建无法代表 |
| `k-black.top` 的 DNS 与证书 | `dig` / 证书链 |
| `hugo.toml:15` `lastDeploy = "2026/09/27 22:32:15"` 是否为手工维护 | 部署流程；若手工维护，`profile.html:38` 的「上次更新」会长期漂移 |
| 57 个 tag 页是否曾有过内容 | git 历史（当前 `_default/list.html` 只有 19 行，无 `range .Pages` 痕迹） |

---

## 附录：本次审计用到的关键命令

```bash
# 构建与体积
hugo --gc --minify -d /tmp/kb-build/out
find /tmp/kb-build/out -type f | wc -l                                  # 163
du -sb /tmp/kb-build/out                                                # 826482
find /tmp/kb-build/out -name '*.html' -printf '%s %p\n' | sort -rn | head

# public 与新构建差异
(cd public && find . -type f | sort) > /tmp/kb-build/pub.txt
(cd /tmp/kb-build/out && find . -type f | sort) > /tmp/kb-build/fresh.txt
comm -23 /tmp/kb-build/pub.txt /tmp/kb-build/fresh.txt                  # 仅 public 有 4 个
comm -13 /tmp/kb-build/pub.txt /tmp/kb-build/fresh.txt | wc -l          # 仅新版有 26 个

# 空 tag 页
grep -l 'href=/posts/' -r /tmp/kb-build/out/tags --include='*.html' | wc -l   # 0
grep -ro 'href=/tags/' /tmp/kb-build/out --include='*.html' | wc -l           # 0

# SEO
for p in canonical og:title twitter:card 'ld+json'; do
  echo -n "$p: "; grep -l "$p" -r /tmp/kb-build/out --include='*.html' | wc -l
done                                                                    # 全 0
grep -ho '<meta name=description content="[^"]*">' -r /tmp/kb-build/out --include='*.html' | sort | uniq -c

# a11y
grep -rn 'aria-\|role=' layouts/ | wc -l                                # 0
grep -c 'style="' layouts/posts/single.html                             # 5
```

结构化数字见 [baseline.json](metrics/baseline.json)；后续重构方案不属本文档范围（见 `10-*` / `20-*` / `adr/`）。
