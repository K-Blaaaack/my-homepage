---
title: "内核自动构建流水线：从计划任务到自动发布"
date: 2026-10-09T02:00:00+08:00
draft: false
tags: ["内核", "自动化", "CachyOS", "Docker", "Shell", "CI"]
categories: ["技术笔记"]
summary: "把「每次人工同步源码 + 编译内核」变成「定时任务自动跑」：1Panel 计划任务触发 → 检查上游版本 → 下载验签 → 重放式合并 PKGBUILD → 容器内编译 → 产物校验 → 推配方到 GitHub 并发 Release → 微信通知。全链路逐脚本拆解。"
---

[定制内核](/posts/custom-cachyos-kernel/)这件事，编一次是折腾，编十次就是折磨。每次上游发新版，流程都是同一套：查 release、下源码、验签、改 PKGBUILD 版本变量、重算 b2sums、清 `src/`、编译，再校验产物。

每一步都可能出错。而人会累、会忘、会在半夜两点把 `src/` 忘了清。

所以我把这一整套做成了自动化流水线：定时任务触发 → 检查上游 → 自动同步 → 自动编译 → 自动发布 → 微信通知。这篇文章把从 1Panel 计划任务被触发，到内核包躺进 `pkgs/` 并传上 GitHub Release 的每一步都写出来。

## 全景链路

```
1Panel 计划任务（每天北京时间 22:00，spec = 0 22 * * *）
        │
        ▼
kbkernel-autobuild.sh  ← ~890 行 · 总指挥（root 自动降权为 kb）
        │
        ├─ 前置检查（flock 锁 / 工作目录 / docker / 网络）
        ├─ 版本检查（GitHub releases，API → atom 兜底）
        ├─ 阶段 3-6   下载（直连优先，过慢自动换 ghfast，断点续传）→ 验签 → 补丁 → 重放式合并上游 PKGBUILD
        ├─ 阶段 7     版本变量（pkgrel 随 tagrel 同步）+ 重算 b2sums
        ├─ 阶段 8     makepkg -o：解包 + prepare()
        ├─ 阶段 9     NEXT-STEP.sh → docker + makepkg -e   ★ 真正编译
        └─ 阶段 10-11 产物校验 → 收尾 → 【发布】推配方 + 建 Release → Server酱通知
        │
        ▼
pkgs/linux-KBkernel-cachy-<ver>-x86_64.pkg.tar.zst（约 120M）
     …-headers-…pkg.tar.zst（约 79M）
     KBkernel-cachy-<ver>-src.tar.zst（对应源码配方包）
```

一句话概括：1Panel 只负责到点叫醒，剩下的全部由脚本自理。每个阶段都会在输出里打一行 `▶ 阶段 N/11 …`，阶段结束打 `✔ …：详情`，屏幕上就能看出跑到哪了。

## 触发层：1Panel 计划任务

任务配置在 1Panel → 计划任务里创建（重建后由人工建一次）：

| 字段 | 值 | 说明 |
|---|---|---|
| `spec` | `0 22 * * *` | cron「分 时 日 月 周」；**服务器系统时区已是 Asia/Shanghai** ⇒ 每天北京时间 22:00 |
| 类型 | Shell 脚本 | |
| `script` | `/home/KBkernel-cachy/kbkernel-autobuild.sh` | 只填脚本路径 |
| `user` | `root` | 1Panel 以 root 执行；脚本内部自动降权为 kb |
| `timeout` | `14400`（秒）= 4 小时 | 防止面板掐断长编译 |
| `retry_times` | `0` | 不做面板级重试（重试逻辑由脚本自理，避免一晚烧完额度） |
| `retain_copies` | `30` | 执行记录保留 30 份 |

### 时区说明

1Panel 内嵌前端生成 cron 时是直接拼接（`每天 → ${minute} ${hour} * * *`），不做浏览器时区换算，填什么就是服务器本地时间跑什么。早先的编译机系统时区是 UTC，所以那时要跑北京时间 22:00 得填 `14:00`；**现在这台系统时区直接就是 Asia/Shanghai，填 `22:00` 即可**。

