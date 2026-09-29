# Arknights 风格 Web 界面 · 通用设计规范

> **Ark-Style Web UI Guide**
> 版本 v1.0 ｜ 最后更新：2026-09-27
>
> **这份文档是什么**：一套**可移植**的视觉规范。把"鹰角 / 明日方舟"的界面语言套用到**任意 Web 项目**，与框架、构建工具、内容形态无关。
> **这份文档不是什么**：不是某个具体站点的交接文档（那类文档见同目录 `视觉设计白皮书.md`）。本文只讲**通用规则**与**可复制的实现**。
> **前置知识**：CSS 基础。无需任何框架经验。

---

## 0. 快速开始

三步得到一个同风格的界面：

1. **复制 §2.5 的 `:root` 令牌块** —— 这是整套风格的 80%
2. **选一个 Shell 骨架**（§3），把导航与内容区摆好
3. **按 §4 组装组件** —— 面板 / 按钮 / 标签 / 列表都有可直接复制的代码

然后用 §10 的清单验收，用 §9 排查踩坑。

---

## 1. 风格定义

### 1.1 一句话

> **近黑墨底 + 白纸文字 + 单一青色信号 + 0 圆角 + 1px 细线 + 45° 切角**

### 1.2 反面定义（这不是什么）

**这一节比正面定义更重要**，因为最常见的失败是"以为自己在做方舟风，其实在做另一种东西"：

| ❌ 不是 | 为什么 |
|---|---|
| 低饱和**藏蓝/深灰蓝**调 | 真实方舟底色是**近黑 `#080a0b`**，信号色是**亮青 `#18d1ff`**。做成哑光藏蓝（如 `#3F72AF`）会立刻失去辨识度 |
| **纯黑** `#000` 大底 | 用近黑而非纯黑，暗部要保留细节 |
| **圆角卡片 + 阴影**堆叠 | 圆角为 0；纵深靠 1px 细线、遮罩、裁切，不靠投影 |
| **彩虹渐变 / 霓虹发光** | 只有一处信号色；禁止外发光、渐变文字 |
| **鲜艳多彩** | 中性表面须占构图 **75% 以上** |
| **装饰越多越"舟"** | 装饰必须是**功能性**的：索引、刻度、取景框。纯装饰要删 |
| 把每个模块都做成**描边卡片** | 面板只保留**一条强边** |

### 1.3 六条设计语法

| # | 原则 | 落地方式 |
|---|---|---|
| 1 | **舞台 + 仪表** | 大幅图像/排版场当舞台；导航、状态、元数据**贴边停靠** |
| 2 | **编辑式层级** | 一个超大标题 + 一堆极小标签。**大与极小共存，中间尺寸填充要少** |
| 3 | **系统虚构** | 界面像"属于那个虚构世界的操作系统"，但**必须映射到真实任务** |
| 4 | **非对称平衡** | 强左/右或上/下配重，用细线、留白补偿 |
| 5 | **受控点睛** | 一个信号色承载选中/进度/主操作，占比 **<15%** |
| 6 | **层叠扁平** | 纵深来自遮罩、裁切、半透明黑、细线、文字叠压 |

---

## 2. 设计令牌

### 2.1 墨阶（背景）

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--ink` | `#080a0b` | 页面基底 |
| `--ink-2` | `#0e1112` | 面板 / 卡片 |
| `--ink-3` | `#141819` | 浮层 / 悬停底 |
| `--ink-4` | `#1a1f21` | 激活底 |
| `--rule` | `#242a2d` | 1px 分隔线 |
| `--line` | `#333b3f` | 边框线 |
| `--line-h` | `#4a5459` | 悬停边框 |

> 相邻层级至少差一档；上层永远比下层亮。

### 2.2 纸阶（文字）

