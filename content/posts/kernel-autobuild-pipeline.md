---
title: "内核自动构建流水线：从计划任务到 151MB 的包"
date: 2026-09-26T21:00:00+08:00
draft: false
tags: ["内核", "自动化", "CachyOS", "Docker", "Shell", "CI"]
categories: ["技术笔记"]
summary: "把「每次人工同步源码 + 编译内核」变成「定时任务自动跑」：1Panel 计划任务触发 → 检查上游版本 → 下载验签 → 重放式合并 PKGBUILD → 容器内编译 → 产物校验 → 微信通知。全链路逐脚本拆解。"
---

[定制内核](/posts/custom-cachyos-kernel/)这件事，编一次是折腾，编十次就是折磨。每次上游发新版，流程都是同一套，查 release、下源码、验签、改 PKGBUILD 版本变量、重算 b2sums、清 `src/`、编译一小时、校验产物、拉回本机。

每一步都可能出错。而人会累、会忘、会在半夜两点把 `src/` 忘了清。

所以我把这一整套做成了自动化流水线，定时任务触发 → 检查上游 → 自动同步 → 自动编译 → 微信通知。这篇文章把从 1Panel 计划任务被触发，到内核包躺进 `pkgs/` 的每一步都写出来了。

所有结论来自对实际脚本的逐行阅读（标注行号），可以对照复核。

## 全景链路

```
1Panel 计划任务（每天北京时间 22:00）
        │
        ▼
cachy-autobuild.sh  ← 867 行 · 总指挥（root 自动降权为 kb）
        │
        ├─ 前置检查 + 版本检查（GitHub releases，API→atom 兜底）
        ├─ 阶段 3-6    下载 → 验签 → 补丁 → 重放式合并上游 PKGBUILD
        ├─ 阶段 7      版本变量 + 重算 b2sums
        ├─ 阶段 8      makepkg -o：解包 + prepare()
        ├─ 阶段 9      NEXT-STEP.sh → docker + makepkg -e   ★ 真正编译
        └─ 阶段 10-11  产物校验 → 收尾 → Server酱通知
        │
        ▼
pkgs/linux-cachyos-<ver>-1-x86_64.pkg.tar.zst（约 151M）
             …-headers-…pkg.tar.zst（约 38M）
```

一句话概括，1Panel 只负责到点叫醒，剩下的全部由脚本自理。每个阶段的逐行细节见下文第 4 节。

## 触发层：1Panel 计划任务

任务配置读自 `/opt/1panel/db/agent.db` 的 `cronjobs` 表。

| 字段 | 值 | 说明 |
|---|---|---|
| `spec` | `0 14 * * *` | cron「分 时 日 月 周」，按**服务器时区 UTC** 执行 ⇒ 北京时间每天 22:00 |
| `script_mode` | `select` | 「路径选择」模式 |
| `script` | `/home/kb/bin/cachy-autobuild.sh` | 只填脚本路径 |
| `user` | `root` | 1Panel 以 root 执行；脚本内部自动降权为 kb |
| `timeout` | `14400`（秒）= 4 小时 | 防止面板掐断长编译 |
| `retry_times` | `0` | 不做面板级重试（重试逻辑由脚本自理，避免一晚烧完额度） |
| `retain_copies` | `30` | 执行记录保留 30 份 |

### 时区坑（已实证）

这是配定时任务时最容易踩的一个。1Panel 内嵌前端生成 cron 的代码是直接拼接的（`每天 → ${minute} ${hour} * * *`），不做浏览器时区换算。

所以规则很简单，也很反直觉，**想跑北京 T 点，面板就填（T − 8 小时）**。我填 `14:00`，实际跑在北京时间 22:00。

另外 `retry_times=0` 是刻意的。面板级重试是无脑重试，一晚上能把 4 小时超时跑满好几轮。重试逻辑交给脚本自己判断（跨天、逐次通知、有上限）要合理得多。

执行痕迹在面板日志里长这样，`14:00:00 执行 [cronjob-Cachy通用内核-自动构建] 任务开始 [START] … [TASK-END]`。

## 脚本清单（职责矩阵）