`retry_times=0` 是刻意的。面板级重试是无脑重试，一晚上能把 4 小时超时跑满好几轮。重试交给脚本自己判断（跨天、逐次通知、有上限）更合理。

## 脚本清单（职责矩阵）

| 脚本/文件 | 行数 | 位置 | 角色 |
|---|---|---|---|
| `kbkernel-autobuild.sh` | ~890 | `编译服务器:/home/KBkernel-cachy/` | 总指挥：检查/更新/编译/发布/通知/状态 |
| `kbkernel-autobuild.env` | 35 | 同上（权限 600） | 配置：SendKey、通知级别、重试/并行/清理参数 |
| `kbkernel-merge-upstream.py` | ~150 | 同上 | 上游配方「重放式合并」 |
| `NEXT-STEP.sh` | 31 | 同上 | 编译入口（docker + makepkg） |
| `PKGBUILD` | ~850 | `…/work/linux-KBkernel-cachy/` | 内核配方（决定编译参数与打包） |
| `config` | — | 同上 | 种子内核配置（与 CachyOS 官方一致） |
| `Dockerfile` | ~50 | `/home/KBkernel-cachy/autobuild/` | 编译容器镜像定义 |

## `kbkernel-autobuild.sh` 逐段解析

| 段落 | 内容 |
|---|---|
| 环境 | 固定 PATH；`_use_debug_info` 开关（默认 `no`） |
| **降权** | root 时 `runuser -u kb -- kbkernel-autobuild.sh`（1Panel 以 root 跑；makepkg/docker 需要 kb 身份与工作目录权限）。被复制执行时回退规范安装路径 |
| 定位 | `set -u`；`SELF_DIR/SCRIPT_DIR` 回退逻辑；加载 `kbkernel-autobuild.env` |
| 参数 | SENDKEY、NOTIFY_STAGES、NOTIFY_NOIP、NOTIFY_NOOP、MAX_RETRY、MAJOR_REMIND_DAYS、JOBS_DEFAULT=40、JOBS_FALLBACK=8、CPUSET_FALLBACK=0-7、KEEP_TARBALLS=2、LOG_KEEP_DAYS=30 |
| 常量 | ROOT/WORK/PKGBUILD/SRCS/PKGS/AUTODIR/STATE/LAST-RESULT/UPDIR/TMPD；`MIRROR_CHAIN`；GitHub API |
| 参数解析 | `--check-only / --dry-run / --simulate-remote / --force / --yes-major / --test-notify / --self-test` |
| 日志 / 状态 | 北京时间戳；`log()` 同时写终端与运行日志；`state_get/state_set`；`write_last` |
| **阶段模型** | 11 阶段数组（前置检查…收尾）＋ `set_stage` 逐阶段打印（`▶/✔/⚠/✖`）＋ 表格渲染（供通知） |
| **通知** | `notify()`：Server酱 POST（title/short/desp）；空正文兜底为占位并打 `NOTIFY-WARN`；重试 3 次；**失败绝不影响主流程** |
| 版本工具 | `local_version`（读 PKGBUILD 三变量）；`ver_gt/series_gt`；`fetch_remote`：GitHub API（gzip/per_page=30）→ 失败改用 atom feed 兜底 → 聚合「同系列最新」与「最新稳定大版本」；`has_products` |
| 消息模板 | 开始 / 编译开始 / 成功 / 失败 / 需人工 / 大版本 / OOM / 巡检回执（含发布链接） |
| 失败处理 | `fail_stage`：阶段置 ❌、attempts+1、记录 last_fail、发失败通知、写 LAST-RESULT、exit 1 |
| **阶段3 下载** | `dl_fetch` 按 `MIRROR_CHAIN` 依次尝试（直连 → ghfast → gh-proxy）；平均速率持续 30s 低于 **512KB/s** 即中止换源；每 15s 打一条「已下载 XX」；`-C -` 断点续传 |
| **阶段4 验签** | `gpg --verify`；缺公钥时自动 `--recv-keys`（Eric Naim / Peter Jung）后重试 |
| **阶段5 补丁** | 从 `kernel-patches/master/<_major>/` 拉 bore 与 dkms-clang 补丁，md5 对比给出「新增/未变/已更新」 |
| **阶段6 合并** | 拉上游 master PKGBUILD → 与快照 diff（差异留档 `drift-*.diff`）→ `kbkernel-merge-upstream.py` 重放 → 三重校验（断言 + `bash -n` + 容器内 `makepkg --printsrcinfo`）→ 成功替换（旧文件备份 `PKGBUILD.premerge-*.bak`）、失败**自动回退**旧配方 |
| **阶段7 PKGBUILD** | 版本变量逐个比对后才 `sed`（**含 `pkgrel` 随 `_tagrel` 同步**）；容器内 `makepkg -g` 重算 b2sums，**内容不变不写**（保住 mtime ⇒ 重试可跳过 prepare） |
| **阶段8 prepare** | `rm -rf src/*` → 容器内 `makepkg -o`（解包＋prepare()）→ 校验：`Prepared…`、`version` 含 `KBkernel-cachy` |
| **阶段9 编译** | 调 `NEXT-STEP.sh`；失败且日志含 OOM 特征（Killed/signal 9）→ 发通知并自动降级 `JOBS=8 CPUSET=0-7` 续编一次；校验 `Finished making` |
| **阶段10 校验** | 找产物、大小、sha256 前 12 |
| **阶段11 收尾 + 发布** | 状态复位、清理（源码包留 2、日志 30 天）；`publish_release`：把当前配方打包、push 到 GitHub 仓库、打 tag、建 Release（产物 + 配方包）；写 LAST-RESULT；发「✅ 编译成功（附 Release 链接）」 |
| 自检 | `--self-test`：渲染全部消息模板，捕捉未定义变量 |