| 令牌 | 色值 | 用途 |
|---|---|---|
| `--paper` | `#f4f6f6` | 一级：标题 / 核心数值 |
| `--paper-2` | `#c3cbcd` | 二级：正文 |
| `--muted` | `#8d9396` | 三级：注释 / 时间戳 |
| `--disabled` | `#5a6165` | 禁用 |

### 2.3 信号色与状态色

| 令牌 | 色值 | 用途 | 约束 |
|---|---|---|---|
| `--signal` | `#18d1ff` | 选中 / 进度 / 主操作 / 链接 | **单屏 <15%** |
| `--signal-d` | `#0f9dc4` | 按下态 | |
| `--state` | `#c8eb21` | 成功 / 可用 / 徽标 | **仅表状态** |
| `--warn` | `#e0a34a` | 警告 / 倒计时 | |
| `--danger` | `#e0524f` | 危险 / 失败 | |

### 2.4 字体栈（无 WebFont，纯回退）

```css
--cjk:     "Noto Sans SC","Source Han Sans SC","HarmonyOS Sans SC","MiSans","PingFang SC","Microsoft YaHei",sans-serif;
--display: "Arial Narrow","Roboto Condensed","DIN Condensed","Bebas Neue","Hanson Bold",var(--cjk);
--tech:    "Space Grotesk","IBM Plex Sans","Outfit",system-ui,var(--cjk);
--serif:   "Noto Serif SC","Source Han Serif SC","Playfair Display",Georgia,serif;
--mono:    "IBM Plex Mono","JetBrains Mono","SFMono-Regular",Consolas,monospace;
```

**只用本地回退，不自托管 WebFont** —— 装了就用，没装逐级降级，零额外请求、零授权风险。

### 2.5 完整令牌块（直接复制）

```css
:root{
  /* 墨阶 */
  --ink:#080a0b; --ink-2:#0e1112; --ink-3:#141819; --ink-4:#1a1f21;
  --rule:#242a2d; --line:#333b3f; --line-h:#4a5459;
  /* 纸阶 */
  --paper:#f4f6f6; --paper-2:#c3cbcd; --muted:#8d9396; --disabled:#5a6165;
  /* 信号 / 状态 */
  --signal:#18d1ff; --signal-d:#0f9dc4; --signal-dim:rgba(24,209,255,.12);
  --state:#c8eb21; --warn:#e0a34a; --danger:#e0524f;
  /* 字体 */
  --cjk:"Noto Sans SC","Source Han Sans SC","HarmonyOS Sans SC","MiSans","PingFang SC",sans-serif;
  --display:"Arial Narrow","Roboto Condensed","DIN Condensed","Bebas Neue",var(--cjk);
  --mono:"IBM Plex Mono","JetBrains Mono","SFMono-Regular",Consolas,monospace;
  --font:var(--cjk);
  /* 字距阶梯 */
  --ls-display:-.045em; --ls-title:-.025em; --ls-body:0; --ls-caps:.12em; --ls-micro:.16em;
  /* 切角 */
  --cut-lg:14px; --cut-md:10px; --cut-sm:7px; --cut-xs:4px;
  /* 动效 */
  --t-fast:.18s; --t-base:.28s; --t-slow:.35s; --t-reveal:.7s;
  --ease:cubic-bezier(.22,.8,.2,1); --ease-out:ease-out;
  /* 纹理（生成式，无需图片） */
  --stripe:repeating-linear-gradient(-45deg,rgba(244,246,246,.14) 0 2px,transparent 2px 6px);
  --grid-4:linear-gradient(rgba(244,246,246,.028) 1px,transparent 1px),
           linear-gradient(90deg,rgba(244,246,246,.028) 1px,transparent 1px);
  --noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.04'/%3E%3C/svg%3E");
}
```

### 2.6 基底纹理

```css
body{
  font-family:var(--font); color:var(--paper-2); letter-spacing:var(--ls-body);
  background-color:var(--ink);
  background-image:var(--noise),var(--grid-4);      /* 噪点 4% + 64px 网格 2.8% */
  background-size:140px 140px,64px 64px,64px 64px;
  background-attachment:fixed;
  -webkit-font-smoothing:antialiased;
}
::selection{background:var(--signal);color:var(--ink)}
:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
```

