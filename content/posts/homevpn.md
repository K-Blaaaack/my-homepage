---
title: "homevpn：异地组网 + 三地出口切换"
date: 2026-09-23T20:00:00+08:00
draft: false
tags: ["VPN", "OpenVPN", "Shadowsocks", "组网", "透明代理", "iptables", "脚本"]
categories: ["技术笔记"]
summary: "用一台广州云服务器做 OpenVPN 枢纽，把佛山家里的机器、肇庆的主力机和随行的 ThinkPad 组进同一张网，并用一个 bash 脚本实现 local / home / gzhou 三地出口一键切换。"
---

我有三台机器散在三个地方：佛山家里的 `potatoserver`（家宽网关）、肇庆的主力机 PotatoPC、还有一台随我移动的 ThinkPad T480。需求很朴素：**让它们像在同一个局域网里一样互访**，并且**能按需选择从哪个地方出公网**——有时候想让流量从佛山家宽走，有时候想走广州机房。

方案是一台广州阿里云服务器做 OpenVPN 枢纽，加一个自己写的 bash 脚本 `homevpn` 管出口切换。这篇文章记录它的拓扑、原理、踩过的坑和运维方式。

## 一句话总览

`homevpn` 是设备接入**广州阿里云 OpenVPN 枢纽**后，用于**异地组网 + 出口切换**的 bash 脚本：

- **组网**：设备间互访 `10.xxx.xxx.0/24`，并可跨隧道访问佛山家里的 `192.xxx.xxx.0/24`（默认直连 potatoserver）
- **出口（egress）三选一**：
  - `local`：走本机所在宽带（肇庆移动 / 校园网等）
  - `home`：**佛山家宽透明代理**（本机 TCP → 隧道 → 家里 potatoserver 的 ss-server → 家宽出口）
  - `gzhou`：广州阿里云机房出口（经 `10.xxx.xxx.1` 服务器 NAT）
- **家网路径（path）**：`direct` = `10.xxx.xxx.2` 直连 potatoserver ／ `relay` = `10.xxx.xxx.1` 广州中继

> ⚠️ **homevpn 与 FlClash（代理客户端）毫无关系，勿混为一谈。** 但 FlClash 运行时其路由表会劫持 `10.xxx.xxx.x` / `192.xxx.xxx.x` 流量，用 homevpn 前请先关闭 FlClash（脚本有 `warn_clash` 检测提示）。

## 拓扑

```
                        广州阿里云 <公网 IP>
        OpenVPN hub 1145/udp · tls-crypt 纯证书 · tun0=10.xxx.xxx.1
        服务器 NAT: 10.xxx.xxx.0/24 → eth0（gzhou 出口在此）
                                 │
 ┌──────────────────────────────┼──────────────────────────────┐
 │                              │                              │
 potatoserver                 PotatoPC                       T480
 10.xxx.xxx.2                 10.xxx.xxx.3                   10.xxx.xxx.6
```

| 节点 | 隧道 IP | 所在地 / 角色 |
|---|---|---|
| `potatoserver` | `10.xxx.xxx.2` | 佛山家 · 家宽网关（局域网 `192.xxx.xxx.131`），跑 ss-server，是 home 出口的终点 |
| `PotatoPC` | `10.xxx.xxx.3` | 肇庆，主力机 |
| `T480` | `10.xxx.xxx.6` | 肇庆（随行），局域网 `192.xxx.xxx.43` |

- 隧道为 **hub-spoke 分流模式**：默认路由走本机宽带，只有 `10.xxx.xxx.0/24` + `192.xxx.xxx.0/24` 进隧道
- 家网路由双保险：客户端 conf 静态直连（metric 50）+ 服务器 push 中继（metric 100）

这个设计的关键取舍是**不做全局代理**。隧道只承载"设备之间"和"去家网"的流量，其余一概走本机宽带——所以 `homevpn on` 不会让你的网速变慢，只是多了一张内网。

## 组件清单

