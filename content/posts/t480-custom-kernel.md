---
title: "ThinkPad T480 定制精简内核：按用途裁剪与一次 NAT 误裁修正"
date: 2026-09-27T10:00:00+08:00
draft: false
tags: ["内核", "CachyOS", "ThinkPad", "T480", "NAT", "精简内核", "编译"]
categories: ["技术笔记"]
summary: "ThinkPad T480 的定制精简内核：按 T480 实际用途裁剪（非官方通用内核），本次换用 CachyOS 官方配方重编，并修正了早期精简时误裁 NAT 模块导致透明代理不可用的问题。附 docker -it 卡死大坑。"
---

我给 ThinkPad T480 用的是一个**定制精简内核**——按这台机器的实际用途裁剪过的，不是发行版的通用内核。精简的好处是干净、体积小，但代价是**你得自己想清楚裁掉了什么**。

我就栽在这上面：早期精简时**不小心把 NAT 相关模块一起裁掉了**。当时没感觉，直到某天发现 [homevpn](/posts/homevpn/) 的"佛山家宽出口"不工作了——那条链路依赖 `iptables` 的 `nat` 表做 TCP `REDIRECT`。脚本没改、规则也挂上了，就是流量纹丝不动。

这次的修正方案是**换用 CachyOS 官方配方重新构建**：内核定位仍然是 T480 专用精简内核，但配置基线换成 CachyOS 的成熟配方，构建时逐项确认 NAT 相关配置保留。顺带也拿到了想要的性能组合——官方现成品里没有 **BORE + ThinLTO**（主配方是 EEVDF + ThinLTO，BORE 变体是无 LTO）。

它和我的[通用定制内核](/posts/custom-cachyos-kernel/)共用同一套 PKGBUILD 体系，只是产物包名和版本后缀不同。

## 一句话总览

> **BORE + Clang ThinLTO + x86-64-v3 + -O3 + HZ 1000 + full PREEMPT + BBR/BBR3 + IBT + BTF + zstd**

工程目录 `linux-cachyos-t480`，产物包 `linux-cachyos-t480`。

## 内核身份卡

| 项目 | 值 |
|---|---|
| 内核全名（`uname -r`） | `7.2.6-1-cachyos-T480-PE-Power-by-R730-Compiled-by-K-Black` |
| `uname -v` | `#1 SMP PREEMPT_DYNAMIC Wed, 23 Sep 2026 05:47:47 +0000` |
| 源码 | CachyOS/linux `cachyos-7.2.6-1`（Linux 7.2.6） |
| 编译器 | **clang 22.1.8 + LLD 22.1.8**（ThinLTO） |
| 构建身份 | `K-Black@R730`（`uname -v` 可见） |
| 构建机 | 编译服务器 R730（Docker 容器内构建） |
| 包 | `linux-cachyos-t480` 7.2.6-1 + `linux-cachyos-t480-headers` 7.2.6-1 |
| 产物 | `linux-cachyos-t480-7.2.6-1-x86_64.pkg.tar.zst`（≈29 MB）<br>`linux-cachyos-t480-headers-7.2.6-1-x86_64.pkg.tar.zst`（≈38 MB） |
| 产物位置 | 编译服务器 `/home/data2/cachy-build/pkgs/`；工程 `/home/data2/cachy-build/work/linux-cachyos-t480/` |
| 安装 | T480 于 2026-09-23 14:19（`pacman -U`），重启后为默认启动项 |

版本号同样是 localversion 三段拼接：

```
-1                                      # pkgrel
-cachyos                                # pkgname
-T480-PE-Power-by-R730-Compiled-by-K-Black   # 自定义后缀（localversion.30-custom）
```

## 为什么专门给 T480 定制

1. **T480 专用精简内核**：按 T480 实际用途定制裁剪（非官方通用内核），去掉无关驱动/功能
2. **历史误裁修正**：此前精简时**不小心裁掉了 NAT 相关模块**，导致透明代理/网关不可用（homevpn `link home` 依赖 `nat` 表 REDIRECT）；本次换用 **CachyOS 配方**重编，并确认 NAT 相关配置保留——`nf_nat` / `iptable_nat` / `nft_nat` / `xt_nat` 及其依赖
3. **性能组合**：随 CachyOS 配方获得 BORE 调度器 + ThinLTO + x86-64-v3 + `-O3` 等优化（官方现成品没有「BORE + ThinLTO」这个组合）
4. 与通用定制内核保持同一 PKGBUILD 体系，便于长期维护

