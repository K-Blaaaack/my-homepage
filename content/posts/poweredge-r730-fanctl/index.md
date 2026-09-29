---
title: "Dell PowerEdge R730 风扇手动控制脚本 — 原理与使用"
date: 2026-08-14T12:00:00+08:00
draft: false
tags: ["PowerEdge", "R730", "IPMI", "iDRAC", "ipmitool", "风扇", "脚本"]
categories: ["技术笔记"]
summary: "基于 ipmitool/IPMI raw 命令的 R730 风扇手动控制脚本，支持百分比调速、中英双语、Ctrl+C 自动恢复，附完整源码与下载。"
---

Dell PowerEdge R730 默认的散热策略（iDRAC 根据 CPU/内存温度自动调速）在大多数场景下都够用，但在家用、低负载或改造机房环境下，风扇转速依然偏高。噪音感人。这台机器用 `ipmitool` 走 iDRAC 的 IPMI `raw` 命令可以把手动控制权拿回来。

下面讲我写的这个风扇手动控制脚本（`fanctl.sh`）怎么用、为什么这么写。源码在文末一并给出。

## 为什么能控制？

PowerEdge 服务器的 iDRAC 内置了 IPMI（Intelligent Platform Management Interface），它提供了一套与操作系统无关的带外管理通道，通过 IPMI Over LAN（`lanplus` 接口）即可在局域网内直接给 BMC 下发指令。iDRAC 开放了一组 `raw` 命令（直接封装 IPMI 厂商私有 OEM 命令），风扇控制就藏在这三条指令里。

| 用途 | raw 命令 | 说明 |
|---|---|---|
| 切换手动模式 | `raw 0x30 0x30 0x01 0x00` | 最后的 `0x00` 表示关闭自动调速，接管风扇 |
| 恢复自动模式 | `raw 0x30 0x30 0x01 0x01` | `0x01` 表示交还给 BIOS/iDRAC 自动管理 |
| 设置转速 | `raw 0x30 0x30 0x02 0xff 0xXX` | `0xff` 后跟一个字节，是 0-100 的转速百分比 |

核心逻辑就三步。

1. 通过 `ipmitool -I lanplus` 连接 iDRAC；
2. 发送 `0x30 0x30 0x01 0x00` 切到手动模式；
3. 发送 `0x30 0x30 0x02 0xff 0xXX` 设置目标转速，`0xXX` 是十六进制表示的百分比。

## 脚本做了什么

源码在 [下载 fanctl.sh](./fanctl.sh)，和下面贴出来的完全一致。

### 1. 连接参数

```bash
IP="192.168.31.92"
USER="root"
PASS="calvin"
```

脚本顶部集中放置 iDRAC 的 IP、用户名和密码。`calvin` 是 Dell 服务器的出厂默认密码，首次使用记得改掉。

`ipmi()` 把连接参数和实际命令包成了一个函数。

```bash
ipmi() {
    ipmitool -I lanplus -H "$IP" -U "$USER" -P "$PASS" "$@"
}
```

之后所有指令都走这一个函数，改连接参数时只需动一处。

### 2. 百分比与十六进制的换算

IPMI raw 命令里转速是一个字节（0x00-0xFF），而我们更习惯输入百分比。换算交给 `pct2hex`。

```bash
pct2hex() {
    local pct=$1
    local hex
    hex=$(printf '%x' "$pct")
    if (( pct < 16 )); then
        echo "0x0${hex}"
    else
        echo "0x${hex}"
    fi
}
```

把十进制百分比转成两位十六进制，`35` 变成 `0x23`，`8` 变成 `0x08`。反向的 `hex2pct` 目前主要用于对称展示。

### 3. 模式切换与调速

```bash
set_manual() { ipmi $MANUAL_CMD; }   # 切手动
set_auto()   { ipmi $AUTO_CMD; }     # 恢复自动
set_speed()  { ipmi $SPEED_CMD_PREFIX "$hex"; }  # 设转速
```

`set_speed` 会先校验范围，非法输入（`< 1` 或 `> 100`）直接报错退出，防止把转速设成 0 或超过 100%。

```bash
if (( pct < 1 || pct > 100 )); then
    _ speed_err
    return 1
fi
```