### 服务器（广州阿里云）

| 组件 | 说明 |
|---|---|
| `openvpn@server.service` + `iptables-openvpn.service` | OpenVPN 服务端，1145/udp，纯证书 + tls-crypt（easy-rsa），管理防火墙规则 |
| tun0=10.xxx.xxx.1/24 | 服务器为 hub；`ip_forward=1` |
| NAT masquerade | `10.xxx.xxx.0/24 → eth0`（gzhou 出口的 NAT 在此） |
| push 家网路由 | `route 192.xxx.xxx.0 255.255.255.0`（不带网关：2.x/3.x 客户端都认，走 10.xxx.xxx.1 中继） |
| 客户端档案 | `potato_pc_me=10.xxx.xxx.3`、`tpt480_me=10.xxx.xxx.6`、`phone_pkg110_me`、`phone_ace5_me`、`potato_server_home=10.xxx.xxx.2` 等 |

### potatoserver（佛山家，10.xxx.xxx.2 / 192.xxx.xxx.131）

| 组件 | 说明 |
|---|---|
| `shadowsocks-libev-server@homepipe` | ss-server 绑 `10.xxx.xxx.2:8388`，aes-256-gcm，**home 出口的服务端** |
| `/etc/shadowsocks-libev/homepipe.json` | 配置；drop-in `bind.conf` 用 `-s 10.xxx.xxx.2` 强绑 + `After=openvpn-client@potato_server_home`（等 tun0 就绪防回退绑定回环） |
| 权限坑 | 模板 `DynamicUser` 读不了 600 权限文件 → 配置改 644 |
| UFW | `allow in on tun0 to any port 8388 proto tcp`（只从隧道进，不对 LAN 暴露） |
| `/etc/ufw/before.rules` | `POSTROUTING -s 10.xxx.xxx.0/24 -o <家宽网卡> -j MASQUERADE`（出家宽） |
| dante SOCKS（手机备用） | `socks5://10.xxx.xxx.2:1080`（账号密码存 potatoserver 本地） |
| ss 密码源 | potatoserver 上一个 600 权限的文件，两端共享 |

### 客户端（PotatoPC / T480）

两台机器的客户端配置是同一套结构，逐项如下：

| 组件 | 说明 |
|---|---|
| OpenVPN 服务 | `openvpn-client@potato_pc_me`（PotatoPC）、`openvpn-client@potato_tpt480_me`（T480），均 enabled 开机自连 |
| 隧道 IP | PotatoPC `10.xxx.xxx.3`、T480 `10.xxx.xxx.6` |
| 客户端 conf | `/etc/openvpn/client/<档案名>.conf` + 同名 `.pw`（私钥密码文件） |
| conf 家网路由行 | `route 192.xxx.xxx.0 255.255.255.0 10.xxx.xxx.2 50` + `route-metric 100`（直连 metric 50 优先，push 中继 100 兜底） |
| homevpn 脚本 | `/usr/local/bin/homevpn`，唯一按机器改的是 `SVC=openvpn-client@<档案名>` 这一行 |
| ss-redir 配置 | `/etc/shadowsocks/homepipe.json`：`server 10.xxx.xxx.2:8388`、本地监听 `127.0.0.1:12345`、aes-256-gcm、`mode: tcp_only` |
| ss-redir 服务 | `shadowsocks-libev-redir@homepipe`（**开机不自启**，仅 home 模式拉起） |
| ss-redir 包 | AUR `shadowsocks-libev-static` 3.3.6-1（官方 shadowsocks-rust 无 redir 子命令才选它）。T480 上 `/usr/bin/ss-redir` 是**孤文件（无 pacman 包属主）**，从 PotatoPC 拷贝而来；如需重装用同一个 AUR 包 |
| 状态文件 | `/run/homevpn/{mode,localgw}` |

两机的脚本**除 `SVC` 行与注释头之外完全一致**，改动后要用 `diff` 核对。

## 命令语义

