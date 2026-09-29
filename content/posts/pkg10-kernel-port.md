---
title: "PKG10 (OnePlus Ace 5) 主线内核移植 — 笔记"
date: 2026-08-05T04:00:00+08:00
draft: false
tags: ["内核", "移植", "OnePlus", "Kernel", "Linux"]
categories: ["技术笔记"]
summary: "OnePlus Ace 5 (PKG110) 主线内核移植笔记：目标启动 → 屏幕 → 触控。每日持续更新。"
---

更新时间: 2026-08-05 04:00（每日持续更新）

## 目标
- 内核: Linux **7.1.6 stable** | 设备: OnePlus Ace 5 (PKG110, giulia-23851, SM8650)
- 里程碑: 内核启动 → 屏幕(AA577) → 触控(S3910)

## 版本记录 (Commit)
| 组件 | 版本/来源 | 指纹 |
|---|---|---|
| 内核 (主线) | Linux 7.1.6 stable (tarball) | SHA256 `995dd7188d924662b94b48fd6fb783587267590e5b8bb33dade2c771e7d855c1` |
| 内核源码 | `/home/kb/pkg110_kernel_project/linux-7.1.6/` (本地修改) | 修改见下 |
| 设备树 | `arch/arm64/boot/dts/qcom/sm8650-oneplus-giulia.dts` | 2026-08-05 02:20 最后修改 |
| 面板驱动 | `drivers/gpu/drm/panel/panel-boe-aa577.c` | 2026-08-05 01:38 (初始版) |
| 调试代码 | `arch/arm64/kernel/early_marker.c` (调试用) | 2026-08-05 03:23 |
| config fragment | `arch/arm64/configs/giulia.config` | 含 VA_BITS=39/KASLR 实验残留 |
| 参考仓库 (vendor) | OnePlusOSS/android_kernel_modules_and_devicetree_oneplus_sm8650, 分支 `oneplus/sm8650_v_15.0.0_oneplus_ace5` | commit `b34aec49` (PKG110_15.0.0.860(CN01), QCOM TAG ...017.100) |

注: 内核 git commit hash 未获取（无网络访问 git.kernel.org），用 tarball SHA256 作指纹。升级内核版本前先记录指纹。

## 设备/Bootloader 信息
| 项 | 值 | 来源 |
|---|---|---|
| 型号 | PKG110 (OP5D2BL1) | getprop |
| 固件 | PKG110_16.0.7.200(CN01), Android 16 | getprop |
| incremental | V.50213d4-2c63a59-2c63a56 | getprop |
| 运行内核 | 6.1.141-android14-11-o (KSU, 2026-04-10) | uname |
| slot | **_a** (ro.boot.slot_suffix) | getprop |
| unlock | **unlocked:yes** (fastboot getvar) | fastboot |
| secure boot | **yes** (bootloader 界面显示) | 用户观察 |
| hw-revision | 20000 | fastboot |
| variant | SM_ UFS | fastboot |
| version-bootloader | (空, OPPO 不提供) | fastboot |
| version-baseband | (空) | fastboot |
| vbmeta | 空壳 (flags=0, alg=0, 无描述符) | 提取分析 |
| vbmeta.device_state (ro) | locked (伪装值) | getprop |
| ramoops | 0xbffdbf000, 0x240000 (record 0x40000, console 0x40000, pmsg 0x200000) | dmesg/sysfs |
| 屏幕 | BOE AA577-P-3-A0020 (cmdline 确认) | /proc/cmdline |
| 触控 | Synaptics S3910 @ spi4(a90000) irq162/reset161 | /proc/cmdline+sysfs |
| WiFi | WCN7850 (kiwi) | 固件已提取 |

