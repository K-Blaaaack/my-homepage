---
title: "自编译 CachyOS 内核：BORE + ThinLTO + x86-64-v3 + 关闭 Intel 无线 LAR"
date: 2026-09-26T15:00:00+08:00
draft: false
tags: ["内核", "CachyOS", "Arch Linux", "BORE", "ThinLTO", "编译"]
categories: ["技术笔记"]
summary: "基于 CachyOS 官方内核源码自编译专属内核：BORE + Clang ThinLTO + x86-64-v3 + 关闭 Intel 无线 LAR。附定制清单、实现方式、构建流程、踩坑记录与部署回退方案。"
---

Arch 系用户想要性能内核，最省事的路子是装 CachyOS 的现成包。但 CachyOS 官方只提供两个成品：主配方的 EEVDF + ThinLTO，和 BORE 变体的 BORE + 无 LTO（GCC）。我想要的 **BORE + Clang ThinLTO + x86-64-v3 + 关闭 Intel 无线 LAR** 这个组合，官方没有。

于是就有了这个项目：基于 CachyOS 官方内核源码自编译的专属内核，项目代号 **`KBkernel-cachy`**。

这篇文章记录它的完整配方、构建流程、部署方式和踩过的坑。目标是让接手的人、未来的我自己，以及 AI 助手，五分钟内能上手，不用重复摸索。

## 一句话总览

> **BORE + Clang ThinLTO + x86-64-v3 + 关闭 Intel 无线 LAR + K-Black 品牌**

## 内核身份卡

| 项目 | 值 |
|---|---|
| 内核全名（`uname -r`） | `7.2.9-2-KBkernel-cachy` |
| 包 | `linux-KBkernel-cachy` 7.2.9-2 + `-headers` 7.2.9-2 |
| 源码 | CachyOS/linux release `cachyos-7.2.9-2`（Linux 7.2.9） |
| 编译器 | clang 23.1.1 + ld.lld（ThinLTO） |
| 构建 | 编译服务器 R730（Docker 容器内，`-j40`，约 35 分钟） |
| 构建日期 | 2026-10-09 |
| 发布 | GitHub `K-Blaaaack/KBkernel-cachy`（Release `v7.2.9-2`） |

版本号是 localversion 两段拼接出来的：

```
-2                          # pkgrel（随上游 tagrel 同步）
-KBkernel-cachy             # pkgbase 后缀
```

构建身份 `KBUILD_BUILD_USER=kb`、`KBUILD_BUILD_HOST=R730`、时间戳取真实北京时间，`/proc/version` 里显示 `(kb@R730)`。判断自己跑的是不是这个内核，看 `uname -r` 尾部有没有 `-KBkernel-cachy` 就行。

## 定制清单（相对官方）

| # | 项目 | 官方值 | 我们的值 | 实现位置 |
|---|---|---|---|---|
| 1 | 调度器 | 主:EEVDF / BORE变体:BORE | **BORE** | PKGBUILD `_cpusched:=bore` |
| 2 | LTO | 主:ThinLTO / BORE变体:无 | **ThinLTO** | `_use_llvm_lto:=thin` |
| 3 | CPU 指令集 | native（跟随编译机） | **generic_v3** | `_processor_opt:=generic_v3` |
| 4 | Intel 无线 LAR | 启用 | **关闭**（`lar_disable=1`） | 包内 `/usr/lib/modprobe.d/iwlwifi-lar.conf` |
| 5 | 包名后缀 | cachyos | `-KBkernel-cachy` | `_pkgsuffix` |
| 6 | 构建身份 | cachyos | `kb` / `R730`（时间戳北京时间） | `export KBUILD_BUILD_*` |
| 7 | 下载源 | GitHub 直连 | **ghfast.top 加速** | `_patchsource`、`source` |
| 8 | nvidia 版本变量 | 615.71.09 | 610.57.04（未启用，无影响） | `_nv_ver` |

对应 PKGBUILD 顶部的选项行，以后要改，改这几行就够了：