```
homevpn                    # 无参数 + 终端 → 进入交互菜单（1状态/2开/3关/4local/5home/6gzhou/7direct/8relay/0退出）
homevpn on | off | status  # 隧道开关 / 状态汇总
homevpn link local|home|gzhou   # 切出口
homevpn path direct|relay       # 切家网走向（现已冗余）
homevpn menu                    # 强制进入菜单
```

脚本常量（两机一致，仅 `SVC` 不同）：

| 变量 | 值 | 含义 |
|---|---|---|
| `SVC` | `openvpn-client@potato_pc_me` / `openvpn-client@potato_tpt480_me` | 隧道服务名 |
| `STATE` | `/run/homevpn` | 状态目录（重启即清） |
| `VPNIP` | 隧道外层对端 IP | 用于 `pin_transport` |
| `GW_HOME` / `GW_GZ` | `10.xxx.xxx.2` / `10.xxx.xxx.1` | 家宽网关 / 广州服务器 |
| `HOME_NET` / `HOME_HOST` | `192.xxx.xxx.0/24` / `192.xxx.xxx.131` | 家网段 / 家网探活设备 |
| `SS_SVC` / `SS_PORT` | `shadowsocks-libev-redir@homepipe` / `12345` | 透明代理客户端 |

关键行为：

- **启动检查**：脚本开头 `sudo -n true || sudo true`，需要 sudo 权限（无 tty 远程调用时用 `echo '<密码>' | sudo -S homevpn ...`）
- **`on`**：起隧道 → 等 tun0（≤15s）→ `pin_transport` → 按 `mode` 文件恢复上次出口（home=挂链+起 ss-redir；gzhou=加 tun0 默认路由）
- **`off`**：停隧道 → 清 HOMEVPN 链 + 停 ss-redir + 删 tun0 默认路由 → 恢复本机宽带 → mode=local
- **`pin_transport`**：把外层对端 IP 钉成 `via 本机网关 dev 本机网卡`（防止外层 UDP 1145 被隧道自己的路由吞掉造成回环）
- **状态文件** `/run/homevpn/mode`（local/home/gzhou）与 `localgw`（本机网关+网卡，如 `192.xxx.xxx.1 wlan0`）

`pin_transport` 是这套方案的隐形支柱。隧道的**内层**流量走 tun0，但隧道的**外层** UDP 包必须走本机物理网卡出公网。如果切了默认路由之后外层包也跟着进 tun0，就成了自己套自己的死循环。把对端 IP 钉一条 `/32` 主机路由，是最省事也最可靠的解法。

## 佛山透明代理原理（home 出口）★

这是整个方案里最精妙的一段：

```
应用 TCP 出站
  → iptables -t nat OUTPUT → HOMEVPN 链
      ├─ 目的在豁免段（见下）→ RETURN（直走原路由）
      └─ 其余 TCP → REDIRECT --to-ports 12345
  → ss-redir（127.0.0.1:12345）加密
  → 走 tun0 到 10.xxx.xxx.2:8388（目的在 10/8 豁免段，不会被二次 REDIRECT → 天然防环）
  → potatoserver 的 ss-server 解密
  → 走家宽出公网（出口 = 佛山电信）
```

- **HOMEVPN 链规则**（`iptables -t nat`）：豁免 `0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4` → 其余 `-p tcp -j REDIRECT --to-ports 12345`
- `OUTPUT` 挂链（`-C` 判重后 `-A`，幂等）
- **只覆盖 TCP**；UDP/DNS/ping 仍走本机（ss 配置 `mode: tcp_only`）
- 切回 `local` / `gzhou` / `off` 会清链 + 停 ss-redir，互不残留
- 回环防护双保险：① ss-redir 到 `10.xxx.xxx.2` 的目标在 `10/8` 豁免段；② `pin_transport` 保证外层 UDP 直连服务器