> **两种签名纹理**：网点散点（噪点）+ 粗条纹（警戒线）。方舟在游戏内外都同时使用这两种，缺一个就少一半味道。

---

## 3. 布局模式

### 3.1 Shell 选型

| 方案 | 宽度 | 适用 | 备注 |
|---|---|---|---|
| **黑色顶栏** | 高 **56–96px** | **最通用，推荐默认** | 官方 Ark 家族的 shell 就是顶栏 |
| 侧边轨道 | 宽 **64–96px** | 仪表盘、控制台 | 图标轨；桌面专用 |

> ⚠️ **引用了数值就要照做。** 笔者曾引用"侧轨 64–96px"却做成 232px，既偏离配方又超出规范 2.4 倍。
> ⚠️ 侧轨是**通用章节的备选**，不是 Ark 家族的配方。不确定时用**顶栏**。

### 3.2 顶栏

```css
.nav{position:fixed;top:0;left:0;width:100%;z-index:100;height:56px;
  display:flex;align-items:center;justify-content:space-between;padding:0 24px;
  background:rgba(8,10,11,.86);
  -webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
  border-bottom:1px solid var(--rule)}
```

导航项前置 **`NN` 索引**（CSS 计数器自动生成），选中态为底部 **2px 信号色线**：

```css
.nav-links{display:flex;gap:26px;counter-reset:nav}
.nav-links a{counter-increment:nav;position:relative;padding:19px 0;
  font-size:11px;letter-spacing:var(--ls-caps);text-transform:uppercase;
  color:var(--muted);transition:color var(--t-fast) var(--ease-out)}
.nav-links a::before{content:counter(nav,decimal-leading-zero);margin-right:7px;
  font-family:var(--mono);font-size:9px;color:var(--disabled)}
.nav-links a::after{content:"";position:absolute;bottom:0;left:0;width:100%;height:2px;
  background:var(--signal);transform:scaleX(0);transform-origin:left;
  transition:transform var(--t-base) var(--ease)}
.nav-links a.on{color:var(--paper)}
.nav-links a.on::after{transform:scaleX(1)}
```

### 3.3 舞台（主视觉）

```css
.hero{position:relative;height:100vh;display:flex;
  align-items:flex-end;justify-content:flex-start;   /* ← 左下锚定，不居中 */
  overflow:hidden}
.hero-title{
  font-family:var(--display);font-weight:700;text-transform:uppercase;
  font-size:clamp(64px,15vw,190px);
  line-height:.82; letter-spacing:var(--ls-display);
  margin-left:-.055em;                                /* ← 字形左端刻意溢出被裁切 */
  white-space:nowrap; color:var(--paper)}
.hero-bg{position:absolute;inset:0;                          /* 暗角 */
  background:radial-gradient(ellipse at 50% 45%,transparent 22%,rgba(0,0,0,.58) 100%)}
.hero-scanlines{position:absolute;inset:0;opacity:.22;pointer-events:none;   /* ≤22% */
  background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.05) 2px,rgba(0,0,0,.05) 4px)}
```

关键三点：**左下锚定**、**极紧行高 + 负字距**、**允许字形在视口边缘被裁切**。

### 3.4 区块与索引

```css
body{counter-reset:sec}
.sec{max-width:1200px;margin:0 auto;padding:80px 24px}
.sec-hd{display:flex;align-items:center;gap:14px;margin-bottom:40px;
  counter-increment:sec}          /* ← 计数器挂在标题上，没标题的区块自然不占号 */
.sec-tag{display:flex;align-items:center;gap:12px;white-space:nowrap;
  font-size:11px;font-weight:700;letter-spacing:.14em;
  color:var(--signal);text-transform:uppercase}
.sec-tag::before{content:counter(sec,decimal-leading-zero) " / ";
  font-family:var(--mono);font-weight:400;color:var(--muted)}
.sec-line{flex:1;height:8px;background:                        /* 警戒线 + 细线 */
  var(--stripe) left center/38px 8px no-repeat,
  linear-gradient(var(--rule),var(--rule)) left center/100% 1px no-repeat}
```

