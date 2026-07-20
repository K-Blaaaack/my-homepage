---
title: "ESP32 入门笔记"
date: 2025-12-15T14:30:00+08:00
draft: false
tags: ["ESP32", "单片机", "开发"]
categories: ["技术笔记"]
summary: "记录 ESP32 开发板的入门使用经验。"
---

## 硬件准备

- ESP32-DevKitC 开发板
- USB 数据线
- 面包板 + 杜邦线

## 开发环境

推荐使用 Arduino IDE 或 PlatformIO。

### PlatformIO 配置

```ini
[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
```

## 第一个程序

```cpp
void setup() {
  Serial.begin(115200);
  Serial.println("Hello, ESP32!");
}

void loop() {
  delay(1000);
}
```

上传后打开串口监视器即可看到输出。