```bash
: "${_cpusched:=bore}"
: "${_processor_opt:=generic_v3}"
: "${_use_llvm_lto:=thin}"
: "${_use_lto_suffix:=no}"
: "${_use_gcc_suffix:=yes}"
```

第 3 项值得多说一句。官方的 `native` 是跟着编译机走的，而我的编译机是台服务器，`native` 编出来的东西在别的机器上未必能跑。锁成 `generic_v3`（x86-64-v3）之后，只要是 Haswell 之后的机器都能用，产物可携带、可复现，也方便往云服务器上部署同一套包。

## 关闭 Intel 无线 LAR

**目的**：关掉 iwlwifi 的 **LAR（Location Aware Regulatory，定位感知法规域）**，让无线驱动改用网卡固件/EEPROM 里的法规域，而不是按位置动态调整。

实现不碰内核源码，随包放一个 modprobe 配置就够：

```
/usr/lib/modprobe.d/iwlwifi-lar.conf
    options iwlwifi lar_disable=1
```

这一行由**重放式合并脚本**在生成 PKGBUILD 时写进 `package()`，所以上游怎么改都不会丢。

校验也很直接，拆包看一眼：

```bash
tar -xOf linux-KBkernel-cachy-<ver>-x86_64.pkg.tar.zst usr/lib/modprobe.d/iwlwifi-lar.conf
# 期望：options iwlwifi lar_disable=1
```

## 这些不是我们加的，别记错

下面这些经常被误认为定制项，其实全是 CachyOS 官方默认：

`-O3`、`HZ=1000`、full tickless（`NO_HZ_FULL`）、`PREEMPT full`、`THP always`、BBR/BBR3、sched-ext（`SCHED_CLASS_EXT=y`）、IBT、BTF、模块签名、zstd 模块压缩、`MIN_BASE_SLICE_NS=1600000`。

我们的 `config` 文件与官方 BORE 变体 config **逐字节一致**。构建时脚本会往里面写 `SCHED_BORE=y` 和 `X86_64_VERSION=3`，那是选项的自动结果，没人手改 config。

官方变体对照：

| 项目 | 官方主配方 | 官方 BORE 变体 | 我们的 |
|---|---|---|---|
| 调度器 | EEVDF | BORE | **BORE** |
| LTO | ThinLTO | 无（GCC） | **ThinLTO** |
| CPU | native | native | **v3** |
| Intel 无线 LAR | 开 | 开 | **关闭** |
| 配置基线 | — | 官方 BORE config | **同官方 BORE config** |

## 构建环境

编译机是 `R730`（192.xxx.xxx.237/24，静态 IP，netplan），用户 `kb`。

构建根目录 `/home/KBkernel-cachy/`（系统盘，脚本也放在这里）：

- `NEXT-STEP.sh`，编译入口脚本
- `pkgs/`，产物输出
- `srcs/`，源码 tarball + 补丁 + 签名
- `work/linux-KBkernel-cachy/`，`PKGBUILD` + `config`

Docker 镜像 `kbkernel-cachy-kbuild:latest`：

- 用户 `kb`（uid 1000），WorkDir=`/build/work/linux-KBkernel-cachy`
- `/home/builder/.makepkg.conf`：`PACKAGER="K-Black <aa1231951@outlook.com>"`、`PKGDEST=/build/pkgs`、`SRCDEST=/build/srcs`

上游补丁源走 ghfast 加速：`https://ghfast.top/https://raw.githubusercontent.com/cachyos/kernel-patches/master/7.2/`

- `sched/0001-bore-cachy.patch`，BORE 调度器
- `misc/dkms-clang.patch`，LTO 内核的 DKMS 兼容

PGP 验签用的两把公钥：`E18447AC…4B8B63C4`（Eric Naim）、`E8B9AA39…57F654FE`（Peter Jung）。

> ⚠️ 工作目录在系统盘。**任何操作前确认目录存在可写**；历史上独立数据盘挂载失败导致过 Emergency Mode，所以现在把流水线前置检查里加了「工作目录存在+可写+空间≥20GiB」。

