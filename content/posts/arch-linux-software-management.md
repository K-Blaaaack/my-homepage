---
title: "Arch Linux 软件管理与 .deb/.rpm 解决方案"
date: 2026-07-20T15:00:00+08:00
draft: false
tags: ["Linux", "Arch", "软件管理"]
categories: ["技术笔记"]
summary: "Arch Linux 下通过 AUR、Chaotic-AUR、Flatpak、debtap 和 distrobox 实现完整软件生态的方法。"
---

## 概述

Arch 官方仓库只提供最核心、最纯净的软件，默认看起来"软件少"。

真正的力量来自：

```
AUR + Chaotic-AUR + Flatpak + 容器
```

## AUR

AUR 是 Arch 的社区仓库，包含几乎所有商业、闭源、冷门软件。

```bash
sudo pacman -S --needed git base-devel

git clone https://aur.archlinux.org/yay.git
cd yay
makepkg -si
```

```bash
yay -S google-chrome
yay -S wechat-uos
yay -S qq-linux
yay -S visual-studio-code-bin
```

## Chaotic-AUR

提供已编译好的 AUR 软件，直接 `pacman` 安装，无需本地编译。

```bash
sudo pacman-key --recv-key 3056513887B78AEB --keyserver keyserver.ubuntu.com
sudo pacman-key --lsign-key 3056513887B78AEB
sudo pacman -U https://cdn-mirror.chaotic.cx/chaotic-aur/chaotic-keyring.pkg.tar.zst
sudo pacman -U https://cdn-mirror.chaotic.cx/chaotic-aur/chaotic-mirrorlist.pkg.tar.zst
```

```bash
echo -e "[chaotic-aur]\nInclude = /etc/pacman.d/chaotic-mirrorlist" | sudo tee -a /etc/pacman.conf
sudo pacman -Syu
```

## Flatpak

桌面软件的补充方案，沙箱隔离，跨发行版通用。

```bash
sudo pacman -S flatpak
flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

```bash
flatpak install flathub org.telegram.desktop
flatpak install flathub com.discordapp.Discord
```

## .deb / .rpm 解决方案

### 方案 1：AUR

先在 AUR 里搜有没有原生包：

```bash
yay -Ss 软件名
```

### 方案 2：debtap

将 `.deb` / `.rpm` 转换为 Arch 包：

```bash
yay -S debtap
sudo debtap -u

debtap xxx.deb
sudo pacman -U xxx.pkg.tar.zst
```

### 方案 3：distrobox

用容器运行 Ubuntu / Fedora 环境，直接装 `.deb`：

```bash
sudo pacman -S distrobox

distrobox create -i ubuntu:latest -n ubx
distrobox enter ubx
sudo apt install ./xxx.deb
```

## 依赖处理逻辑

| 来源 | 依赖处理方式 |
|------|-------------|
| 官方仓库 | pacman 自动处理 |
| AUR | 打包者处理 |
| Chaotic-AUR | 已编译，直接安装 |
| Flatpak | 沙箱隔离 |
| debtap | 自动映射 + 手动确认 |
| distrobox | 容器系统自行处理 |

## 推荐使用流程

1. `pacman` 搜索官方仓库
2. `yay` 搜索 AUR
3. 查 Chaotic-AUR 有无预编译包
4. 有 `.deb` / `.rpm` 文件用 `debtap` 转换
5. 以上都没有用 `distrobox` 容器兜底

## 总结

Arch Linux 并不是软件少，而是把自由、纯净、可控放在第一位。正确使用 AUR + Chaotic-AUR + Flatpak + 容器后，它将成为 Linux 生态中软件资源最丰富的发行版。
