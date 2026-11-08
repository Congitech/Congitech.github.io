---
title: "SYC · 阿基里斯追乌龟 题解：JSON 非数值与浮点比较绕过"
date: 2026-11-08
pinned: false
description: "Web 接口逆向 + JSON 非标准字面量（Infinity / 溢出）+ 浮点比较缺陷"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-12-qwen.jpg
---

# SYC · 阿基里斯追乌龟 —— Writeup（JSON 非数值与浮点比较绕过）

| 项目 | 内容 |
| ---------- | -------------------------------------------------------------------- |
| 题名 | 阿基里斯追乌龟（芝诺悖论） |
| 靶场地址 | http://8080-8103e2bc-9125-418b-a8e4-96a8da214309.challenge.ctfplus.cn/ |
| 题型 | Web 接口逆向 + JSON 非标准字面量（Infinity / 溢出）+ 浮点比较缺陷 |
| 环境 | Werkzeug/3.1.3，Python/3.11.14，Flask 单体应用 |
| 接口 | `POST /chase`（唯一业务接口，仅接受 POST 与 OPTIONS） |
| 最终 payload | `{"data": base64({"achilles_distance":1e999,"tortoise_distance":0})}` |
| Flag | `SYC{Spi1t_th3_T1me_t0_the_3nd_LMAO}` |
| 解题日期 | 2026-11-07 |

---

## 一、题目形态

首页是一个芝诺悖论的演示页：一个「追赶」按钮、两个距离显示、一张 gif。除此之外**只有一个接口**。

```
GET /              → 静态页面
GET /static/*      → index.js / style.css / 222.gif
POST /chase        → 业务接口
```

探测隐藏路由（`/flag`、`/source`、`/app.py`、`/.git/HEAD` 等）全部 404，说明解题点只能在这一个接口上。

## 二、为什么是 POST

三条证据，不靠猜：

| 证据 | 内容 |
| --- | --- |
| 前端源码 | `static/index.js` 里 `fetch('/chase', { method: 'POST', ... })` |
| 直接访问 | `GET /chase` 返回 **405**，响应头带 `Allow: POST, OPTIONS` |
| 方法探测 | `OPTIONS /chase` 返回 200，同样带 `Allow: POST, OPTIONS` |

**通用手法**：想快速知道某个接口接受什么方法，发一个 `OPTIONS`，看 `Allow` 响应头；或者故意用错方法，405 页面也会把它告诉你。

服务端用 POST 的设计原因：

| 原因 | 说明 |
| --- | --- |
| 语义 | 提交一次「动作」，服务端依据提交的数据做判定，不是读取资源 |
| 藏参数 | JSON 塞进 body 并 base64，制造「加密」的错觉；GET 会把 payload 全暴露在 URL |
| 长度 | base64 膨胀 4/3，GET 的 URL 长度有限制 |

## 三、协议拆解：base64 不是加密

请求与响应是对称的：

```
请求   {"data": base64( {"achilles_distance":x, "tortoise_distance":y} )}
响应   {"data": base64( {"flag":...} 或 {"message":...} )}
```

抓一次真实请求并解码：

```json
{"achilles_distance": 0, "tortoise_distance": 10000000000}
```

**第一个关键发现**：页面 HTML 里写的是「乌龟在 100 米处」，而实际参数是 `10000000000`（1e10）。页面展示是装饰性的，判定只看接口参数——从这里开始不要相信页面。

前端逻辑（`index.js`）：

```js
let achillesPos = 0;
let tortoisePos = 10000000000;          // 实际初始距离

const achillesMoveDistance = tortoisePos - achillesPos;   // 阿基里斯瞬移到乌龟位置
achillesPos = tortoisePos;
tortoisePos += achillesMoveDistance / 10;                 // 乌龟再走 1/10
```

## 四、正常路径只会拿到假 flag

`1e10 / 10^k` 递减，约 60 次后浮点数加法不再改变 `tortoisePos`（精度归零），两个数变成**完全相等**，触发「追上」分支。但它给的是：

```
哦天哪，可恶的浮点数问题，居然真的让你追到了。
然而这并不是预期的解法，阿基里斯可以跑得更快对吗？
SYC{this_is_fake_flag}
```

这段文字直接把答案说了一半：

| 原文 | 读出来的信息 |
| --- | --- |
| 「可恶的浮点数问题」 | `a == t` 是靠精度归零凑出来的，不是真追上 |
| 「并不是预期的解法」 | 相等分支是出题人埋的诱饵 |
| 「可以跑得更快对吗」 | 真正的条件是比较方向：`a` 要 **大于** `t` |

## 五、服务端判定分支（实测刻画）