## 构建命令

**完整构建**（新版本首次，会自己下载 / 解包 / 打补丁 / prepare / 编译）：

```bash
cd /home/KBkernel-cachy/work/linux-KBkernel-cachy
docker run --rm -it -w /build/work/linux-KBkernel-cachy -e MAKEFLAGS=-j40 \
  -v /home/KBkernel-cachy:/build kbkernel-cachy-kbuild:latest makepkg -s --noconfirm
```

**增量续编**（树已经 prepare 过，等价于 `NEXT-STEP.sh`）：

```bash
bash /home/KBkernel-cachy/NEXT-STEP.sh     # 内部 = makepkg -e -s --noconfirm
```

**OOM 降级**（出现 `Killed` / `cc1: out of memory`）：

```bash
JOBS=8 CPUSET=0-7 bash /home/KBkernel-cachy/NEXT-STEP.sh
```

> `makepkg -e` 的前提是树已经 prepare 过。新版本第一次构建，要么用完整 `makepkg -s`，要么先 `makepkg -o` 预检再 `-e`。

## 版本升级标准流程（例：升到 7.2.7-1）

1. 查最新 release：`curl -s "https://api.github.com/repos/CachyOS/linux/releases?per_page=5" | grep tag_name`
2. 下载源码 + 签名（镜像链自动换源）：
   ```bash
   cd /home/KBkernel-cachy/srcs
   curl -fL -o cachyos-7.2.7-1.tar.gz "https://ghfast.top/https://github.com/CachyOS/linux/releases/download/cachyos-7.2.7-1/cachyos-7.2.7-1.tar.gz"
   curl -fL -o cachyos-7.2.7-1.tar.gz.asc "https://ghfast.top/https://github.com/CachyOS/linux/releases/download/cachyos-7.2.7-1/cachyos-7.2.7-1.tar.gz.asc"
   gpg --verify cachyos-7.2.7-1.tar.gz.asc cachyos-7.2.7-1.tar.gz
   ```
3. 改 PKGBUILD 版本变量：`_major=7.2`、`_minor=7`、`_tagrel=1`（先备份 PKGBUILD）
4. 更新校验和：`docker run --rm -w /build/work/linux-KBkernel-cachy -v /home/KBkernel-cachy:/build kbkernel-cachy-kbuild:latest makepkg -g`，把输出替换 PKGBUILD 末尾的 `b2sums=(...)`
5. **清干净 `src/` 目录**（`rm -rf src/*`，必须！）
6. 建/更新 `src/` 下符号链接（可选，让 makepkg 直接找到本地文件）
7. 完整构建（见上），产物在 `pkgs/`
8. 预检/验证：日志无 ERROR、`file` 检查内核串、必要时 `makepkg -o` 先跑 prepare
9. 拉回本机部署

这一串步骤现在已经全自动了，定时任务每晚检查上游、自动重放定制、自动编译、微信通知。那套流水线的细节写在[《内核自动构建流水线：从计划任务到 151MB 的包》](/posts/kernel-autobuild-pipeline/)里。

## 踩坑记录（血泪史）

| 症状 | 原因 | 解决 |
|---|---|---|
| `b2sums ... FAILED` | 换版本后没更新 PKGBUILD 校验和 | `makepkg -g` 重新生成并替换 |
| `bore.h already exists / patch 冲突` | `src/` 里有旧树残留 | 清空 `src/` 从干净树重来 |
| 编译 OOM / Killed | `-j40` 内存峰值过高 | `JOBS=8 CPUSET=0-7` 降级续编 |
| 系统崩溃进 Emergency Mode | `/home/KBkernel-cachy` 挂载失败（fstab 无 nofail） | fstab 改 `nofail,x-systemd.device-timeout=30s`；并解除 `home-data2.mount` 的 mask |
| 内核装了没生效 | 没重启 | 重启；或检查 UKI 时间戳 |