几个值得单说的设计细节：

- **降权**：1Panel 以 root 跑任务，但 `makepkg` **拒绝以 root 身份执行**，且产物要落到 kb 拥有的目录。所以脚本第一件事就是 `runuser` 降权成 kb 重跑一遍。
- **通知失败不影响主流程**：`notify()` 里所有错误都被吞掉。通知是锦上添花，绝不能因为微信通道抖动把一次成功的编译标记成失败。
- **内容不变不写**：PKGBUILD 的 mtime 决定 makepkg 会不会重新 prepare；重试路径下保住 mtime，就能直接跳到增量续编。
- **pkgrel 随 tagrel 同步**：上游 release tag 是 `cachyos-X.Y.Z-N`，`N` 既进 `_tagrel` 也必须是包版本里的 `pkgrel`。只改一个不改另一个，产物文件名就会和期望版本号对不上，导致「明明编完了却检测不到产物」。阶段 7 把两者一起同步。

## `kbkernel-merge-upstream.py`：上游配方「重放式合并」

上游的 PKGBUILD 一直在变，如果我 fork 一份然后手工维护，迟早会和上游越走越远，最后没法合并。所以做法反过来：把上游 master 的 PKGBUILD 当基座，用 `re.subn` 逐项重放我们的定制；缺任一锚点即整体失败（触发回退旧配方）。

| # | 定制项 | 目标值 |
|---|---|---|
| 1 | 调度器 | `_cpusched:=bore` |
| 2 | CPU 基线 | `_processor_opt:=generic_v3`（x86-64-v3） |
| 3 | LTO | `_use_llvm_lto:=thin`（clang ThinLTO） |
| 4 | 包名后缀 | `_use_lto_suffix:=no`、`_use_gcc_suffix:=yes`，包名稳定为 `linux-KBkernel-cachy` |
| 5 | 镜像 | `_patchsource` 与 release URL 加 `ghfast.top` 前缀（幂等） |
| 6 | NVIDIA 模块锁版 | `_nv_ver=610.57.04` |
| 7 | 构建身份 | `KBUILD_BUILD_HOST=R730`、`KBUILD_BUILD_USER=kb`、时间戳取真实北京时间 |
| 8 | 定制与合规 | 包内写入 `/usr/lib/modprobe.d/iwlwifi-lar.conf`（关 Intel 无线 LAR）+ `COPYING` 许可文本 + 派生声明 |

