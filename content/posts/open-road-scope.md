---
title: "OpenRoadScope — 开源的跨平台行车数据可视化软件"
date: 2026-08-20T03:20:00+08:00
draft: false
tags: ["OBD", "ELM327", "Electron", "Vue", "Python", "开源项目", "车载诊断"]
categories: ["技术笔记"]
summary: "OpenRoadScope 是一个基于 OBD-II（ELM327）的开源跨平台行车数据可视化软件：Python sidecar 采集、Electron 主进程托管、Vue 3 自定义仪表盘，支持故障诊断、中英文、深浅主题与多平台发行。"
---

[OpenRoadScope](https://github.com/K-Blaaaack/open-road-scope)（GPL-2.0）是一个基于 OBD-II（ELM327）的跨平台行车数据可视化软件，实时读取车辆的传感器数据，用可自定义的卡片仪表盘显示，也带故障诊断。

先说点背景，这个项目是我闲着没事、突发奇想写的。某天心血来潮想看看自己车子的真实工况数据，市面上的 OBD 软件要么收费要么界面丑，于是干脆自己动手搓一个。本来以为就是写个串口工具，结果一路长成了今天这个支持桌面端、安卓端、多平台打包、自动化发布的完整工程。

## 背景：OBD-II 与 ELM327

OBD-II（On-Board Diagnostics II）是自 1996 年起在汽车上强制装备的车载诊断标准，通过统一的诊断座暴露车辆状态。市面上的 USB / 蓝牙 / RJ45 诊断适配器大多基于 ELM327 芯片，它把 OBD 协议栈封装成简单的 ASCII 命令（如 `010C` 读转速），任意设备都能通过串口与它对话。这也是我能自己动手写一个行车数据软件的前提。

本项目的数据采集层直接建立在 [python-OBD](https://github.com/brendan-w/python-OBD) 之上，并把这一层做成独立的 Python sidecar 进程。

## 功能一览

| 功能 | 说明 |
|---|---|
| 实时数据 | 车速、转速、水温、油耗等 16 种 PID（OBD 模式 01），500ms 订阅推送 |
| 自定义仪表盘 | 卡片化布局（折线图 / 柱状图 / 数值），编辑模式自由拖拽、缩放，预设与导入导出 |
| 故障诊断 | 读取 / 清除故障码（DTC）、读取 VIN（清除故障码为实验性开关，带二次确认） |
| 连接方式 | USB 串口 / 蓝牙串口 / 网络（RJ45 OBD 串口） |
| 多语言 | 简体中文 / English，vue-i18n 全量文案 |
| 主题 | 深色 / 浅色切换（跟随图标同步变化） |
| 模拟模式 | 无实车环境下内置驾驶仿真，可直接开发与演示 |
| 安全引导 | 首次使用引导 + 行车安全警告（可勾选"不再显示"） |
| 开发者模式 | 连续点击图标开启，解锁模拟模式入口与开发者菜单 |
| 自动更新 | electron-updater，支持各平台发布渠道 |
| Android | Capacitor WebView + 原生 OBD 桥，支持蓝牙 / USB / TCP 实车连接 |

## 系统架构

```
ELM327（USB / 蓝牙 / RJ45）
      ↓
Python sidecar（python-OBD 采集，stdio JSON-RPC）
      ↓
Electron 主进程（进程管理 / IPC）
      ↓
渲染进程（Vue 3 + Pinia + 自定义仪表盘）
```

三层各管一摊，中间靠共享契约衔接。

- **主进程（`electron/`）**：负责 sidecar 子进程生命周期管理、IPC 路由，不接触任何 OBD 协议细节；
- **预加载（preload contextBridge）**：把 `window.obd` 以最小 API 暴露给渲染进程；
- **渲染进程（`src/`）**：Vue 3 + Pinia 的纯界面层，只依赖 `window.obd` 与共享契约；
- **共享契约（`shared/`）**：主进程与渲染进程共同引用的 TypeScript 类型与 zod schema，PID 定义、RPC 消息格式、事件负载全部集中于此，两侧不再各写一份。

数据采集层做成 sidecar 而不是集成进主进程，理由很简单，OBD 串口读写是阻塞操作，放在 UI 进程会卡界面，python-OBD 生态又已经成熟，没必要在 Node 侧再写一遍。通信协议是极简的 JSON Lines over stdio，一共 `subscribe / unsubscribe / query / status / ping / list_ports` 六种方法、`data / status / error / log` 四类事件，零第三方依赖，协议定义见 `sidecar/obd_sidecar/protocol.py`。

## 关键设计

### 1. Sidecar 进程托管（`electron/main/sidecar/manager.ts`）

sidecar 进程的生死全交给主进程的 `SidecarManager` 负责，主要是三件事。

- **开发 / 生产双路径**：dev 直接用 `sidecar/.venv/bin/python -m obd_sidecar.main` 跑源码（模拟模式零依赖）；打包后运行 electron-builder `extraResources` 内置的 PyInstaller 独立可执行文件（Windows 下自动找 `.exe`）；
- **崩溃自动重启**：指数退避 1s → 15s，退出码 0 视为正常退出不重启；
- **心跳保活**：每 10s 一次 `ping`，连续 2 次失败判定假死，杀掉重启。

### 2. 订阅调度器（`sidecar/obd_sidecar/scheduler.py`）

订阅多了不能一条一条发消息，所以按间隔分组（最小 50ms），50ms 一次 tick，把到期的 PID 读取合并成单帧推出去。断线重连交给一个独立的连接监控线程，失败就按指数退避重试，状态变化实时用 `status` 事件抛出来。

### 3. 模拟设备（`sidecar/obd_sidecar/sim.py`）

模拟设备是为了没车也能开工。`SimDevice` 按一条虚拟驾驶循环（加速 0-40s → 巡航 40-80s → 减速 80-120s）合成物理上合理的波形，仪表真的会动。还支持 `--fault` 随机注入帧错误、`--drop N` 每 N 秒模拟断连，方便测试前端的重连与错误处理路径。

### 4. 仪表盘 Store（`src/stores/dashboard.ts`）

布局本身不复杂，就是一份 12 列网格。卡片分折线 / 柱状 / 数值三种，都能拖拽、缩放（数值卡片还支持字号缩放），量程可以自定义，另外内置了预设布局和 JSON 导入导出。

- 导入走 `normalizeLayout` 全量校验规整（坐标、尺寸、类型、字号全部 clamp 到合法范围），杜绝脏数据；
- 布局持久化到 localforage（IndexedDB），连续编辑 250ms 防抖合并落盘；
- 布局改动后按当前卡片 PID 集合自动重订阅数据流，移除卡片即自动退订，省带宽省电量。

### 5. ELM327 协议引擎与 Android 桥（`src/obd/`）

Android 端是另一条路。桌面端走 Electron preload，Android 端把 python-OBD 的核心协议逻辑移植成了 TypeScript 的 `Elm327Session`（ISO 15765-4 CAN 11bit 自动协议），跑在 WebView 里，字节流读写交给原生桥 `window.androidObd`（蓝牙 / USB / TCP 自动识别端口格式）。轮询在主线程分批调度，每次空闲只查 1 个 PID，避免同步串口读阻塞界面。

### 6. 历史缓冲

折线图要能回看最近 60s 的数据，所以渲染进程自己写了个环形缓冲（`src/core/ring-buffer.ts`），内存占用恒定。

## 界面

- **仪表盘**：卡片网格，支持编辑模式、窗口适配（行高随窗口伸缩，过小自动滚动而非裁切）；
- **连接页**：模式选择（实车 / 模拟）、连接方式分类、串口枚举（自动识别 USB / 蓝牙串口类型）、网络串口地址（默认 35000）；
- **诊断页**：读取 / 清除故障码（带醒目二次确认）、读取 VIN；
- **设置页**：中英文切换、深浅主题、界面适配选项；
- **开发者页 / 关于页**：开发者模式入口、版本信息与联网检查更新。

## 多平台构建与 CI

发布产物覆盖主流平台，Windows（NSIS / 便携版 / MSI）、macOS（DMG / ZIP）、Linux（AppImage / deb / rpm / snap / tar.gz）、Android（APK）。GitHub Actions 的 Release 工作流按三平台矩阵 + Android 任务自动构建，大致三步。

1. 各平台分别建 sidecar venv、装依赖、跑 `pnpm build` 与 `pnpm build:sidecar`（PyInstaller 产物与平台绑定，必须在目标平台构建）；
2. electron-builder 打对应格式并统一产物命名（`OpenRoadScope-<版本>-<平台>-<架构>`）；
3. 上传构件并自动发布 Release。

## 版本管理

遵循语义化版本（vX.Y.Z），由 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 自动推导，`feat:` → minor、`fix:` → patch、`feat!:` → major，`pnpm release` 一步完成版本号更新 + CHANGELOG 生成 + 打 tag，`pnpm release:push` 推送触发 CI 自动发布。当前最新版本为 v0.1.6。

## 开发与测试

```bash
pnpm install
cd sidecar && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
pnpm dev        # 启动开发（默认模拟模式，零硬件可跑）
```

三层都有自己的测试，Vitest（渲染进程）、tsx（主进程与共享契约）、pytest（sidecar），`pnpm test:all` 一键全跑；另有 `pnpm typecheck` 与 `pnpm lint` 双保险。

说到底这是我给自己攒的一个玩具，本来只想把车上的数据读出来看看，没想到一路写到了自动发版。Python 管硬件、Node 管进程、Vue 管界面，各层只依赖 `shared/` 里的类型契约，实车 / 模拟、桌面 / 安卓共用同一套前端。

如果你也有一台车、一个几十块的 ELM327 适配器，欢迎拿它当参考，或者直接提 Issue 一起玩。

项目仍在快速迭代中（0.1.x 阶段，几乎每天都有提交），也欢迎 Star 和参与开发。

- 源码：<https://github.com/K-Blaaaack/open-road-scope>
- 许可证：GPL-2.0