> ⚠️ 计数器**不要挂在 `.sec` 上再用 `:has()` 过滤** —— 选择器支持差异会让编号错位。挂在标题元素上最稳。

### 3.5 响应式

```css
/* 竖屏重排：orientation 必须与宽度上限组合，否则宽屏高窗口会误判为手机 */
@media(max-width:768px),(max-width:1024px) and (orientation:portrait){
  .nav-links{display:none} .burger{display:block}
  .sec{padding:56px 16px}
}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;
    transition-duration:.01ms!important;scroll-behavior:auto!important}
}
```

**竖屏要重新编排，不是等比缩小。**

---

## 4. 组件配方

### 4.1 45° 切角（含连续边框线）

舟味最标志性的特征。**方向统一为左上 + 右下**，同界面不混用。

```css
/* 切角主体 */
.chamfer{
  --cut:var(--cut-md);
  clip-path:polygon(var(--cut) 0,100% 0,100% calc(100% - var(--cut)),
                    calc(100% - var(--cut)) 100%,0 100%,0 var(--cut));
}
/* 切角处的 1px 边框线必须连续（45° 斜线，长度 = 切角 × √2） */
.chamfer::before{
  content:"";position:absolute;left:0;top:calc(var(--cut) - 1px);
  width:calc(var(--cut) * 1.4143);height:1px;background:var(--line);
  transform:rotate(-45deg);transform-origin:0 50%;z-index:1;
}
```

**切角尺寸**：大面板 10–14px｜中卡片 8–10px｜标签 4–6px（左上单切）｜按钮 6–8px

**标签的单切**（只切左上）：

```css
clip-path:polygon(var(--cut-xs) 0,100% 0,100% 100%,0 100%,0 var(--cut-xs));
```

### 4.2 技术面板

**只保留一条强边**，不要四边等重的卡片盒子。

```css
.panel{
  position:relative;padding:32px;
  background-color:var(--ink-2);
  border:1px solid var(--line);
  border-left:2px solid var(--signal);            /* ← 唯一强边 */
  /* 角标括号（取景框感）：右上 + 左下（另两角被切角占了） */
  background-image:linear-gradient(var(--signal),var(--signal)),linear-gradient(var(--signal),var(--signal)),
                   linear-gradient(var(--signal),var(--signal)),linear-gradient(var(--signal),var(--signal));
  background-position:right top,right top,left bottom,left bottom;
  background-size:12px 1px,1px 12px,12px 1px,1px 12px;background-repeat:no-repeat;
}
```

### 4.3 操作按钮

**方角 + 左侧信号条**是 Ark/Endfield 的按钮语言。

```css
.btn{
  display:inline-flex;align-items:center;gap:10px;min-height:44px;
  padding:12px 24px 12px 20px;
  font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--paper-2);background:var(--ink-2);cursor:pointer;
  border:1px solid var(--line);border-left:2px solid var(--signal);
  transition:background var(--t-fast) var(--ease-out),color var(--t-fast) var(--ease-out),
             border-color var(--t-fast) var(--ease-out);
}
.btn:hover{background:var(--ink-3);border-color:var(--line-h);color:var(--paper)}
.btn:active{transform:scale(.98)}
```

### 4.4 标签 Chip

```css
.tag{
  display:inline-flex;align-items:center;height:26px;padding:0 9px;
  font-size:11px;font-weight:500;letter-spacing:.04em;
  color:var(--paper-2);background:var(--ink-3);border:1px solid var(--line);
  clip-path:polygon(var(--cut-xs) 0,100% 0,100% 100%,0 100%,0 var(--cut-xs));
}
```