### 4. 安全兜底：Ctrl+C 自动恢复

这是脚本最关键的一段。

手动模式下风扇由你接管。脚本被 `Ctrl+C` 打断直接退出的话，风扇会保持你最后设的那个低转速，服务器可能就在没有保护的情况下继续升温。

兜底靠 `trap`。

```bash
toggle_manual_trap() {
    _ trap_msg
    set_auto
    exit 0
}

trap toggle_manual_trap SIGINT SIGTERM
```

收到 `SIGINT`/`SIGTERM` 时，先恢复自动模式再退出。无论正常退出还是被中断，风扇控制权都回到 iDRAC 手里。

### 5. 中英双语输出

脚本根据 `$LANG` / `$LANGUAGE` 环境变量自动判断语言（包含 `zh`/`cn` 则中文，否则英文），并把所有提示文案集中在一个 `_()` 函数里做查表。交互模式中还支持在运行时用 `lang zh` / `lang en` 随时切换。

### 6. 两种使用方式

**交互模式**（不带参数直接运行）

```bash
./fanctl.sh
```

进入 `fanctl>` 提示符，能用的是下面这些。
- 输入 `1-100` 的任意数字直接调速；
- `auto` 恢复自动模式后重新进入手动，方便对比；
- `status` 查看当前连接配置；
- `lang zh|en` 切换语言；
- `exit` / `quit` / `q` 退出，退出前自动恢复自动模式；
- 任何时候 `Ctrl+C` 也会恢复自动模式并退出。

**单命令模式**（带一个参数）

```bash
./fanctl.sh 35        # 一键把风扇调到 35%
./fanctl.sh auto      # 恢复自动控制
./fanctl.sh status    # 查看状态
./fanctl.sh help      # 查看帮助
```

适合在开机脚本、cron 或一键脚本里调用，比如开机降噪可以直接写 `fanctl.sh 25`。

## 使用前提

- 安装 `ipmitool`（Arch: `pacman -S ipmitool`）；
- 能通过局域网访问 iDRAC 的 IPMI 端口（623/UDP）；
- 操作系统上装了 ipmitool 的驱动/内核模块（一般发行版自带）。

## 注意事项

- **风险自担**：手动模式取消了温控保护，转速设太低在高温高负载下可能引发过热甚至关机。建议设置合理下限（比如 20% 以上），并留一只眼睛盯着温度。
- 脚本启动时会自动先切到手动模式，退出时保证恢复自动，这是它和其他一次性命令最大的区别。
- iDRAC 的 `raw 命令` 属于厂商私有 OEM 指令，不同代际/型号可能不一致，本脚本针对 R730（iDRAC8）验证。
- 默认密码 `calvin` 如果没改，局域网里任何一台机器都能控制你的风扇（甚至远程开关机），务必先改密。

## 完整源码