注意这里用的是 `nat` 表的 `REDIRECT` 目标——**这要求内核有完整的 NAT 支持**（`CONFIG_NF_NAT_REDIRECT=y`、`nf_nat`、`xt_nat` 等）。我就在这上面踩过坑：`link home` 命令执行成功、`iptables` 规则也挂上了，但流量纹丝不动——原因是 T480 那台机器的精简内核**误裁掉了 NAT 模块**。修正过程见[《ThinkPad T480 定制精简内核：按用途裁剪与一次 NAT 误裁修正》](/posts/t480-custom-kernel/)。

## 路由与 metric 拓扑

| 用途 | 路由 | metric | 备注 |
|---|---|---|---|
| 本机默认（DHCP） | `default via <本机网关> dev <网卡>` | 100 | 系统自动 |
| gzhou 出口 | `default via 10.xxx.xxx.1 dev tun0` | **50** | 2026-09-23 修复（原 200，赢不过 DHCP 100） |
| 恢复本机宽带 | `default via <本机网关> dev <网卡>` | 300 | 脚本添加（与 DHCP 100 并存，出口语义相同） |
| 家网直连 | `192.xxx.xxx.0/24 via 10.xxx.xxx.2 dev tun0` | 50 | 客户端 conf 静态，永远优先 |
| 家网中继（push） | `192.xxx.xxx.0/24 via 10.xxx.xxx.1 dev tun0` | 100 | 服务器 push 兜底 |

> **2026-09-23 修复记录**：`gzhou` 原用 metric 200，当主网卡 DHCP 默认路由为 metric 100 时会被压制，出口实际仍是本机宽带（T480 首次实测暴露；本机历史上在校园网 metric 300 环境碰巧成立）。已将两机脚本 `cmd_link gzhou` 与 `cmd_on` 的 tun0 默认路由改为 **metric 50**，压过一切常规 DHCP 默认路由。

这个 bug 很典型：**它在我的主力机上"看起来能用"，只是因为那台机器当时连的网络默认路由 metric 是 300。** 换了台机器、换了个网络，同样的代码就失效了。metric 这种东西，永远要压到比任何可能的 DHCP 值都小，而不是"比我现在这台机器上的值小"。

## 三出口实测（2026-09-23，肇庆 192.xxx.xxx.x 网络）

| 出口 | 路径 | 出口 IP | 两机验证 |
|---|---|---|---|
| `local` | 本机宽带直连 | `223.xxx.xxx.xxx`（肇庆移动） | 本机 ✓ T480 ✓ |
| `home` | TCP→10.xxx.xxx.2:8388→佛山家宽 | `119.xxx.xxx.xxx`（佛山电信，家宽动态 IP，9-13 时为 `119.xxx.xxx.xxx`） | 本机 ✓ T480 ✓ |
| `gzhou` | tun0→10.xxx.xxx.1→服务器 NAT | `8.xxx.xxx.xxx`（广州阿里云） | 本机 ✓ T480 ✓ |

验证方法是脚本内置的：`homevpn link <x>` 后自动 `curl -4 --noproxy '*' https://myip.ipip.net`；家网探活 `ping 192.xxx.xxx.131`（直连 36-43ms）。

注意 `--noproxy '*'`——如果不加这个，`curl` 会去读环境里的代理变量，测出来的就不是真实出口了。

## 部署到新设备清单

以 T480 为例：

1. 服务器签发证书 → 取 `.ovpn` → 装 openvpn → 放 `/etc/openvpn/client/<名>.conf` + `.pw` → 启用 `openvpn-client@<名>`
2. conf 末加 `route 192.xxx.xxx.0 255.255.255.0 10.xxx.xxx.2 50`（可选，直连优先）
3. 拷 `/usr/local/bin/homevpn` → 改 `SVC=openvpn-client@<名>`
4. 拷 `/etc/shadowsocks/homepipe.json` + 确保 `ss-redir` 与 `shadowsocks-libev-redir@.service` 就位（AUR `shadowsocks-libev-static`）
5. `homevpn on` → `link home/gzhou/local` 验证三出口