### 4.5 列表项

**悬停换底，不做位移**（位移会让列表"跳"）。

```css
.list-item{
  display:flex;align-items:center;gap:16px;
  padding:15px 16px 15px 14px;
  border-bottom:1px solid var(--rule);
  border-left:2px solid transparent;
  transition:background var(--t-fast) var(--ease-out),border-color var(--t-fast) var(--ease-out);
}
.list-item:hover{background:var(--ink-3);border-left-color:var(--signal)}
```

### 4.6 状态徽标

**酸性绿实底 + 墨色字**——这是方舟的"成功/可用"色，用了就很有辨识度。

```css
.badge{
  font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink);background:var(--state);padding:5px 11px;
  clip-path:polygon(var(--cut-xs) 0,100% 0,100% 100%,0 100%,0 var(--cut-xs));
}
```

### 4.7 微标签（等宽 + 放开字距）

```css
.micro{
  font-family:var(--mono);font-size:9px;font-weight:500;
  letter-spacing:.2em;text-transform:uppercase;color:var(--muted);
}
/* 所有数字都加等宽数字特性 */
.num{font-variant-numeric:tabular-nums}
```

---

## 5. 动效

### 5.1 时长与缓动

| 场景 | 时长 |
|---|---|
| 直接交互（悬停/按下） | **180–350ms** |
| 区块显现 | **500–900ms** |
| 克制的注意力循环 | **1.6–2.4s** |

```css
--ease:cubic-bezier(.22,.8,.2,1);   /* 或直接 ease-out */
```

**禁止** `elastic` / `bounce` / `back` 等任何回弹缓动。

### 5.2 揭示动画（含强制兜底）

> ⚠️ **这一节是本规范里唯一"不写就会出事故"的地方。**

```css
.reveal{
  opacity:0;transform:translateX(-14px);
  transition:opacity var(--t-reveal) var(--ease),transform var(--t-reveal) var(--ease);
  animation:revealSafe 0s linear 3s forwards;   /* ← 兜底：观察器失效也会强制显现 */
}
.reveal.is-visible{opacity:1;transform:none}
@keyframes revealSafe{to{opacity:1;transform:none}}
```

**三条硬性要求**：

1. **隐藏态只用 `opacity` + `transform`** —— 不要用 `clip-path`、`visibility`、`display`、`height:0`
2. **必须加兜底动画** —— 任何"依赖 JS 才能显示"的内容，都要有 CSS 层的失效保护
3. **元素类由 JS 添加** —— JS 失效时元素正常可见（渐进增强），而不是永远隐藏

### 5.3 禁止项

- ❌ `clip-path` / `mask` 做隐藏态（见 §9.2）
- ❌ 无限旋转 loading（用进度条或徽记呼吸代替）
- ❌ 3D 翻转 / 翻页 / 立方体转场
- ❌ 闪烁频率 >3Hz
- ❌ 鼠标跟随特效、粒子拖尾
- ❌ `prefers-reduced-motion` 下仍在跑的循环动画

---

## 6. 无障碍基线

```css
:focus-visible{outline:2px solid var(--signal);outline-offset:2px}
```

- 交互目标 **≥40×40px**（本规范统一用 `min-height:44px`）
- **纯图标控件必须有无障碍名称** —— 不得用 CSS 隐藏文字来做纯图标导航
- 必要标签不得烤进背景图
- 有意义图像给 `alt`，装饰图给空 `alt`
- 尊重 `prefers-reduced-motion`
- 禁止自动播放音频
- 即便参考站在用"图里的文字"，**真实文本仍要测 WCAG 对比度**

---

## 7. 资产流水线

### 7.1 从设计稿到可用 SVG（字体子集化）

**问题**：设计工具导出的 SVG 常把字体以 base64 内嵌，一份 CJK 字体动辄 1MB+。若 logo 只有十几个字，**99% 的体积是浪费**。