第 2 条是这次返工的直接原因，也是最值得记下的一条教训——见下文「一次误裁的教训」。

## 关键配置（以构建后 `.config` 实证为准）

| 类别 | 关键项 | 值/说明 |
|---|---|---|
| 调度器 | `CONFIG_SCHED_BORE=y` | BORE，来自 PKGBUILD `_cpusched=bore` |
| LTO | `CONFIG_LTO_CLANG_THIN=y` | Clang ThinLTO，来自 `_use_llvm_lto=thin` |
| 微架构 | `CONFIG_X86_64_VERSION=3` | x86-64-v3，来自 `_processor_opt=generic_v3` |
| 优化等级 | `CONFIG_CC_OPTIMIZE_FOR_PERFORMANCE_O3=y` | `-O3`（CachyOS 默认体系） |
| 时钟 | `CONFIG_HZ=1000` | 1000Hz |
| 抢占 | `CONFIG_PREEMPT=y`（运行显示 PREEMPT_DYNAMIC） | full preempt |
| 拥塞控制 | `CONFIG_TCP_CONG_BBR=m`、`CONFIG_TCP_CONG_BBR3=m` | BBR + BBR3 |
| BTF | `CONFIG_DEBUG_INFO_BTF=y`（+`_MODULES=y`） | eBPF/bpftrace |
| 压缩 | `CONFIG_KERNEL_ZSTD=y`、`CONFIG_MODULE_COMPRESS_ZSTD=y`（ALL） | zstd 内核/模块 |
| NAT 相关模块 | `CONFIG_NF_NAT=m`、`CONFIG_NFT_NAT=m`、`CONFIG_NFT_MASQ=m`、`CONFIG_IP_NF_NAT=m`、`CONFIG_IP_NF_TARGET_MASQUERADE=m`、`CONFIG_NETFILTER_XT_NAT=m`、`CONFIG_NF_NAT_MASQUERADE=y`、`CONFIG_NF_NAT_REDIRECT=y`、`CONFIG_IP6_NF_NAT=m` 等 | 早期精简误裁，本次（CachyOS 配方）已修正保留 |
| LA57 | `X86_5LEVEL` 未启用；PKGBUILD 内含 LA57 硬禁用补丁（解压器强制 4 级页表） | 承袭同套 PKGBUILD 补丁；T480（Coffee Lake 8 代）硬件本不支持 5 级页表，无副作用 |

> 注：静态 `config` 文件是 CachyOS 官方 BORE 基线；`SCHED_BORE` / `X86_64_VERSION=3` / ThinLTO 等是构建时由 PKGBUILD 脚本写入的自动结果，**不是手改 config**。

`CONFIG_NF_NAT_REDIRECT=y` 这一项就是 homevpn 透明代理的命门——`iptables -t nat` 的 `REDIRECT --to-ports 12345` 全靠它。缺了它，`ss-redir` 收不到任何流量，`link home` 表面上成功、实际上一点效果都没有。**这正是早期精简误裁惹的祸**（详见文末「一次误裁的教训」）。

## 构建工程与流程

**工程位置**：编译服务器 `192.xxx.xxx.237`（经隧道可达）→ `/home/data2/cachy-build/work/linux-cachyos-t480/`

```
work/linux-cachyos-t480/
├── PKGBUILD        # 选项：_cpusched=bore, _processor_opt=generic_v3, _use_llvm_lto=thin
├── config          # 官方 BORE 基线 config
├── src/            # cachyos-7.2.6-1 源码（构建后 .config 在此）
└── pkg/            # 构建中间产物
```

PKGBUILD 关键行（未来修改只动这几处）：

