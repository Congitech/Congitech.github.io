---
title: "0XGame HTTP God 题解：HTTP 协议链题"
date: 2026-10-27
pinned: false
description: "0XGame HTTP God 通关记录：一道叠加式 HTTP 协议链题，逐层满足 GET/POST 参数、Cookie、User-Agent、Referer、Via 头共 6 个条件拿到 flag，附每步 payload 原理。"
tags: [ctf, web, WriteUp]
cover: /hero/bg-06-glm.jpg
categories: [web]
draft: false
---

# 0XGame HTTP God —— HTTP 协议链题 Writeup

> 题目来源：CTFplus / 0XGame 练习场
> 题目地址：`http://80-452fadd2-90a2-4abf-a84d-af5d4e954780.challenge.ctfplus.cn/`
> Flag：`0XGame{Congratuation_You_Are_Http_God!!!}`
> 工具：Burp Suite Repeater（或 HackBar / curl 均可）

---

## 一、题目信息

页面标题直接点题：**“Yakit && BurpSuite && HackBar 你自己选一个玩吧”**，本质是一道 **HTTP 协议基础链题**。

服务器用 PHP 逐条检查请求是否满足某个条件，**每一步都要保留前面所有条件（叠加式）**。满足条件就给下一句提示，全部满足后返回 flag。

完整条件链：

1. GET 传 `hello=web`
2. POST 传 `http=good`
3. Cookie 设 `Sean=god`
4. User-Agent 等于 `Safari`
5. Referer 为 `www.mihoyo.com`
6. Via 头含 `clash`（小写）

---

## 二、解题步骤（逐步 + payload 原理）

### Step 1 — GET 传递 `hello=web`

最原始的首页就提示：`用GET传递 hello=web`。

```
GET /?hello=web HTTP/1.1
Host: 80-452fadd2-90a2-4abf-a84d-af5d4e954780.challenge.ctfplus.cn
```

- 原理：GET 参数在 **URL 查询串**（`?key=value`），附加在路径后。
- 响应变为：`用POST传递 http=good` → 进入第 2 步。

---

### Step 2 — POST 传递 `http=good`

```
POST /?hello=web HTTP/1.1
Host: 80-452fadd2-90a2-4abf-a84d-af5d4e954780.challenge.ctfplus.cn
Content-Type: application/x-www-form-urlencoded
Content-Length: 9

http=good
```

要点 / 踩坑：

- POST 数据必须放在**请求体（body）**，不能写进 URL（写进 URL 只算 GET 参数，服务端 `$_POST` 读不到）。
- `Content-Type` 必须是 `application/x-www-form-urlencoded`，和 HTML 表单一致。
- `Content-Length: 9` 必须等于 body 字节数（`http=good` 正好 9 字节），否则服务端读到一半/读不到。
- **最关键的一个 typo**：body 写成 `hyyp=good`（两个 y），服务端要的是 `http`，参数名对不上 → 一直卡在“用POST传递 http=good”。改成 `http=good` 即通过。
- 响应变为：`设置cookie Sean=god` → 进入第 3 步。

---

### Step 3 — Cookie `Sean=god`

在 Step 2 成功请求基础上，**header 区新增一行**：

```
Cookie: Sean=god
```

- 原理：Cookie 是一个请求头，格式 `Cookie: name=value`。它放在 header 区，**不改 body，也不改 Content-Length**。
- 服务端用 `$_COOKIE['Sean']` 读取。
- 响应变为：`请使用Safari浏览器访问` → 进入第 4 步。

---

### Step 4 — User-Agent 等于 `Safari`

```
User-Agent: Safari
```

要点 / 踩坑：

- User-Agent 也是请求头，标识客户端类型/版本。
- **去重陷阱**：Burp 默认会带 `User-Agent: Mozilla/5.0 ... Chrome/...`，如果你只在末尾“追加”一行 `User-Agent: Safari`，请求里就出现两个 UA 头。服务端通常读第一个（仍是 Chrome），于是判定失败。
- 正确做法：**覆盖/删除**原 UA 头，整条请求只留 `User-Agent: Safari`（严格等于，不要带版本号）。
- 响应变为：`请从www.mihoyo.com访问本页面...` → 进入第 5 步。

---

### Step 5 — Referer `www.mihoyo.com`

```
Referer: www.mihoyo.com
```

- 原理：Referer 表示“当前请求是从哪个页面跳转过来的”，服务端用 `$_SERVER['HTTP_REFERER']` 读取。
- 冷知识：Referer 本身就是 HTTP 早期的一个**拼写错误**（正确英文是 referrer），这个错误沿用至今，写代码/手工构造时别写错。
- 响应变为：`请使用clash这只猫猫来代理一下` → 进入第 6 步。