**判断方法**：去掉 base64 后看剩下多少

```bash
python3 -c "
import re;s=open('logo.svg',encoding='utf-8').read()
print(len(re.sub(r'base64,[A-Za-z0-9+/=]+','base64,X',s)),'字节（去字体后）')"
```

若结果只有几百字节 → 走子集化。

**流程**

```bash
# 1) 提取内嵌字体（可能是 WOFF2）
python3 - <<'PY'
import re,base64
s=open('logo.svg',encoding='utf-8').read()
for name,mime,b64 in re.findall(r"@font-face\s*\{\s*font-family:\s*'([^']+)';\s*src:\s*url\('data:([^;]+);base64,([A-Za-z0-9+/=]+)'\)",s):
    open(name+'.woff2','wb').write(base64.b64decode(b64))
PY

# 2) WOFF2 → TTF（需要 brotli；无 C 扩展时可用 node 内置 brotli 搭桥）
#    fontTools 需要 brotli.decompress / compress(data, mode=MODE_FONT)
pyftsubset font.ttf --text='用到的字符' --flavor=woff2 \
  --layout-features= --no-hinting --desubroutinize --output-file=out.woff2

# 3) 把 SVG 里 @font-face 的 base64 换成子集
```

**实测效果：1081 KB → 3.7 KB（-99.7%）**，浏览器渲染完全一致。

> 关键细节：替换正则别漏了 `src: url('...');` 结尾的**分号** —— 少了它替换会静默失败，文件大小一点不变。

### 7.2 ⚠️ 命令行渲染器不认内嵌字体

`resvg` 和 `rsvg-convert` **都会跳过 `@font-face`** 并回退到系统字体，产出**错误**的位图（且不报错）。

若必须命令行渲染：

1. 用 fontTools 把子集字体的**族名改成 SVG 里 `font-family` 引用的名字**
2. 写一份本地 `fonts.conf`，用 `FONTCONFIG_FILE` 指过去
3. `fc-cache -f` 后渲染

**但浏览器直接渲染无需任何处理** → **校验渲染优先用无头浏览器截图**。

### 7.3 favicon 全套

需要产出：`favicon.ico`（16/32/48/64 多尺寸）+ `favicon-16/32/48.png` + `apple-touch-icon.png`（180）+ `icon-192/512.png`

```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta name="theme-color" content="#080a0b">
```

**两个易踩的点**：

- **正方化**：logo 若不是正方形，用**与背景同色/透明**的画布补边（不是裁切）
- **透明底白字在浅色浏览器主题下会看不见** —— 需提供 `media="(prefers-color-scheme: light)"` 的深色底变体，或干脆给 favicon 加一层实底

### 7.4 渲染校验（唯一可靠手段）

无头浏览器截图**在 load 事件时触发**，早于 IntersectionObserver 回调 —— 会误判成"内容不可见"。

**用一张延迟响应的图片拖住 load 事件**：

```python
# 简易服务器：/slow.gif 路径 sleep 5 秒
if self.path.startswith('/slow'):
    time.sleep(5); ...返回 1x1 gif...
```

```bash
firefox --headless --no-remote --profile /tmp/p \
        --window-size=1440,1000 --screenshot out.png http://localhost:PORT/page.html
```

---

## 8. 落地工作流

### Phase 0 · 定调（改代码前完成）

- [ ] 确认目标家族是 **Ark**（近黑+青），不是别的（见 §1.2）
- [ ] 确认 Shell 选**顶栏**（除非确有仪表盘需求）
- [ ] 确认应用深度：产品/内容型 → `moderate`；游戏化/展示型 → `complex`
- [ ] 声明"本界面必须让用户完成什么" —— 这一条决定信息架构

### Phase 1 · 令牌层

- [ ] 复制 §2.5 的 `:root`
- [ ] `body` 套上 §2.6 的基底纹理
- [ ] **此后所有颜色只引用变量，不在组件里写死色值**

### Phase 2 · Shell