| 脚本/文件 | 行数 | 位置 | 角色 |
|---|---|---|---|
| `cachy-autobuild.sh` | 867 | `编译服务器:/home/kb/bin/` | 总指挥：检查/更新/编译/通知/状态 |
| `cachy-autobuild.env` | 35 | 同上（权限 600） | 配置：SendKey、通知级别、重试/并行/清理参数 |
| `cachy-merge-upstream.py` | 120 | 同上 | 上游配方「重放式合并」 |
| `NEXT-STEP.sh` | 31 | `编译服务器:/home/data2/cachy-build/` | 编译入口（docker + makepkg） |
| `PKGBUILD` | 848 | `…/work/linux-cachyos-v3-nola57/` | 内核配方（决定编译参数与打包） |
| `config` | — | 同上 | 种子内核配置（与 CachyOS 官方一致） |
| `Dockerfile` | 47 | `/home/kb/cachy-payload/` | 编译容器镜像定义 |
| `setup.sh` | 102 | 同上 | 环境一次性初始化（2026-08-31） |
| `hook-la57.txt` / `hook-localversion.txt` | 20 / 1 | 同上 | 注入 PKGBUILD 的载荷片段 |

## `cachy-autobuild.sh` 逐段解析（867 行）

| 行号 | 段落 | 内容 |
|---|---|---|
| L17 | 环境 | 固定 PATH |
| L19-32 | **降权** | root 时 `runuser -u kb -- /home/kb/bin/cachy-autobuild.sh`（1Panel 以 root 跑；makepkg/docker 需要 kb 身份与 data2 权限）。被复制执行时回退规范安装路径 |
| L34-43 | 定位 | `set -u`；`SELF_DIR/SCRIPT_DIR` 回退逻辑；加载 `cachy-autobuild.env` |
| L45-55 | 参数 | SENDKEY、NOTIFY_STAGES、NOTIFY_NOIP、**NOTIFY_NOOP**、MAX_RETRY、MAJOR_REMIND_DAYS、JOBS_DEFAULT=40、JOBS_FALLBACK=8、CPUSET_FALLBACK=0-7、KEEP_TARBALLS=2、LOG_KEEP_DAYS=30 |
| L57-76 | 常量 | ROOT/WORK/PKGBUILD/SRCS/PKGS/AUTODIR/STATE/LAST-RESULT/UPDIR/TMPD；ghfast 前缀；GitHub API |
| L78-105 | 参数解析 | `--check-only / --dry-run / --simulate-remote / --force / --yes-major / --test-notify / --self-test` |
| L107-116 | 日志 | 北京时间戳；`log()` 同时写终端与运行日志；`die()` |
| L118-130 | 状态 | `state_get/state_set`（pending/attempts/target_ver/last_ok_ver/…）；`write_last` 写 LAST-RESULT |
| L132-156 | **通知** | `notify()`：Server酱 POST（title/short/desp）；空正文兜底为占位并打 `NOTIFY-WARN`；重试 3 次；**失败绝不影响主流程** |
| L158-182 | 阶段模型 | 11 阶段数组（前置检查…收尾）＋ 表格渲染（供通知） |
| L184-254 | 版本工具 | `local_version`（读 PKGBUILD 三变量）；`ver_gt/series_gt`；**`fetch_remote`**：GitHub API（gzip/per_page=30）→失败改用 **atom feed** 兜底 →聚合出「同系列最新」与「最新稳定大版本」；`has_products` |
| L256-397 | 消息模板 | M1 开始 / M2 编译开始 / M3 成功 / 失败 / 需人工 / 大版本 / OOM / 巡检回执（共 12 类事件） |
| L399-411 | 失败处理 | `fail_stage`：阶段置 ❌、attempts+1、记录 last_fail、发失败通知、写 LAST-RESULT、exit 1 |
| L414-438 | **阶段3 下载** | 镜像链下载 tarball（失败/过慢自动换源、`-C -` 断点续传）＋ `.asc`；记录大小/耗时 |
| L440-452 | **阶段4 验签** | `gpg --verify`；缺公钥时自动 `--recv-keys`（Eric Naim / Peter Jung）后重试 |
| L454-471 | **阶段5 补丁** | 从 `kernel-patches/master/<_major>/` 拉 bore 与 dkms-clang 补丁，md5 对比给出「新增/未变/已更新」 |
| L473-522 | **阶段6 合并** | 拉上游 master PKGBUILD → 与快照 diff（差异留档 `drift-*.diff`）→ `cachy-merge-upstream.py` 重放 → 三重校验（断言＋`bash -n`＋容器内 `makepkg --printsrcinfo`）→ 成功替换（旧文件备份 `PKGBUILD.premerge-*.bak`）、失败**自动回退**旧配方 |
| L524-556 | **阶段7 PKGBUILD** | 版本变量逐个比对后才 `sed`；容器内 `makepkg -g` 重算 b2sums，**内容不变不写**（保住 mtime ⇒ 重试可跳过 prepare） |
| L558-571 | **阶段8 prepare** | `rm -rf src/*` → 容器内 `makepkg -o`（解包＋prepare()）→ 校验输出：`Prepared…`、LA57 生效、`version` 含 `Power-by-R730` |
| L573-595 | **阶段9 编译** | 调 `NEXT-STEP.sh`；失败且日志含 OOM 特征（Killed/signal 9）→ 发通知并自动降级 `JOBS=8 CPUSET=0-7` 续编一次；校验 `Finished making` |
| L597-609 | **阶段10 校验** | 找产物、大小、sha256 前 12 |
| L611-620 | **阶段11 收尾** | 状态复位；清理（源码包留 2 个、日志留 30 天、drift 30 天）；写 LAST-RESULT；发「✅ 编译成功」 |
| L622-655 | 自检 | `--self-test`：渲染全部消息模板，捕捉未定义变量 |
| L657-867 | **main** | flock 锁 → test-notify/数据盘/docker/网络/远端各退出分支（均有回执）→ 版本判定 → 大版本交互（TTY 时 y/N，否则中断+通知）→ 重试上限判定 → 两条路径（全流程 L835-842 / 重试 L843-861）→ 阶段 9/10/11 |