结尾执行多项存在性断言，全过才输出 `merge-ok`。

关键在"缺锚点就整体失败"这个语义。上游改掉某一行导致 `re.subn` 匹配不到时，脚本**不会**静默产出一个丢掉了定制的 PKGBUILD，而是直接失败并回退旧配方继续编译。宁可编一个旧版本、确定正确的内核，也不要编一个看起来新、实则少了定制的内核。

## `NEXT-STEP.sh`：编译入口

```bash
JOBS="${JOBS:-40}"        # 并行度；OOM 就调小
CPUSET="${CPUSET:-}"      # 例 0-11：同时限住 make -j 与 ld.lld 的 ThinLTO 后端线程
ROOT=/home/KBkernel-cachy
LOG="$ROOT/build-$(date +%m%d-%H%M).log"

docker run --rm "${TTY[@]}" ${CPUSET:+--cpuset-cpus="$CPUSET"} \
  -e MAKEFLAGS="-j$JOBS" -e _use_debug_info="${_use_debug_info:-}" -v "$ROOT":/build \
  kbkernel-cachy-kbuild:latest \
  makepkg -e -s --noconfirm 2>&1 | tee "$LOG"
rc=${PIPESTATUS[0]}
```

两个要点：

- `-e`（`--noextract`）= 跳过解包与 prepare，直接使用阶段 8 已验证的源码树 ⇒ 这也是中断后重试可增量续编的根基。
- `CPUSET` 是控内存最有效的旋钮，**`ld.lld` 的 ThinLTO 后端线程按 `sched_getaffinity` 取值，不看 `make -j`**。要真正压住内存峰值，得限制容器可见的 CPU 集合。

日志落 `build-MMDD-HHMM.log`；退出码经由 `PIPESTATUS` 传出（管道场景下 `$?` 是 `tee` 的，不是 `makepkg` 的）。

## 容器 `kbkernel-cachy-kbuild:latest`

| 要点 | 内容 |
|---|---|
| 基础 | `FROM archlinux:base-devel`；pacman 源 **USTC 主 + 上交大(SJTUG) 备**，开 `ParallelDownloads=10` |
| 工具链 | base-devel + bc/cpio/gettext/libelf/elfutils/openssl/flex/bison/pahole/perl/python/rust/rust-bindgen/rust-src/xxhash/zlib/zstd + **clang/llvm/lld** |
| 用户 | `kb`（uid/gid 1000 对齐宿主）；免密 sudo；`USER kb`（makepkg 拒绝 root） |
| 公钥 | 预导入两把 CachyOS 公钥并断言恰好 2 把（关 keyboxd 防锁残留） |
| makepkg.conf | `PACKAGER`、`PKGDEST=/build/pkgs`、`SRCDEST=/build/srcs`、`COMPRESSZST=(zstd -c -T0 -8 -)`；**故意不设 MAKEFLAGS**（让 `docker run -e` 生效） |
| WorkDir | `/build/work/linux-KBkernel-cachy` |

那个"断言恰好 2 把公钥"的小检查很实用：`gpg --import` 若因 keyboxd 锁残留只导入一把，验签阶段才会莫名其妙失败，不如在镜像构建时就把问题堵死。

## `PKGBUILD` 与内核编译

### 构建选项（生效值）

| 变量 | 值 |
|---|---|
| `_cpusched` | **bore**（`-e SCHED_BORE`） |
| `_processor_opt` | **generic_v3**（`-e GENERIC_CPU --set-val X86_64_VERSION 3`） |
| `_use_llvm_lto` | **thin**（`-e LTO_CLANG_THIN` + dkms-clang 补丁） |
| `_cc_harder` | yes（`-O3`） |
| `_HZ_ticks` / `_tickrate` | 1000 / full（`NO_HZ_FULL`） |
| `_preempt` | full |
| `_hugepage` | always（THP） |
| `_cachy_config` | yes（`-e CACHY`） |
| `_use_debug_info` | **no**（默认关闭 `DEBUG_INFO`/`BTF`；可切 yes） |
| 其余（zfs/nvidia/r8125/debug/autofdo/propeller） | 均不启用（只出 2 个包） |