```bash
: "${_cpusched:=bore}"
: "${_processor_opt:=generic_v3}"
: "${_use_llvm_lto:=thin}"
: "${_use_lto_suffix:=no}"
: "${_use_gcc_suffix:=yes}"
...
echo "-T480-PE-Power-by-R730-Compiled-by-K-Black" > localversion.30-custom
export KBUILD_BUILD_USER=K-Black
export KBUILD_BUILD_HOST=R730
```

### 构建命令行与一个大坑

在 Docker 容器内跑 `makepkg`（`-j40` 级别并行，约 1 小时）：

```bash
docker run --rm -w /build/work/linux-cachyos-t480 -e MAKEFLAGS=-j40 \
  -v /home/data2/cachy-build:/build cachy-kbuild:latest makepkg -s --noconfirm
```

> ⚠️ **不要用 `docker run -it`**。

这个坑值得单开一段。加了 `-it` 之后，交互式 TTY 会让 `conf --syncconfig` 在遇到新增符号（`(NEW)`）时**等待人工输入而永久卡死**——你就看着日志停在那里，一小时、两小时，什么都没发生。去掉 `-it`（stdin 变成 `/dev/null` → 读到 EOF 自动取默认值）后一次通过。

构建日志落在 `/home/data2/cachy-build/build-t480-0923-*.log`，成功产物拷到 `pkgs/`。

## 安装与验证（T480 实测）

```bash
# 1. 安装（两包一起，hook 自动部署）
sudo pacman -U linux-cachyos-t480-7.2.6-1-x86_64.pkg.tar.zst \
               linux-cachyos-t480-headers-7.2.6-1-x86_64.pkg.tar.zst
#    → 包自带 hook 自动写 /boot/vmlinuz-linux-cachyos-t480 + initramfs + preset

# 2. 设为 GRUB 默认启动项
#    /etc/default/grub:
#    GRUB_TOP_LEVEL="/boot/vmlinuz-linux-cachyos-t480"
sudo grub-mkconfig -o /boot/grub/grub.cfg

# 3. 重启后验证
uname -r                                     # → 7.2.6-1-cachyos-T480-PE-Power-by-R730-Compiled-by-K-Black
cat /proc/version                            # → (K-Black@R730) (clang version 22.1.8, LLD 22.1.8)
iptables -t nat -L                           # → nat 表正常列出（NAT 框架可用）
ls /usr/lib/modules/$(uname -r)/kernel/net/netfilter/ | grep -E 'nf_nat|nft_nat|xt_nat'
ls /usr/lib/modules/$(uname -r)/kernel/net/ipv4/netfilter/ | grep iptable_nat
lsmod | grep nf_nat                          # → 已加载（xt_REDIRECT/nft_chain_nat 等在用）
```

**验证结论（2026-09-23）**：`uname -r` 正确；`nf_nat` / `nft_nat` / `iptable_nat` / `xt_nat` / `nf_conntrack` 模块均在（`.ko.zst`）；`nf_nat` 已加载；`iptables -t nat` 正常；homevpn 透明代理（依赖 nat REDIRECT）实测可用。

## 回滚方案

1. **改启动项**：删除或改回 `GRUB_TOP_LEVEL`（例如指 `/boot/vmlinuz-linux`，Arch 官方内核 `linux 7.2.6.arch2-1` 仍并存），`sudo grub-mkconfig -o /boot/grub/grub.cfg`
2. **卸载**：`sudo pacman -R linux-cachyos-t480 linux-cachyos-t480-headers`
3. 产物包在编译服务器 `pkgs/` 随时可取回重装

和通用内核一样的原则：官方内核一直留着，随时能退回去。

## 重新构建（未来改动后）

1. 编译服务器改 `work/linux-cachyos-t480/PKGBUILD`（选项 / localversion）或 `config`
2. Docker 内 `makepkg`（**记住：不要 `-it`**）
3. 取 `pkgs/linux-cachyos-t480-*.pkg.tar.zst` 两个包传到 T480
4. T480 `sudo pacman -U` 两包 → hook 自动更新 initramfs → 重启（`GRUB_TOP_LEVEL` 已指向同名文件，无需再改）

## 验证清单（一分钟快检）