有几个设计细节值得单独拎出来说。

**降权（L19-32）**：1Panel 以 root 跑任务，但 `makepkg` **拒绝以 root 身份执行**，而且构建产物要写到 kb 拥有的 `/home/data2`。所以脚本第一件事就是把自己 `runuser` 降权成 kb，重新执行一遍。

**通知失败不影响主流程（L132-156）**：`notify()` 里所有错误都被吞掉。通知是锦上添花，绝不能因为微信通道抖动把一次成功的编译标记为失败。

**内容不变不写（L524-556）**：这不只是省事。PKGBUILD 的 mtime 决定了 makepkg 会不会重新 prepare；重试路径下保住 mtime，就能直接跳到增量续编。

## `cachy-merge-upstream.py`（120 行）：上游配方「重放式合并」

说真的，这是整条流水线里我最满意的一个设计。

上游的 PKGBUILD 一直在变，如果我 fork 一份然后手工维护，迟早会和上游越走越远，最后没法合并。所以做法反过来，把上游 master 的 PKGBUILD 当基座，用 `re.subn` 逐项重放我们的 8 项定制；缺任一锚点即整体失败（触发回退旧配方）。

| # | 定制项 | 目标值 |
|---|---|---|
| 1 | 调度器 | `_cpusched:=bore`（上游默认 cachyos，同为 BORE 补丁，我们显式锁定） |
| 2 | CPU 基线 | `_processor_opt:=generic_v3`（x86-64-v3） |
| 3 | LTO | `_use_llvm_lto:=thin`（clang ThinLTO） |
| 4 | 包名后缀策略 | `_use_lto_suffix:=no`、`_use_gcc_suffix:=yes`（包名稳定为 `linux-cachyos`） |
| 5 | 镜像 | `_patchsource` 与 release URL 加 `ghfast.top` 前缀（幂等） |
| 6 | NVIDIA 模块锁版 | `_nv_ver=610.57.04` |
| 7 | 构建身份 | `KBUILD_BUILD_HOST=R730`、`KBUILD_BUILD_USER=K-Black` |
| 8 | 版本串 + LA57 | 注入 `localversion.30-custom`（`-Power-by-R730-Compiled-by-K-Black`）与 **LA57 硬禁用块** |

结尾执行 **11 项存在性断言**，全过才输出 `merge-ok`。

关键在"缺锚点就整体失败"这个语义。如果上游把某一行改了导致 `re.subn` 匹配不到，脚本**不会**静默产出一个丢掉了 LA57 补丁的 PKGBUILD，而是直接失败并回退旧配方继续编译。宁可编一个旧版本的、确定正确的内核，也不要编一个看起来新、实则少了定制的内核。

## `NEXT-STEP.sh`（31 行）：编译入口