第三条值得展开，`CPUSET` 比 `-j` 更管用。ThinLTO 的后端线程是 `ld.lld` 自己按 `sched_getaffinity` 拉起来的，根本不吃 `make -j` 的约束。要真限住内存峰值，得用 `--cpuset-cpus` 把整个容器能看到的 CPU 数压下去。

## 部署

### 本机 PotatoPC（Arch + systemd-boot + UKI）

1. 拉包 + 校验：
   ```bash
   cd /home/kb/cachy-pkgs
   sftp kb@192.xxx.xxx.237   # get /home/KBkernel-cachy/pkgs/linux-cachyos-<VER>-x86_64.pkg.tar.zst 及 headers
   sha256sum *.pkg.tar.zst  # 与服务器比对
   ```
2. 安装（同版本重装也可）：
   ```bash
   sudo pacman -U linux-cachyos-<VER>-x86_64.pkg.tar.zst linux-cachyos-headers-<VER>-x86_64.pkg.tar.zst
   ```
3. 安装钩子自动完成：拷内核到 `/boot/vmlinuz-linux-cachyos`、重建 initramfs、重建 UKI 到 `/boot/EFI/Linux/linux-cachyos.efi`（默认启动项）、DKMS 模块为新内核重编。
4. 重启生效。菜单顺序：`linux-cachyos.efi`（默认）→ `arch-linux.efi`（官方内核回退）→ `Windows Boot Manager` → 固件设置。
5. 回退：菜单选 `arch-linux.efi`；或 `sudo pacman -U /var/cache/pacman/pkg/linux-cachyos-<旧VER>-x86_64.pkg.tar.zst` 后重建。

关键文件：

- preset：`/etc/mkinitcpio.d/linux-cachyos.preset`（`default_uki=/boot/EFI/Linux/linux-cachyos.efi`）
- cmdline：`/etc/kernel/cmdline`（`root=PARTUUID=... zswap.enabled=0 rw rootfstype=ext4`）
- 内核备份：`/root/boot-backup-7.2.6/`（官方版 vmlinuz/initramfs/UKI 三件套）

**Windows 双启动**：Windows 在 `sda`（独立 ESP）。把 `sda1` 的 `EFI/Microsoft`（150 文件 / 33MB）复制到 Linux ESP 的 `/boot/EFI/Microsoft`，sd-boot 会自动识别为 `auto-windows` 条目，且排在 Linux 条目之后，不抢第一。固件启动顺序 `0001`(Linux) → `0000`(Windows) → `0002`(兜底)。Windows 大版本更新后如果菜单失效，重新复制一次 `EFI/Microsoft` 即可；删掉它则移除菜单项。

### 云服务器（Debian 13 + GRUB，拆包部署）

云服务器上不装 Arch 包，直接从包里拆出内核用：

1. 备好包 → 解包提取：`vmlinuz` → `/boot/vmlinuz-cachyos-<VER>`；模块树 → `/lib/modules/<完整内核名>/`
2. 生成 initramfs：`update-initramfs -c -k <完整内核名>`（或 dracut）
3. GRUB 菜单：写 `/etc/grub.d/40_custom`（linux + initrd 指向上述文件），`update-grub`
4. 设置 `GRUB_DEFAULT` 指向 CachyOS 菜单项；**保留原 Debian 内核作回退**
5. 操作前广播纪律：`for t in /dev/pts/[0-9]*; do printf "\n[AI运维助手] ...\n" > "$t" 2>/dev/null; done`（中文、署名；首次连接先报身份）

云服务器当前跑的是 7.2.2 版，升级到 7.2.6/7.2.7 还是待办。

### 回退矩阵

| 位置 | 回退路径 |
|---|---|
| 本机 | 启动菜单选 `arch-linux.efi`；或 pacman 装回官方旧版 |
| 本机（终极） | `/root/boot-backup-7.2.6/` 恢复三件套 |
| 云服务器 | GRUB 选择原 Debian 6.12.95 内核 |

**永远保留一个能回退的内核**，这条是硬约定，不是建议。