- [ ] 顶栏（§3.2），导航项带 `NN` 索引与 2px 信号色选中线
- [ ] 主视觉舞台（§3.3）：左下锚定 + 大字 + 暗角
- [ ] 区块系统（§3.4）：`NN /` 索引 + 警戒线标尺
- [ ] 响应式（§3.5）：竖屏重排 + `prefers-reduced-motion` 降级

### Phase 3 · 组件

- [ ] 面板（§4.2，**单一强边**）、按钮（§4.3，**左信号条**）
- [ ] 标签（§4.4）、列表（§4.5）、徽标（§4.6）、微标签（§4.7）
- [ ] 切角统一为**左上 + 右下**，且边框线连续（§4.1）

### Phase 4 · 资产

- [ ] logo 走子集化流水线（§7.1）
- [ ] favicon 全套，含浅色主题考量（§7.3）

### Phase 5 · 验收

- [ ] 跑 §10 清单

---

## 9. 反模式与陷阱

### 9.1 视觉反模式

| 症状 | 原因 | 修法 |
|---|---|---|
| "说不上来哪里不对，但不像方舟" | 用了藏蓝/深灰蓝而非近黑+青 | 换 §2.3 的信号色 |
| 画面很"闷" | 中性表面占比过高、缺信号色点睛 | 只在 1–2 个交互点加信号色 |
| 画面很"吵" | 信号色用多了，或每个模块都描边 | 信号色 <15%；面板只留一条强边 |
| 卡片"发飘" | 用了圆角 + 投影 | 圆角归零，改用 1px 细线 + 遮罩 |
| 小尺寸下 logo 糊成一团 | 标志细节过多（元素 >3 个） | 裁切出最简形态，或做单字徽记 |
| 文字读不清 | 三级文字用了 `--muted` 却承载正文 | 正文必须用 `--paper-2` 及以上 |

### 9.2 工程陷阱

| 症状 | 根因 | 修法 |
|---|---|---|
| **内容永久不可见，无任何报错** | 用 `clip-path: inset(0 100% 0 0)` 做隐藏态 → 可见面积为 0 → **IntersectionObserver 不再报告相交** → `.is-visible` 永不添加 | 改用 `opacity`+`transform`，并加兜底动画（§5.2） |
| 样式改了但线上不生效 | 静态资源**未做指纹化**，固定 URL + 长缓存 → 老 CSS 配新 HTML | 加内容哈希到文件名（`main.<hash>.css`） |
| 宽屏高窗口被当成手机 | `@media (orientation:portrait)` 单独作断点 | 加宽度上限：`(max-width:1024px) and (orientation:portrait)` |
| 区块编号错位 | 无标题的区块也占用序号；或依赖 `:has()` | 计数器挂到标题元素上（§3.4） |
| 跨文件状态不同步 | 两处用了不同的 key（如 `a_played` vs `b_loaded_at`） | **共享状态必须同名**，写进常量 |
| SVG logo 1MB+ | 内嵌整份 CJK 字体 | 子集化（§7.1） |
| 命令行渲染字形错误 | 渲染器跳过 `@font-face` 且不报错 | 字体改名 + fontconfig，或用浏览器校验（§7.2） |
| 字体支持差异导致构建失败 | 本地与 CI 的字体/工具版本不一致 | **改动前先确认目标版本**，本地对齐 |

---

## 10. 验收清单

### 色彩

- [ ] 无纯黑 `#000` 大面积背景
- [ ] 无高饱和纯色（`#FF0000` 类）、无彩虹渐变、无发光/霓虹
- [ ] 中性表面 ≥75%，信号色 <15%
- [ ] 所有颜色来自令牌变量，组件内无硬编码色值

### 形状

- [ ] 圆角为 0（功能性圆角 ≤4px）
- [ ] 切角统一方向，且**切角处边框线连续**
- [ ] 没有"每个模块都是描边卡片"

### 排版