```bash
JOBS="${JOBS:-40}"        # 并行度；OOM 就调小
CPUSET="${CPUSET:-}"      # 例 0-11：同时限住 make -j 与 ld.lld 的 ThinLTO 后端线程
ROOT=/home/data2/cachy-build
LOG="$ROOT/build-$(date +%m%d-%H%M).log"

docker run --rm "${TTY[@]}" ${CPUSET:+--cpuset-cpus="$CPUSET"} \
  -e MAKEFLAGS="-j$JOBS" -v "$ROOT":/build \
  cachy-kbuild:latest \
  makepkg -e -s --noconfirm 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
```

两个要点。

- `-e`（`--noextract`）= 跳过解包与 prepare，直接使用阶段 8 已验证的源码树 ⇒ 这也是中断后重试可增量续编的根基
- `CPUSET` 是控内存最有效的旋钮，**`ld.lld` 的 ThinLTO 后端线程按 `sched_getaffinity` 取值，不看 `make -j`**。要真正压住内存峰值，得限制容器可见的 CPU 集合

日志落 `build-MMDD-HHMM.log`；退出码经由 `PIPESTATUS` 传出（管道场景下 `$?` 是 `tee` 的，不是 `makepkg` 的）。

## 容器 `cachy-kbuild:latest`

镜像要点（Dockerfile 47 行）。

| 行号 | 内容 |
|---|---|
| L1-4 | `FROM archlinux:base-devel`；TUNA/USTC/阿里三源 |
| L7-11 | 内核构建依赖：base-devel + bc/cpio/gettext/libelf/elfutils/openssl/flex/bison/pahole/perl/python/rust/rust-bindgen/rust-src/xxhash/zlib/zstd + **clang/llvm/lld** |
| L14-20 | `builder` 用户（uid/gid 1000 对齐宿主 kb）；免密 sudo；`USER builder`（makepkg 拒绝 root） |
| L22-36 | **预导入两把 CachyOS 公钥**并断言恰好 2 把（关 keyboxd 防锁残留） |
| L38-45 | `/home/builder/.makepkg.conf`：`PACKAGER="K-Black <kb@R730>"`、`PKGDEST/pkgs`、`SRCDEST/srcs`、`COMPRESSZST=(zstd -c -T0 -8 -)`；**故意不设 MAKEFLAGS**（让 `docker run -e` 生效） |
| L47 | `WORKDIR /build/work/linux-cachyos-v3-nola57` |

镜像构建于 2026-08-31（约 894MB）。容器内工具链是 makepkg 7.1.0、clang 22.1.8、ld.lld。

那个"断言恰好 2 把公钥"的小检查很实用。`gpg --import` 如果因为 keyboxd 锁残留而只导入一把，验签阶段才会莫名其妙地失败，不如在镜像构建时就把问题堵死。

## `PKGBUILD`（848 行）与内核编译

### 构建选项（生效值，L8-155）

| 变量 | 值 | 落点（prepare 内 `scripts/config`） |
|---|---|---|
| `_cpusched` | **bore** | `-e SCHED_BORE`（L360-367） |
| `_processor_opt` | **generic_v3** | `-e GENERIC_CPU --set-val X86_64_VERSION 3`（L344-345） |
| `_use_llvm_lto` | **thin** | `-e LTO_CLANG_THIN`（L378-384）＋启用 clang 工具链与 dkms-clang 补丁 |
| `_cc_harder` | yes | `-O3`：`-d CC_OPTIMIZE_FOR_PERFORMANCE -e CC_OPTIMIZE_FOR_PERFORMANCE_O3`（L437-442） |
| `_HZ_ticks` / `_tickrate` | 1000 / full | `HZ=1000` ＋ `NO_HZ_FULL` 全无滴答（L395-422） |
| `_preempt` | full | `-e PREEMPT -d PREEMPT_LAZY`（L424-435） |
| `_hugepage` | always | `-e TRANSPARENT_HUGEPAGE_ALWAYS`（L469-476） |
| `_cachy_config` | yes | `-e CACHY`（L353-357） |
| `_use_kcfi` / `_build_zfs` / `_build_nvidia_open` / `_build_r8125` / `_build_debug` / `_autofdo` / `_propeller` | 全 no | 均不启用（仅出 2 个包） |
| `_use_debug_info` | **yes**（默认保留，可切 no） | no 时关闭 `DEBUG_INFO`/`BTF`（编译更快、体积更小；env 文件可切） |

### 源与校验（L214-286）