---

### Step 6 — Via 头含 `clash`（小写）

```
Via: clash
```

要点 / 踩坑：

- Via 是 HTTP 中表示**请求经过的代理/网关**的跳板头，格式通常是 `Via: 代理标识`。
- 这步“用 clash 代理”的提示，就是让你把请求伪装成经过 Clash 代理转发。
- **大小写敏感**：实测 `Via: Clash`（大写 C）会被 `403 Forbidden` 拒绝，只有 `Via: clash`（小写）才能过。说明服务端做的是大小写敏感的子串匹配。
- 响应直接返回 flag：`0XGame{Congratuation_You_Are_Http_God!!!}`

---

## 三、最终完整请求（Burp Raw）

```http
POST /?hello=web HTTP/1.1
Host: 80-452fadd2-90a2-4abf-a84d-af5d4e954780.challenge.ctfplus.cn
Content-Type: application/x-www-form-urlencoded
Content-Length: 9
Cookie: Sean=god
User-Agent: Safari
Referer: www.mihoyo.com
Via: clash

http=good
```

---

## 四、知识点讲解（考点提炼）

### 1. HTTP 请求报文结构

```
<方法> <路径+查询串> HTTP/1.1        ← 请求行
Host: ...                            ← 请求头（多行）
Content-Type: ...
Cookie: ...
                                    ← 空行（必须有，分隔头与体）
<http=good>                         ← 请求体（仅 POST/PUT 等有）
```

每一步的条件，本质上就是在 **请求行 / 请求头 / 请求体** 这三个位置里“放对东西”。

### 2. GET vs POST

| 维度 | GET | POST |
|---|---|---|
| 参数位置 | URL 查询串 `?a=1` | 请求体 body |
| 可见性 | 明文出现在地址栏/日志 | 在 body 中，相对不暴露 |
| 长度限制 | 受 URL 长度限制 | 无实质限制 |
| 服务端读取(PHP) | `$_GET` | `$_POST` |
| 典型 Content-Type | 无 | `application/x-www-form-urlencoded` |

本题用“先 GET 后 POST”把这两个位置都考了一遍。

### 3. Content-Length 与 Content-Type

- `Content-Length` = body 的**字节数**，必须与 body 实际长度一致，否则服务端读取异常。
- `Content-Type: application/x-www-form-urlencoded` 是表单默认编码，告诉服务端“body 是 `key=value&...` 格式”。

### 4. 常见请求头

- `Cookie`：客户端状态，服务端识别会话。
- `User-Agent`：客户端标识，常用来做“客户端类型判断”。
- `Referer`：来源页面（拼写是历史遗留错误）。
- `Via`：代理/网关跳板标识，体现请求经过的代理链。

### 5. 叠加式校验 + 重复头的坑

- 本题是**所有条件叠加**，每一新步都要在上一成功请求上“加头”，不能只发当前条件。
- 手工加 header 时容易**重复同名头**（尤其是 UA）。普通浏览器/Burp 默认 UA 已存在，追加等于写了两份，服务端按规则（通常取第一个）读取，导致你的“覆盖”失效。正确做法是**先删后加**。

---

## 五、汇总表格

| 步骤 | 条件 | 放入位置 | 关键注意点 | 通过后响应 |
|---|---|---|---|---|
| 1 | `hello=web` | URL 查询串（GET） | GET 参数在 `?` 后 | 用POST传递 http=good |
| 2 | `http=good` | 请求体 body（POST） | 必须放 body 而非 URL；`Content-Type` 正确；`Content-Length` 匹配；**参数名别拼错（hyyp→http）** | 设置cookie Sean=god |
| 3 | `Sean=god` | header `Cookie:` | 加在 header 区，body/长度不变 | 请使用Safari浏览器访问 |
| 4 | `Safari` | header `User-Agent:` | **删除原 UA 再设**，严格等于 `Safari` | 请从www.mihoyo.com访问本页面 |
| 5 | `www.mihoyo.com` | header `Referer:` | 注意拼写是 Referer（非 referrer） | 请使用clash这只猫猫来代理一下 |
| 6 | `clash` | header `Via:` | **小写** `Via: clash`，大写 `Clash` 触发 403 | flag：`0XGame{Congratuation_You_Are_Http_God!!!}` |

**Flag：`0XGame{Congratuation_You_Are_Http_God!!!}`**