## 运维速查

```bash
# 状态一览（隧道/出口/家网/家网探活）
homevpn status

# 切佛山家宽出口（透明代理）
sudo homevpn link home
# 切回本机宽带
sudo homevpn link local
# 广州出口
sudo homevpn link gzhou

# 无 tty 远程执行（如从本机 ssh 到 T480）
ssh kb@192.xxx.xxx.43 "echo '<密码>' | sudo -S /usr/local/bin/homevpn link home"
```

### 故障排查

| 症状 | 检查 |
|---|---|
| 隧道起不来 | `journalctl -u openvpn-client@<名> -n 40`；确认 FlClash 已关；冷启动首次 TLS 超时后 2s 自动重连属正常 |
| `link home` 无效果 | `systemctl is-active shadowsocks-libev-redir@homepipe`；`sudo iptables -t nat -L HOMEVPN`；`ss-redir` 是否在跑；**内核 NAT 模块是否齐全** |
| `link gzhou` 出口还是本机 | `ip route show default` 看 tun0 默认路由 metric 是否 50 且最小 |
| 家网不通 | `ip route \| grep 192.xxx.xxx`（应 via 10.xxx.xxx.2 metric 50）；`ping 192.xxx.xxx.131` |
| 全部复原 | `homevpn off`（清链/停 ss-redir/恢复本机宽带/删 tun0 默认路由） |
| 远程 sudo 报无权限 | 加 `echo '<密码>' \| sudo -S` |

## 已知限制与注意事项

1. **`home` 出口只覆盖 TCP**（ss `tcp_only`）：UDP/DNS/ping 走本机；个别 UDP 应用无法走佛山
2. **`path direct/relay` 已冗余**：家网路由现由 openvpn 自管（直连 50 + 中继 100，默认直连优先）；`path` 命令只是临时覆盖，隧道重连后自动还原，保留仅为兼容
3. **FlClash 冲突**：FlClash 开着会劫持 `10.xxx.xxx.x` / `192.xxx.xxx.x` → 用 homevpn 前先关（脚本有警告提示）
4. **T480 的 ss-redir 为孤文件**（无包属主）：Pacman 不管它，系统清理时可能被误删；重装用 AUR `shadowsocks-libev-static`，或直接从 PotatoPC 重拷 `/usr/bin/ss-redir`
5. **家宽出口 IP 是动态的**：佛山电信 IP 会轮换（`119.xxx.xxx.xxx`），验证出口以 `curl myip.ipip.net` 实际值为准
6. **两机脚本必须保持同步**（除 `SVC` 行）；改动后用 `diff` 核对
7. **NAT 依赖**：`link home` 需要内核有完整 NAT 支持（`nf_nat` / `xt_nat` / `NF_NAT_REDIRECT`），换内核后务必回归测试

> 📌 **关于凭据**：本文已隐去所有密码、私钥口令、ss 共享密钥与公网 IP 的完整值（仅保留网段与特征）。运维时请以本机保存的原始白皮书为准。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-13 | 方案建立：OpenVPN 组网 + ss 透明代理（DSCP 方案废弃改 ss-redir）+ homevpn 脚本（菜单/三出口/path）+ 服务器 push 家网路由 |
| 2026-09-23 | T480 部署 homevpn（SVC 适配 `potato_tpt480_me`，其余原样）；**gzhou metric 200→50 修复**（两机同步）；两机三出口实测全绿 |

## 结语

回头看，这套方案真正的价值不在"能翻墙"或者"能组网"，而在于**它把三台分散在三个城市的机器，变成了一个可以自由决定出口的私有网络**——而且切换成本是一条命令。

代价是它踩在系统底层上：`iptables` 的 nat 表、路由 metric 的优先级、内核的 NAT 模块、OpenVPN 的外层路由防环。每一层出问题，症状都是同一句话——"命令成功了，但没效果"。所以这类方案的运维文档比代码更重要，这也是我把每一个坑都写下来的原因。