- [ ] 显示标题 `line-height ≤.95`、字距为负
- [ ] 微标签字距 ≥.08em 且大写
- [ ] 数字用等宽数字（`tabular-nums`）
- [ ] 正文无居中堆砌、无两端对齐
- [ ] 无艺术字体/手写体/圆体

### 动效

- [ ] 全部在 180–350ms（交互）或 500–900ms（显现）区间
- [ ] 无回弹缓动、无无限旋转、无 >3Hz 闪烁
- [ ] **隐藏态未使用 `clip-path`/`mask`**，且有**兜底动画**
- [ ] `prefers-reduced-motion` 下所有循环停止

### 无障碍

- [ ] `:focus-visible` 可见（2px 信号色 + 偏移）
- [ ] 交互目标 ≥40×40px
- [ ] 纯图标控件有无障碍名称
- [ ] 对比度达标

### 资产

- [ ] logo SVG 已子集化（去字体后 <10KB）
- [ ] favicon 全套齐备，且考虑了浅色主题
- [ ] 用无头浏览器在**真实尺寸**下校验过渲染

---

## 11. 框架适配

规范本身**与框架无关**，落地方式有三种：

### 11.1 纯静态 / 静态站生成器

直接引一个 CSS 文件。令牌放 `:root`，组件按 §4 写类名。

```html
<link rel="stylesheet" href="/css/ark.css">
```

### 11.2 React / Next.js

- **令牌层**：一个 `globals.css` 里的 `:root`
- **组件层**：CSS Modules 或 Tailwind 的 `@theme`（把令牌映射成 utility）
- **不要**把坐标写成 inline style —— 视觉家族属于 CSS 层
- 揭示动画用 `useEffect` + `IntersectionObserver`，**CSS 侧的兜底动画不能省**（§5.2）

### 11.3 Vue / Svelte

同上，语义组件边界一致。Svelte 用 `<style>` 时注意**不要 `<style scoped>` 掉 `:root`**。

### 11.4 设计令牌的三种落地

| 方式 | 适用 | 说明 |
|---|---|---|
| CSS 自定义属性 | **默认推荐** | 零构建、可运行时切换、DevTools 可调 |
| JSON + 构建脚本 | 多端（Web + 小程序 + App） | 用 `design-tokens` 规范格式，脚本生成各端变量 |
| 框架主题配置 | Tailwind / Chakra 等 | 把 §2.5 的键值映射进去 |

**无论哪种，`--signal` 只有一个，且不得被覆盖成第二个强调色。**

---

## 12. 来源与许可

本规范整理自以下公开来源，**仅供学习参考**：

| 来源 | 内容 |
|---|---|
| `ark-ui-skill`（GitHub: `Brandon030722/ark-ui-skill`） | 基于鹰角**公开 Web 前端**逆向的设计语言、五家族配方、实现证据 |
| [《明日方舟》UI/UX 分析——藏在好看背后的先进性](https://gameinstitute.qq.com/index.php/knowledge/100122) | 设计理念：Diegetic Interface、双签名纹理、焦距控制、过场衔接 |
| [ignoredone.space](https://www.ignoredone.space/index.php/resource/) | 方舟设计圈字体选型参考 |

> ⚠️ **两条边界**
> ① `ark-ui-skill` 的证据全部来自鹰角**官网/营销站**，其自身声明 `Do not infer the company's internal game UI stack from marketing websites.` —— 它能支撑"品牌官网的排版语言"，**不能直接支撑"游戏内主界面长什么样"**。
> ② **本规范只描述设计语言，不包含任何鹰角专有资产**（logo、立绘、图标表、字体文件）。落地时请使用**原创**图形与**已授权**字体。若字体为商业字体（汉仪、方正、华为等），须自行确认授权；本规范推荐的字体栈全部走**本地回退**，不分发字体文件。

---

*本规范由实际项目实践整理，可自由用于任何项目。改动设计语言后请 bump 版本。*