## 实验记录 (EXP)
| # | 实验 | 修改 | 结果 |
|---|---|---|---|
| EXP001 | fastboot boot v2 单文件 (os15.0.0) | - | Booting OKAY → 回 fastboot (后判定假 OKAY) |
| EXP002 | flash v4 三镜像 (os15.0.0, 空 vendor ramdisk) | 三镜像 | 回 fastboot |
| EXP003 | flash 原厂 boot/init_boot + 我们 vendor_boot | vendor_boot | 回 fastboot (混淆: dtb 不匹配) |
| EXP004 | flash 三镜像 (os14.0.0+ramoops+原厂lz4 vendor ramdisk) | 多改 | 回 fastboot ~5s |
| EXP005 | flash 我们 boot + 原厂 init_boot/vendor_boot | boot | 回 fastboot 4.85s, pstore 空 |
| EXP006 | fastboot boot v2 (ramoops 内核) | - | Booting OKAY → 回 fastboot |
| EXP007 | fastboot boot **KSU 内核** v2 | - | Booting OKAY → 回 fastboot, pstore 空 → **fastboot boot 路径不执行内核** |
| EXP008 | flash 45MB padding KSU boot | KSU Image+padding | 黑屏后**正常启动** → 大小非限制 |
| EXP009 | 我们 Image 的 image_size 字段改 37.5MB | Image 头 | 回 fastboot → 排除 image_size |
| EXP010 | os_version 对齐 14.0.0/2026-05 | header | 回 fastboot → 排除 |
| EXP011 | Image.gz 压缩内核 | kernel | 设备无响应 (gzip 可能不支持, 结果无效) |
| EXP012 | v2 flash (kernel+ramdisk+dtb) | - | 回 fastboot |
| EXP013 | KSU pmsg 跨重启保留测试 | - | **pmsg 重启后消失** → bootloader 清内存, marker 方案不可行 |
| EXP014 | ramoops marker (early_memremap) | 内核 | pstore 空 |
| EXP015 | ramoops marker (phys_to_virt) | 内核 | pstore 空 |
| EXP016 | **start_kernel 入口** SMC SYSTEM_OFF 探针 | 内核 | 回 fastboot (未关机) → **未到达 start_kernel** |
| EXP017 | **head.S primary_entry** SMC SYSTEM_OFF 探针 | 内核 | USB 1s 消失 (关机) → **内核入口被执行!** |
| EXP018 | KASLR off (CONFIG_RANDOMIZE_BASE=n) | config | 回 fastboot → 排除 |
| EXP019 | VA_BITS 52→39 (对齐 GKI) | config | 回 fastboot → 排除 |
| EXP020 | **__primary_switched 开头** SMC SYSTEM_OFF 探针 | head.S | **已编译待测** (`out/giulia_boot_exp20.img`) |

## 启动执行流程图 (当前定位)
```
Bootloader (flash 启动路径, 不执行 fastboot boot 内存加载)
      │  ✓ 加载并跳转 (EXP017 证明)
      ▼
primary_entry ──────────────── ✓ 已确认执行 (EXP017 SMC 生效→关机)
      │
      ▼
record_mmu_state / preserve_boot_args
      │
      ▼
__pi_create_init_idmap ─────── ? 未定位 (嫌疑区 ①)
      │
      ▼
init_kernel_el / __cpu_setup ─ ? 未定位 (嫌疑区 ②)
      │
      ▼
__primary_switch / __enable_mmu (KASLR 已排除)
      │
      ▼
__primary_switched ─────────── ? 未定位
      │
      ▼
start_kernel 入口 ──────────── ✗ 未达到 (EXP016)
      │
      ▼
setup_arch → ... → initramfs ─ (未到达)
```

## 下一步 (按优先级)
1. **EXP020 待测**: `__primary_switched` 开头 SMC 探针 (`out/giulia_boot_exp20.img`)
   - 关机 → 卡死在 `__primary_switch` 之后/start_kernel 前 (reloc/KASLR 相关) → 放更早探针 (`__cpu_setup` 后)
   - 不关机 → 卡死在 primary_entry 内 (create_init_idmap / __cpu_setup) → 放 H2 探针
2. 定位卡死区间后再往下查 (页表建立 / TCR / reloc / 内存布局)
3. 对比主线 7.1 head.S 与 GKI 6.1 (KSU Image 可反汇编) 的早期路径差异
4. 恢复生产配置: 移除 head.S/early_marker 调试代码, VA_BITS 决定最终值

## 构建产物 (out/)
- `giulia_boot.img` / `giulia_init_boot.img` / `giulia_vendor_boot.img` — v4 三镜像 (主测试)
- 实验变体: `*_nokaslr` `*_va39` `*_h1` `*_marker` `*_sd` `*_gz` `*_v2` `ksu_*` (对照)
- `stock/` — 原厂 KSU 三镜像备份 (**设备当前状态**)
- `firmware/` — kiwi(WCN7850)/lanai/GPU zap (已提取)
- 测试流程: flash 三镜像 → reboot → 观察 (关机/adb/fastboot) → 恢复 stock 三镜像
- 恢复命令: `fastboot flash boot/init_boot/vendor_boot out/stock/stock_*.img`