| achilles | tortoise | 返回 |
| --- | --- | --- |
| 1e10 | 1e10（相等） | 假 flag |
| 1e10 + 1 | 1e10（大 1） | 真 flag |
| 2e10 | 1e10 | 真 flag |
| Infinity | -Infinity | 真 flag |
| 1e999 | 0 | 真 flag |
| NaN | 任意 | message（没追上） |
| -Infinity | Infinity | message（没追上） |

反推的逻辑：

```python
if a > t:
    return real_flag
if a == t:
    return fake_flag          # 浮点追平的诱饵分支
return {"message": "Achilles has not caught up ..."}
```

注意 `NaN` 落在 message 分支，因为 `NaN` 与任何值比较**恒为 False**，两个 if 都进不去。

## 六、真解推导链（四步）

**第 1 步：从假 flag 的话里读出 `a > t`**

「跑得更快」= 严格大于。理论上 `10000000001` 就够了。

**第 2 步：为什么还要往上加码**

写 payload 时并不知道判定写的是 `>` 还是 `>=`，也不知道有没有额外校验（数值上限、必须有限、必须合理）。用「刚好大 1」等于赌实现细节。

**第 3 步：找一个在所有比较语义下都成立的值**

| 值 | 与有限数比较 | 与自身比较 | 能否过 `a > t` |
| --- | --- | --- | --- |
| 大有限数 1e308 | 正常 | 相等 | 能，但受上限/精度影响 |
| NaN | 恒 False | 恒 False | 不能 |
| Infinity | 恒 True | True | 能，不受任何阈值影响 |

`NaN` 是陷阱：它比较恒 False，反而掉进「没追上」分支。所以要选 `Infinity`（或用溢出造出来的 inf）。

**第 4 步：乌龟压到 -Infinity 是冗余保险**

`a > t` 有两个变量，把 `t` 压到负无穷是双保险，还贴合 flag 的梗（Split the Time to the End，时间倒流）。严格说 `t` 取什么都不影响结果。

## 七、`Infinity` 的各种等价写法（实测）

Python 的 `json` 解码器只给**三个固定单词**开了后门，大小写敏感：

| 写法 | json.loads 结果 | 靶场结果 |
| --- | --- | --- |
| Infinity | float inf | 真 flag |
| -Infinity | float -inf | 真 flag |
| NaN | float nan | message |
| inf / Inf / INFINITY | JSONDecodeError | **HTTP 400** |
| "Infinity"（带引号） | 字符串 | **HTTP 500** |
| 1e999 / 1e309 / 1E400 | float inf（**溢出**） | 真 flag |
| true | bool True（即整数 1） | 真 flag |
| 超长整数 | Python 任意精度 int | 真 flag |

三条要点：

1. `inf`、`Inf`、`INFINITY` 都不行。json 不是调用 `float()` 解析标识符，而是走一张常量表精确匹配，匹配不上直接报错，请求根本没进业务逻辑。
2. **`1e999` 是标准 JSON**，语法合法，任何解析器都会接受，Python 内部转 float 时溢出成 inf。它比 `Infinity` 更好：不依赖语言扩展、不触发关键词 WAF，Java/Go 的严格解析器也照样中招。
3. `true` 是最容易被忽略的：Python 里 bool 是 int 的子类，`True > 0` 成立，于是「必须是数字」的校验直接穿了。

本地验证（无需靶场）：

```python
import json
for t in ['Infinity','inf','INFINITY','1e999','"Infinity"','true']:
    try:    print(t, '->', repr(json.loads('{"a": %s}' % t)['a']))
    except Exception as e: print(t, '-> ERROR', e)
```

## 八、完整操作步骤（Burp）

### 步骤 1：抓真实请求

浏览器 F12 → Network → 点「追赶」→ 找到 `POST /chase` → 右键 Send to Repeater。

```http
POST /chase HTTP/1.1
Host: 8080-8103e2bc-9125-418b-a8e4-96a8da214309.challenge.ctfplus.cn
Content-Type: application/json

{"data":"eyJhY2hpbGxlc19kaXN0YW5jZSI6MCwidG9ydG9pc2VfZGlzdGFuY2UiOjEwMDAwMDAwMDAwfQ=="}
```

### 步骤 2：解码 data

复制 `data` 的值 → Burp **Decoder** → Base64 decode：

```json
{"achilles_distance": 0, "tortoise_distance": 10000000000}
```

（新版 Burp 的 Inspector 右侧面板也会自动显示解码结果，但要注意它只是查看器，改内容后需要手动「应用更改」。）

### 步骤 3：先 Send 一次建基线

不改任何东西直接发，解码响应应得到：

```json
{"message": "Achilles has not caught up with the tortoise yet."}
```

这一步证明通道通了、参数确实被读取。基线不对就先别往下走。

### 步骤 4：验证方法限制