```bash
uname -r                                   # 版本串含 T480-PE-Power-by-R730
zcat /proc/config.gz | grep -E 'SCHED_BORE|LTO_CLANG_THIN|X86_64_VERSION|HZ=1000'   # 若 IKCONFIG 开了
grep -E 'SCHED_BORE|LTO_CLANG_THIN|X86_64_VERSION|PREEMPT=|HZ=' \
     /home/data2/cachy-build/work/linux-cachyos-t480/src/cachyos-7.2.6-1/.config   # 编译服务器上
sudo iptables -t nat -L >/dev/null && echo "NAT 框架 OK"
lsmod | grep -E 'nf_nat|nf_conntrack'
dmesg | grep -iE 'error|firmware' | tail   # 有无缺固件
```

## 一次误裁的教训

这次返工的起因值得完整记一遍，因为它是一个**很容易重复踩**的坑。

**起因**：早期为了给 T480 做精简，我在裁剪配置时把一批"看起来用不到"的网络模块一起去掉了——其中就包括 NAT 相关的那几个。

**症状**：homevpn 的 `link home`（佛山家宽透明代理）静默失效。具体表现非常具有迷惑性：

- `homevpn link home` 命令**返回成功**，没有任何报错
- `iptables -t nat -L HOMEVPN` 能看到规则**确实挂上了**
- `ss-redir` 进程**确实在跑**
- 但流量就是不走隧道——出口 IP 还是本机宽带

每一层单独看都是"正常"的，问题出在内核不认 `REDIRECT` 这个 target：**模块不存在时，规则挂载本身不报错，只是永远不匹配。**

**排查路径**（事后总结，比当时快得多）：

```bash
sudo iptables -t nat -L >/dev/null && echo "NAT 框架 OK"   # 第一步就够定位
lsmod | grep -E 'nf_nat|nf_conntrack'
ls /usr/lib/modules/$(uname -r)/kernel/net/netfilter/ | grep -E 'nf_nat|nft_nat|xt_nat'
```

**修正**：换用 CachyOS 官方配方重新构建，构建后逐项确认 NAT 相关配置（`nf_nat` / `iptable_nat` / `nft_nat` / `xt_nat` 及其依赖）全部保留，再安装验证。

**教训**：

1. **精简内核不要"顺手"删网络模块。** 网络栈的模块依赖关系又深又隐晦，看着无关的 `xt_*` / `nf_*` 往往是某个常用功能的最后一环
2. **"命令成功"不等于"功能生效"。** netfilter 的规则挂载和模块可用性是两件事，前者不校验后者
3. **换内核后要有回归清单。** 我现在的清单里固定包含 `iptables -t nat -L` 和 `lsmod | grep nf_nat`——成本两秒钟，能省掉一次"为什么代理没反应"的深夜排查

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-23 | 基于 CachyOS 配方构建 T480 精简内核（R730，clang 22.1.8 ThinLTO）、安装到 T480、重启验证通过（NAT 相关模块确认保留）；踩坑记录：docker `-it` 导致 syncconfig 卡死，去 `-it` 解决 |
| 2026-09-27 | 表述修正：内核定位改为「T480 定制精简内核（CachyOS 配方）」；NAT 相关表述改为「历史误裁，本次换 CachyOS 重编修正」 |

## 结语

给单台笔记本编内核，收益不在"跑分快了零点几个百分点"，而在于**能力的有无**——按自己的用途裁剪，去掉无关驱动，把想要的性能开关全打开。这台 T480 才算真正按我的用法配齐了。

但精简是把双刃剑：**你省下的每一个模块，都可能是未来某个功能的最后一环。** 我这次就是在 NAT 上栽了一跤——不是配置写错了，而是"当时觉得用不到"。

所以现在的原则是：**精简可以，但要有回归清单兜底**；而且配置基线尽量站在成熟配方（CachyOS）上做减法，而不是从零做加法。前者错了容易发现，后者错了往往要等到某个功能静默失效才暴露。

顺带说一句，这次编译能这么顺，靠的是编译服务器上那台 R730 和容器化的构建环境。而那套环境后来又被进一步自动化了，细节见[《内核自动构建流水线：从计划任务到 151MB 的包》](/posts/kernel-autobuild-pipeline/)。