## 验证清单

```bash
uname -r     # 期望：7.2.9-2-KBkernel-cachy
uname -v     # 期望含 `kb@R730` 构建信息（见 /proc/version 括号）

# 配置抽查（本机，headers 包里有 .config）：
CFG=/usr/lib/modules/<完整内核名>/build/.config
grep -E "SCHED_BORE|X86_64_VERSION|LTO_CLANG_THIN|CC_OPTIMIZE_FOR_PERFORMANCE_O3|^CONFIG_HZ=|NO_HZ_FULL|^CONFIG_PREEMPT=|TRANSPARENT_HUGEPAGE_ALWAYS" "$CFG"
# 期望：SCHED_BORE=y / X86_64_VERSION=3 / LTO_CLANG_THIN=y / O3=y / HZ=1000 / NO_HZ_FULL=y / PREEMPT=y / THP_ALWAYS=y

# 启动项（本机）：
sudo bootctl list
sudo efibootmgr
ls -la /boot/EFI/Microsoft/Boot/bootmgfw.efi   # Windows 菜单副本存在

# 构建机产物检查：
ls -lh /home/KBkernel-cachy/pkgs/
file <解出的 vmlinuz>   # 版本串校验
```

## FAQ

**Q：内核名里的 `-KBkernel-cachy` 是什么？**
A：localversion 两段拼接（`pkgrel` + `pkgbase` 后缀），后缀是品牌要求。

**Q：怎么判断跑的是不是定制内核？**
A：`uname -r` 尾部有 `KBkernel-cachy` 即为是。

**Q：为什么不直接用官方的 `linux-cachyos`？**
A：官方没有 BORE + ThinLTO + v3 + 关闭 LAR 这个组合。

**Q：编译机上的 7.2.2 旧包要删吗？**
A：建议保留作历史对照（`pkgs/` 里），除非磁盘紧张。

**Q：云服务器和本机是同一套配方吗？**
A：是同一套源码和配置构建的（7.2.2 版），可以直接升级到 7.2.6 版保持一致。

## 版本历史

| 日期 | 版本 | 事件 |
|---|---|---|
| 2026-08-31 | 7.2.2-1 | 首次构建成功（`build-0831-1153.log`） |
| 2026-09-10 | 7.2.4-1 | 构建尝试；踩 b2sums/树污染坑；系统 Emergency Mode 中断 |
| 2026-09-20 | 7.2.6-1 | 重新同步源码，构建成功；部署本机（UKI 重建）；拉回本地；Windows 菜单项加入 |
| 2026-09-23 | — | 编译服务器 fstab/mask 修复；本机重启验证通过（新内核运行中） |
| 2026-09-23 | 7.2.7-1 | **自动化构建与通知上线**；首次自动构建成功：7.2.6→7.2.7（66 分钟） |
| 2026-09-24 | — | 自动化健壮性修复：重试空正文 bug、重试改增量、新增巡检回执与异常回执 |
| 2026-09-26 | — | 新增配套文档《内核自动构建流水线 · 全链路解析》 |
| 2026-10-09 | 7.2.9-2 | 流水线重建（编译服务器重装后）：改名 `KBkernel-cachy`、关闭 Intel 无线 LAR、新增 GitHub 配方仓库与自动发布；首次自动构建成功（约 35 分钟，无 OOM） |

## 写在后面

自己编译内核这件事，门槛其实不在编译，而在**版本演进中的维护**。上游改了 Kconfig、补丁路径换了、校验和对不上了、编译机磁盘忘了挂，每一个都能让你在半夜面对一台进不了系统的机器。

所以这套方案最后沉淀下来的，是一份随包生效的定制（关闭 Intel 无线 LAR）、一套重放式合并的上游跟进机制、一条永远留着的回退路径。真正做成的是前两样。回退路径还是手动的，每次都得自己去菜单里挑 `arch-linux.efi`，这块我一直想改成自动探测，但还没动。云服务器那边也还停在 7.2.2，得排上。