Repeater 里 `Ctrl+M` 切换成 GET 发送 → 405，`Allow: POST, OPTIONS`。坐实方法限制。

### 步骤 5：构造新明文并编码

在 Decoder 里输入（推荐用标准 JSON 的溢出写法）：

```json
{"achilles_distance": 1e999, "tortoise_distance": 0}
```

Encode as Base64 得到：

```
eyJhY2hpbGxlc19kaXN0YW5jZSI6IDFlOTk5LCAidG9ydG9pc2VfZGlzdGFuY2UiOiAwfQ==
```

备用写法（非标准常量版）：

```json
{"achilles_distance": Infinity, "tortoise_distance": -Infinity}
```

```
eyJhY2hpbGxlc19kaXN0YW5jZSI6IEluZmluaXR5LCAidG9ydG9pc2VfZGlzdGFuY2UiOiAtSW5maW5pdHl9
```

### 步骤 6：替换 body 并 Send

只替换 `"data":"` 与 `"` 之间的内容，外层双引号和花括号不动：

```http
{"data":"eyJhY2hpbGxlc19kaXN0YW5jZSI6IDFlOTk5LCAidG9ydG9pc2VfZGlzdGFuY2UiOiAwfQ=="}
```

`Content-Length` 由 Burp 自动重算；若报 400 再检查它是否与新 body 长度一致。

### 步骤 7：解响应

响应仍是 `{"data":"..."}`，Decoder 选 Base64 decode：

```json
{"flag": "SYC{Spi1t_th3_T1me_t0_the_3nd_LMAO}"}
```

## 九、五个坑

| # | 现象 | 原因 |
| --- | --- | --- |
| 1 | 直接点按钮怎么点都只有假 flag | 那是浮点追平的诱饵分支，不是解法 |
| 2 | 照页面显示的 `100` 构造 payload | 页面是装饰，实际初始距离是 1e10 |
| 3 | 写 `inf` / `INFINITY` → 400 | json 常量表只认真实拼写 `Infinity`，大小写敏感 |
| 4 | 给 `Infinity` 加引号 → 500 | 变成字符串，比较时类型错误 |
| 5 | 用 `NaN` 想「特殊绕过」 | NaN 比较恒 False，反而进不了任何命中分支 |

## 十、可复用的方法论

**① 拿到题目先分离三件事**：页面展示、前端逻辑、后端接口。本题三者互相矛盾（页面 100、代码 1e10、判定看接口），先对齐它们再动手。

**② 判断接口方法**：`OPTIONS` 看 `Allow`，或故意用错方法看 405。

**③ 「输入必须是数字」的校验，按成本从低到高试**：

| 顺序 | 试什么 | 目的 |
| --- | --- | --- |
| 1 | true / false | 类型混淆，Python 里 bool 就是 int |
| 2 | 1e999 | 标准 JSON 的溢出，最不容易被拦 |
| 3 | Infinity / -Infinity | Python/JS 系后门常量 |
| 4 | NaN | 让所有比较失效 |
| 5 | 超长整数、负数、0 | 精度与边界 |
| 6 | "123" 字符串 | 触发类型错误，看报错细节 |

**④ 记住「标准内」与「标准外」的分界**：`1e999` 是标准 JSON，`Infinity` 是语言扩展。WAF 和严格解析器通常只堵后者，前者反而长期存活。

## 十一、汇总表

| 项目 | 内容 |
| --- | --- |
| 接口 | `POST /chase`，Content-Type application/json，仅 POST 与 OPTIONS |
| 协议 | 请求与响应都是 `{"data": base64(json)}`，base64 不是加密 |
| 前端假象 | 页面显示乌龟 100，实际参数 1e10 |
| 正常玩法 | 点约 60 次 → 浮点精度归零 → 相等 → 假 flag |
| 诱饵提示 | 「可恶的浮点数问题」「可以跑得更快对吗」 |
| 真判定 | `a > t` 真 flag；`a == t` 假 flag；`a < t` 或 NaN → 提示 |
| 最小解 | achilles 比 tortoise 大 1 即可 |
| 最优解 | `1e999`（标准 JSON 溢出成 inf，最不易被拦） |
| 备用解 | `Infinity` 与 `-Infinity`（非标准常量） |
| 无效写法 | inf、Inf、INFINITY（400）、"Infinity"（500）、NaN（message） |
| 修复视角 | json 解析加 allow_nan=False；判定前用 math.isfinite 校验；浮点比较用容差 |
| Flag | `SYC{Spi1t_th3_T1me_t0_the_3nd_LMAO}` |

**一句话总结**：出题人想考「浮点精度追平」是错的，真正的口子在于——**JSON 里的数字不只有有限值，`1e999` 会溢出成无穷，而无穷在任何比较里都必胜。**