### `prepare()`：把通用配置变成"我们的内核"

1. 写 `localversion.10-pkgrel / .20-pkgname` → 决定 `uname -r`
2. 打补丁（bore、dkms-clang，`patch -Np1`）
3. `cp ../config .config`（种子 config，与 CachyOS 官方一致）
4. `scripts/config` 逐项应用（见上表）
5. `make LLVM=1 prepare` → `yes "" | make LLVM=1 config`（旧配置迁移＋补齐新符号）→ diff 留档
6. `make -s kernelrelease > version`；保存最终 config 快照

### `build()`：真正编译

```bash
make CC=clang LD=ld.lld LLVM=1 LLVM_IAS=1 -j$(nproc) all
make -C tools/bpf/bpftool vmlinux.h feature-clang-bpf-co-re=1
```

`-j` 由容器内 `nproc` 决定（受 `--cpuset-cpus` 约束）。

### 打包与产物命名

- 内核包：`vmlinuz` → `/usr/lib/modules/<release>/`；`ZSTD_CLEVEL=19 make modules_install INSTALL_MOD_STRIP=1`
- headers 包：安装 build 树并 strip、删 `.o`、建 `/usr/src/linux-KBkernel-cachy` 软链
- 命名：`pkgbase=linux-KBkernel-cachy`、`pkgver=7.2.9`、`pkgrel=2` ⇒ `linux-KBkernel-cachy-7.2.9-2-x86_64.pkg.tar.zst`；内核版本串 `7.2.9-2-KBkernel-cachy`

## 发布（这一步是新的）

编译成功后，脚本会做三件事，把"产物 + 对应源码"一起送出去：

1. 把当前 `PKGBUILD` + `config` + `.SRCINFO` 打成一个配方包 `KBkernel-cachy-<ver>-src.tar.zst`
2. 把配方 commit + push 到 GitHub 仓库 `K-Blaaaack/KBkernel-cachy`，并打 tag
3. `gh release create`：上传内核包、headers 包、配方包

这样每个内核包都有一个对应的公开 Release，配方与源码可追溯。发布失败**不会**把构建判为失败，只是通知里标一下。

## 两条运行路径与容错设计

| | 全流程（有新版本） | 重试路径（无新版但缺产物） |
|---|---|---|
| 阶段 3-6 | 下载→验签→补丁→合并 | 全部跳过（沿用已就绪产物，通知里展示「♻️ 重试构建」） |
| 阶段 7 | 版本变量 + b2sums（通常会写文件） | 内容不变 ⇒ **不写文件** |
| 阶段 8 | `makepkg -o` 全新解包 + prepare | 树已就绪 ⇒ **跳过** |
| 阶段 9 | 编译 | `makepkg -e` 复用已有 `.o` ⇒ **增量续编** |

**容错与安全网**：

- flock 独占锁（防并发）；已有构建容器时跳过并回执
- 前置检查：工作目录存在、可写、剩余空间 ≥ 20 GiB
- 失败自动重试 ≤3 次（跨天，逐次通知）；超限发「需人工介入」并暂停
- OOM：自动降级 `JOBS=8 CPUSET=0-7` 增量续编一次
- 大版本（如 7.2→7.3）：仅通知 + 中断；手动运行时 y/N 确认（默认 N）
- 上游合并失败：自动回退旧配方继续编译 + 告警；差异/快照留档 `upstream/`
- 网络/端点失败：API→atom 兜底；补丁下载失败可沿用旧文件；源码/签名多源切换

大版本只通知不自动升，这是一条刻意的刹车。小版本升级风险可控，让它自动跑完就好；大版本跨 series 可能带 Kconfig 变更、补丁路径变更，自动化脚本不该替我做这个决定。