```bash
#!/bin/bash
set -e

IP="192.168.31.92"
USER="root"
PASS="calvin"

MANUAL_CMD="raw 0x30 0x30 0x01 0x00"
AUTO_CMD="raw 0x30 0x30 0x01 0x01"
SPEED_CMD_PREFIX="raw 0x30 0x30 0x02 0xff"

detect_lang() {
    local lang="${LANG:-}${LANGUAGE:-}"
    if [[ "$lang" == *zh* || "$lang" == *ZH* || "$lang" == *cn* || "$lang" == *CN* ]]; then
        CURRENT_LANG="zh"
    else
        CURRENT_LANG="en"
    fi
}
detect_lang

_() {
    local key="$1"; shift
    case "$key" in
        test_conn)    [[ "$CURRENT_LANG" == "zh" ]] && echo -n "正在测试 IPMI 连接到 ${IP}... "        || echo -n "Testing IPMI connection to ${IP}... " ;;
        ok)           [[ "$CURRENT_LANG" == "zh" ]] && echo "成功"                                     || echo "OK" ;;
        failed)       [[ "$CURRENT_LANG" == "zh" ]] && echo "失败"                                     || echo "FAILED" ;;
        manual_on)    [[ "$CURRENT_LANG" == "zh" ]] && echo -n "切换到手动风扇控制... "                || echo -n "Switching to manual fan control... " ;;
        auto_on)      [[ "$CURRENT_LANG" == "zh" ]] && echo -n "恢复到自动风扇控制... "                || echo -n "Restoring automatic fan control... " ;;
        done)         [[ "$CURRENT_LANG" == "zh" ]] && echo "完成"                                     || echo "Done" ;;
        speed_err)    [[ "$CURRENT_LANG" == "zh" ]] && echo "错误: 百分比必须在 1-100 之间"            || echo "ERROR: percentage must be 1-100" ;;
        set_speed)    [[ "$CURRENT_LANG" == "zh" ]] && echo -n "设置风扇速度为 $1% ($2)... "          || echo -n "Setting fan speed to $1% ($2)... " ;;
        re_manual)    [[ "$CURRENT_LANG" == "zh" ]] && echo "重新启用手动模式..."                       || echo "Re-enabling manual mode..." ;;
        trap_msg)     [[ "$CURRENT_LANG" == "zh" ]] && echo "检测到中断信号，恢复自动模式并退出..."    || echo "Caught interrupt, restoring auto mode and exiting..." ;;
        exit_msg)     [[ "$CURRENT_LANG" == "zh" ]] && echo "恢复自动模式并退出..."                     || echo "Restoring auto mode and exiting..." ;;
        title)        [[ "$CURRENT_LANG" == "zh" ]] && echo "IPMI 风扇控制 - 交互模式"                  || echo "IPMI Fan Control - Interactive Mode" ;;
        info)        [[ "$CURRENT_LANG" == "zh" ]] && echo "Power By K-Black"                  || echo "Power By K-Black" ;;
        prompt_text)  [[ "$CURRENT_LANG" == "zh" ]] && echo "输入风扇速度 (1-100), 'auto', 'status', 'exit', 'lang zh|en'"     || echo "Enter fan speed (1-100), 'auto', 'status', 'exit', 'lang zh|en'" ;;
        ctrlc_note)   [[ "$CURRENT_LANG" == "zh" ]] && echo "Ctrl+C 恢复自动模式并退出。"              || echo "Ctrl+C restores auto and exits." ;;
        invalid)      [[ "$CURRENT_LANG" == "zh" ]] && echo "无效输入: 请输入 1-100, 'auto', 'status', 'exit', 'lang zh|en'"  || echo "Invalid input: enter 1-100, 'auto', 'status', 'exit', 'lang zh|en'" ;;
        lang_sw)      [[ "$CURRENT_LANG" == "zh" ]] && echo "语言已切换为: 中文"                        || echo "Language switched to: English" ;;
        lang_usage)   [[ "$CURRENT_LANG" == "zh" ]] && echo "用法: lang zh|en    当前语言: ${CURRENT_LANG}" || echo "Usage: lang zh|en    Current: ${CURRENT_LANG}" ;;
        status_header) [[ "$CURRENT_LANG" == "zh" ]] && echo "--- 当前状态 ---"                          || echo "--- Current Status ---" ;;
        status_ip)    [[ "$CURRENT_LANG" == "zh" ]] && echo "IP:    ${IP}"                               || echo "IP:    ${IP}" ;;
        status_user)  [[ "$CURRENT_LANG" == "zh" ]] && echo "用户:  ${USER}"                             || echo "User:  ${USER}" ;;
        status_mode)  [[ "$CURRENT_LANG" == "zh" ]] && echo "模式:  手动"                                || echo "Mode:  manual" ;;
        help_usage)   [[ "$CURRENT_LANG" == "zh" ]] && echo "用法:"                                     || echo "Usage:" ;;
        help_fan)     [[ "$CURRENT_LANG" == "zh" ]] && echo "  fan               按百分比设置速度 (1-100)，自动转换为十六进制" || echo "  fan               set speed by percentage (1-100), converts to hex automatically" ;;
        help_auto)    [[ "$CURRENT_LANG" == "zh" ]] && echo "  auto              恢复自动风扇控制"      || echo "  auto              restore automatic fan control" ;;
        help_status)  [[ "$CURRENT_LANG" == "zh" ]] && echo "  status            显示当前设置"          || echo "  status            show current settings" ;;
        help_lang)    [[ "$CURRENT_LANG" == "zh" ]] && echo "  lang zh|en        切换语言"               || echo "  lang zh|en        switch language" ;;
        help_exit)    [[ "$CURRENT_LANG" == "zh" ]] && echo "  exit / quit / q   退出脚本"             || echo "  exit / quit / q   exit script" ;;
        separator)    echo "===================================" ;;
    esac
}

ipmi() {
    ipmitool -I lanplus -H "$IP" -U "$USER" -P "$PASS" "$@"
}

pct2hex() {
    local pct=$1
    local hex
    hex=$(printf '%x' "$pct")
    if (( pct < 16 )); then
        echo "0x0${hex}"
    else
        echo "0x${hex}"
    fi
}

hex2pct() {
    local hex=$1
    printf '%d' "$hex"
}

test_conn() {
    _ test_conn
    if ipmi mc info &>/dev/null; then
        _ ok
    else
        _ failed
        exit 1
    fi
}

set_manual() {
    _ manual_on
    ipmi $MANUAL_CMD
    _ done
}

set_auto() {
    _ auto_on
    ipmi $AUTO_CMD
    _ done
}

set_speed() {
    local pct=$1
    if (( pct < 1 || pct > 100 )); then
        _ speed_err
        return 1
    fi
    local hex
    hex=$(pct2hex "$pct")
    _ set_speed "$pct" "$hex"
    ipmi $SPEED_CMD_PREFIX "$hex"
    _ done
}

cmd_status() {
    _ status_header
    _ status_ip
    _ status_user
    _ status_mode
}

cmd_help() {
    _ help_usage
    _ help_fan
    _ help_auto
    _ help_status
    _ help_lang
    _ help_exit
}

toggle_manual_trap() {
    echo ""
    _ trap_msg
    set_auto
    exit 0
}

trap toggle_manual_trap SIGINT SIGTERM

test_conn
set_manual

run_cmd() {
    case "$1" in
        auto)
            set_auto
            ;;
        status)
            cmd_status
            ;;
        help|'?'|h|--help|-h)
            cmd_help
            echo ""
            _ prompt_text
            exit 0
            ;;
        lang|lang\ *)
            arg="${1#lang}"
            arg="${arg# }"
            case "$arg" in
                zh|cn|中文) CURRENT_LANG="zh" ;;
                en)         CURRENT_LANG="en" ;;
            esac
            ;;
        ''|*[!0-9]*)
            _ invalid
            exit 1
            ;;
        *)
            set_speed "$1"
            ;;
    esac
}

if [[ $# -gt 0 ]]; then
    test_conn
    trap toggle_manual_trap SIGINT SIGTERM
    run_cmd "$1"
    exit 0
fi

echo ""
_ title
_ separator
_ info
_ separator
cmd_help
echo ""
_ ctrlc_note
echo ""

while true; do
    read -r -p "fanctl> " input
    case "$input" in
        exit|quit|q)
            _ exit_msg
            set_auto
            exit 0
            ;;
        auto)
            set_auto
            _ re_manual
            set_manual
            ;;
        status)
            cmd_status
            ;;
        help|'?'|h)
            cmd_help
            ;;
        lang|lang\ *)
            arg="${input#lang}"
            arg="${arg# }"
            case "$arg" in
                zh|cn|中文)
                    CURRENT_LANG="zh"
                    _ lang_sw
                    ;;
                en)
                    CURRENT_LANG="en"
                    _ lang_sw
                    ;;
                '')
                    _ lang_usage
                    ;;
                *)
                    _ lang_usage
                    ;;
            esac
            ;;
        ''|*[!0-9]*)
            _ invalid
            ;;
        *)
            set_speed "$input"
            ;;
    esac
done
```

下载在 [fanctl.sh](./fanctl.sh)，记得把里面的 IP 和密码换成你自己的。

脚本本身没什么玄机，几十行，真被 `Ctrl+C` 打断的时候顶用的是那个 `trap`。

它到现在也不会自己看温度，转速设多少全靠你手上的判断。所以 `auto` 别嫌麻烦，编译、压测、夏天最热的那几天，先交回 iDRAC 再说。

至于噪音，别指望 R730 能安静到放进卧室。默认策略跟手动 20% 之间的差距，是耳朵一听就知道的那种，我觉得够了。
