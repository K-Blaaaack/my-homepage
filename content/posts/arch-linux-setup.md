---
title: "Arch Linux 安装记录"
date: 2026-01-10T09:00:00+08:00
draft: false
tags: ["Linux", "Arch"]
categories: ["技术笔记"]
summary: "Arch Linux 安装过程的简要记录。"
---

## 分区方案

| 分区 | 大小 | 挂载点 |
|------|------|--------|
| EFI | 512M | /boot |
| Root | 50G | / |
| Home | 剩余 | /home |

## 安装步骤

1. `pacstrap / base linux linux-firmware`
2. `genfstab -U / > /etc/fstab`
3. `arch-chroot /`
4. 设置时区、语言、网络
5. 安装引导程序

## 常用软件

```bash
sudo pacman -S git vim nodejs npm
```