## 产物 / 状态 / 通知 / 清理

| 类别 | 位置/内容 |
|---|---|
| 产物 | `pkgs/linux-KBkernel-cachy-<ver>-*.pkg.tar.zst` ＋ `…-headers-…` ＋ 配方包（sha256 记录于通知与 LAST-RESULT） |
| 状态 | `autobuild/state`（pending/attempts/target_ver/last_ok_ver/last_fail/…） |
| 结果 | `autobuild/LAST-RESULT.txt` |
| 日志 | `autobuild/logs/`（各阶段日志＋运行日志，保留 30 天）；根目录 `build-*.log`（makepkg 完整日志） |
| 上游留档 | `autobuild/upstream/`（PKGBUILD.snapshot / .incoming / .merged / drift-*.diff） |
| 通知 | Server酱 Turbo；默认 `NOTIFY_STAGES=key`：开始 / 编译开始 / 结果三类（巡检回执、失败、需人工、大版本、OOM、工作目录、已有构建跳过、网络失败、远端查询失败等按条件触发） |
| 清理 | 源码包保留最近 2 个；日志 30 天 |

**防"哑消息"的双保险**：`--self-test` 渲染全部消息模板自检（能抓出未定义变量），`notify()` 对空正文自动填占位并打 `NOTIFY-WARN`。

## 常用命令

```bash
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --check-only      # 只检查
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --dry-run         # 演练（验证上游合并，不改动）
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --self-test       # 自检全部消息模板
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --test-notify     # 测试通知
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --force           # 重置重试计数
bash /home/KBkernel-cachy/kbkernel-autobuild.sh --simulate-remote 7.2.9-2   # 模拟远端版本
```

## 关键文件位置

| 文件 | 位置 |
|---|---|
| 主脚本 / 合并脚本 / 配置 / 编译入口 | `编译服务器:/home/KBkernel-cachy/` |
| PKGBUILD / config / 构建树 | `编译服务器:/home/KBkernel-cachy/work/linux-KBkernel-cachy/` |
| 镜像定义 | `编译服务器:/home/KBkernel-cachy/autobuild/Dockerfile` |
| 产物 / 源码 / 日志 / 状态 | `编译服务器:/home/KBkernel-cachy/{pkgs,srcs,autobuild}/` |

## 验证记录

| 日期 | 项目 | 结果 |
|---|---|---|
| 2026-09-23 | `--test-notify` / `--check-only` / `--dry-run` | ✅ 通道正常 / 版本识别 / 合并校验 |
| 2026-09-23 | 首次真实构建 | ✅ 7.2.6→7.2.7（66 分钟） |
| 2026-09-24 | 定时任务触发 | ✅ 准点执行 |
| 2026-10-09 | 流水线重建后首次真实构建 | ✅ **7.2.8→7.2.9-2**，`-j40` **34 分 53 秒**，无 OOM；产物 + 配方自动发布到 GitHub Release `v7.2.9-2` |

## 还没自动化的部分

大版本升级还是得我自己上。脚本跑到这一步只会发条通知，然后停下等我。7.2 到 7.3 这种跨 series 的升级可能带 Kconfig 变更和补丁路径变更，不太敢让它替我做决定。

现在的维护成本是每天早上看一眼微信推送。以前是每次人工一小时，还加一堆手工步骤。

## 变更记录

| 日期 | 版本 | 内容 |
|---|---|---|
| 2026-09-26 | v1.0 | 首版：基于全链路脚本逐行阅读整理 |
| 2026-10-09 | v2.0 | 流水线重建后重写：改名 `kbkernel-*`、路径 `/home/KBkernel-cachy`、关 Intel 无线 LAR、下载换源阈值 512KB/s·30s、逐阶段进度显示、**新增 GitHub 配方仓库与自动发布**、1Panel 周期改 `0 22`（服务器已北京时间） |

---

*本文根据实际脚本整理；脚本改动后请同步修订对应章节。*