`_patchsource` 与源码 URL 走 ghfast；`source=()` 里是 tarball + asc、`config`、dkms-clang.patch、（bore 分支追加）`0001-bore-cachy.patch`。`validpgpkeys` 两把；`b2sums` 5 条（tarball / asc-SKIP / config / dkms / bore）。镜像被投毒会被 b2sum 校验揪出。

### `prepare()`（L294-545）：把通用配置变成"我们的内核"

1. 写 `localversion.10-pkgrel / .20-pkgname / .30-custom` → 决定 `uname -r`
2. 打补丁（bore、dkms-clang，`patch -Np1`）
3. `cp ../config .config`（种子 config，与 CachyOS 官方一致）
4. **LA57 硬禁用**：若 `X86_5LEVEL` 仍存在则 disable；否则给解压器 `pgtable_64.c` 打 sed 补丁（= 永久 `no5lvl` 等价）
5. `scripts/config` 逐项应用（见上表）
6. `make LLVM=1 prepare` → `yes "" | make LLVM=1 config`（旧配置迁移＋补齐新符号）→ diff 留档
7. `make -s kernelrelease > version`；保存最终 config 快照为 `config-<ver>-cachyos`

### `build()`（L568-574）：真正编译的一行

```bash
make CC=clang LD=ld.lld LLVM=1 LLVM_IAS=1 -j$(nproc) all
make -C tools/bpf/bpftool vmlinux.h feature-clang-bpf-co-re=1
```

`-j` 由容器内 `nproc` 决定（受 `--cpuset-cpus` 约束）。

### 打包（L611-763）

- 内核包：`vmlinuz` → `/usr/lib/modules/<release>/`；`ZSTD_CLEVEL=19 make modules_install INSTALL_MOD_STRIP=1`（模块 zstd 压缩）
- headers 包：安装 build 树（`.config`/`Makefile`/`Module.symvers`/`scripts/include`/`vmlinux`…）、strip、删 `.o`、建 `/usr/src/linux-cachyos` 软链

### 产物命名

`pkgbase=linux-cachyos`、`pkgver=7.2.7`、`pkgrel=1` ⇒ `linux-cachyos-7.2.7-1-x86_64.pkg.tar.zst`；内核版本串 `7.2.7-1-cachyos-Power-by-R730-Compiled-by-K-Black`。

## 两条运行路径与容错设计

| | 全流程（有新版本） | 重试路径（无新版但缺产物） |
|---|---|---|
| 阶段 3-6 | 下载→验签→补丁→合并 | 全部跳过（沿用已就绪产物，通知里展示「♻️ 重试构建」） |
| 阶段 7 | 版本变量 + b2sums（通常会写文件） | 内容不变 ⇒ **不写文件** |
| 阶段 8 | `makepkg -o` 全新解包 + prepare | 树已就绪（五项条件：含 DEBUG_INFO 开关标记）⇒ **跳过** |
| 阶段 9 | 编译 | `makepkg -e` 复用已有 `.o` ⇒ **增量续编**（实测：中断后 42 分钟恢复完成） |

**容错与安全网**：

- flock 独占锁（防并发）；已有构建容器时跳过并回执
- 失败自动重试 ≤3 次（跨天，逐次通知）；超限发「需人工介入」并暂停
- OOM：自动降级 `JOBS=8 CPUSET=0-7` 增量续编一次
- 大版本（如 7.2→7.3）：仅通知 + 中断；手动运行时 y/N 确认（默认 N），同系列小更新一并暂停
- 上游合并失败：自动回退旧配方继续编译 + 告警；差异/快照留档 `upstream/`
- 网络/端点失败：API→atom 兜底；补丁下载失败可沿用旧文件；源码/签名直连兜底

大版本只通知不自动升，这是一条刻意的刹车。小版本升级（7.2.6→7.2.7）风险可控，让它自动跑完就好；大版本跨 series 可能带 Kconfig 变更、补丁路径变更，自动化脚本不该替我做这个决定。

## 产物 / 状态 / 通知 / 清理

| 类别 | 位置/内容 |
|---|---|
| 产物 | `pkgs/linux-cachyos-<ver>-1-*.pkg.tar.zst` ＋ `…-headers-…`（sha256 记录于 M3 通知与 LAST-RESULT） |
| 状态 | `autobuild/state`（pending/attempts/target_ver/last_ok_ver/last_fail/…） |
| 结果 | `autobuild/LAST-RESULT.txt`（成功/失败摘要与路径） |
| 日志 | `autobuild/logs/`（各阶段日志＋运行日志，保留 30 天）；根目录 `build-*.log`（makepkg 完整日志） |
| 上游留档 | `autobuild/upstream/`（PKGBUILD.snapshot / .incoming / .merged / drift-*.diff） |
| 通知 | Server酱 Turbo；12 类事件：开始/编译开始/成功/失败/需人工/大版本/OOM/巡检回执/数据盘/已有构建跳过/网络失败/远端查询失败 |
| 清理 | 源码包保留最近 2 个；日志 30 天 |

通知里的产物是"文件名 → 完整路径"的表格风，微信里点开就能直接去 `sftp` 拉包。

**防"哑消息"的双保险**：`--self-test` 渲染全部消息模板自检（能抓出未定义变量），`notify()` 对空正文自动填占位并打 `NOTIFY-WARN`。之前踩过一次，重试路径因为某个变量为空，微信收到一条空标题的空消息，等于什么都不知道。现在这种消息会在日志里留下 `NOTIFY-WARN`。

## 常用命令

```bash
bash /home/kb/bin/cachy-autobuild.sh --check-only      # 只检查
bash /home/kb/bin/cachy-autobuild.sh --dry-run         # 演练（验证上游合并，不改动）
bash /home/kb/bin/cachy-autobuild.sh --self-test       # 自检全部消息模板
bash /home/kb/bin/cachy-autobuild.sh --test-notify     # 测试通知
bash /home/kb/bin/cachy-autobuild.sh --force           # 重置重试计数
bash /home/kb/bin/cachy-autobuild.sh --simulate-remote 7.2.8-1   # 模拟远端版本
```

加了 `--dry-run` 之后，改合并逻辑再也不用真跑一遍看看了，它会完整走一遍上游拉取 + 重放 + 三重校验，但不落盘、不编译。这是这套脚本里第二有用的开关（第一是 `--check-only`）。

## 关键文件位置

| 文件 | 位置 |
|---|---|
| 主脚本 / 合并脚本 / 配置 | `编译服务器:/home/kb/bin/` |
| PKGBUILD / config / 构建树 | `编译服务器:/home/data2/cachy-build/work/linux-cachyos-v3-nola57/` |
| 编译入口 | `编译服务器:/home/data2/cachy-build/NEXT-STEP.sh` |
| 镜像定义 | `编译服务器:/home/kb/cachy-payload/{Dockerfile,setup.sh}` |
| 产物 / 源码 / 日志 / 状态 | `编译服务器:/home/data2/cachy-build/{pkgs,srcs,autobuild}/` |

## 验证记录

| 日期 | 项目 | 结果 |
|---|---|---|
| 2026-09-23 | `--test-notify` | ✅ 通道正常 |
| 2026-09-23 | `--check-only` | ✅ 识别 7.2.7-1（远端领先） |
| 2026-09-23 | `--dry-run` | ✅ 重放式合并校验通过 |
| 2026-09-23 | 首次真实构建 | ✅ 成功：7.2.6-1 → 7.2.7-1（66 分钟）；产物已拉回本机，sha256 校验一致 |
| 2026-09-24 | 定时任务触发 | ✅ 北京时间 22:00 准点执行（面板存 `0 14 * * *`；不做时区换算） |
| 2026-09-24 | 健壮性修复 | ✅ 空正文 bug 修复 + `--self-test`（8 模板全 PASS）+ 重试改增量 |
| 2026-09-24 | 演练：中断→重试续编 | ✅ 未重写 PKGBUILD、跳过 prepare 直接续编；42 分钟完成 |

## 还没自动化的部分

大版本升级还是得我自己上。脚本跑到这一步只会发条通知，然后停下等我。7.2 到 7.3 这种跨 series 的升级可能带 Kconfig 变更和补丁路径变更，我不太敢让它替我做决定。

顺带说一句，把命令串起来其实是最省事的一步。真正花时间的是想清楚每种异常下该干什么，再把这些判断一句句写进脚本里。

现在的维护成本是每天早上看一眼微信推送。以前是每次一小时，加一堆手工步骤。

## 变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-09-26 | v1.0 | 首版：基于全链路脚本逐行阅读整理（`cachy-autobuild.sh` 867 行 / `cachy-merge-upstream.py` 120 行 / `NEXT-STEP.sh` 31 行 / `PKGBUILD` 848 行 / `Dockerfile` 47 行 / `setup.sh` 102 行） |

---

*本文根据实际脚本逐行阅读整理；脚本改动后请同步修订对应章节。*
