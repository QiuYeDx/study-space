# 从业务到表结构：数据建模与 MySQL 表设计实战

> 目标：拿到一个业务需求，能**自己推导**出实体、关系和表结构；AI 给出一份设计时，能**说出它哪里对、哪里不对、为什么**。
> 读法：先看第 1 节的方法，再跟着第 2–8 节把一个真实业务从需求一路落到建表语句；第 9–12 节是专题和常见错误；最后两节是**判断清单**和**问 AI 的模板**，以后每次做设计都拿出来对照。
> 前置：[01 前端视角的 Java 后端 + 数据库概念指南](01-java-backend-concepts-guide.md) 的第 5 节（索引、锁）。本文默认 MySQL 8.0 + InnoDB。

## 为什么建模这么难，而且 AI 帮不上大忙

前端写代码时，数据结构错了改起来很便宜：改个 TS 类型，编译器把所有报错位置指给你，刷新页面就重来。

表结构不一样：

- **数据会活得比代码久**。代码可以重写，线上表里已经躺着几百万行按旧结构存的数据，改结构就要迁移数据。
- **错误不会立刻报错**。设计错的表照样能 insert、能 select，问题往往在半年后某个新需求、某张报表、某次并发高峰才暴露。
- **对错取决于业务，而不是语法**。AI 生成的 DDL 几乎永远"能跑"，但"订单里要不要存商品名""卡能不能转让"这种问题，答案在业务里，不在 SQL 里。AI 不知道你的业务，只能按"最常见的情况"猜。

所以本文的重点不是 SQL 语法，而是一套**从业务推导模型的思考步骤**，以及**用业务场景反过来验证模型**的方法。你会发现，前端出身反而有优势：你天然是从页面和交互出发思考的，而页面就是查询。

---

## 1. 方法：从业务到表的七步

```
① 收集场景：用户故事 + 页面清单 + 报表/统计需求
② 圈名词、找动词 → 候选实体和事件
③ 判断每个名词：是实体、属性，还是一个值？
④ 定关系与基数：1:1 / 1:N / N:M（双向提问法）
⑤ 识别三类"特殊信息"：模板 vs 实例、当前状态 vs 流水、快照
⑥ 落表：字段、类型、约束、索引（索引由查询驱动）
⑦ 用场景走查验证：每个页面写得出 SQL 吗？时间流逝后数据还对吗？
```

**前端类比**：这很像你做一个复杂页面前先设计 TS 类型和全局 store 的形状。区别在于：store 只需要满足"当前页面"，表要满足"所有页面、所有历史时刻、所有并发情况"。

几个判断工具先放在这里，后面会反复用到：

| 问题 | 用来判断什么 |
|---|---|
| 它有没有自己的"身份"（需要单独被引用、被修改、被删除）？ | 实体还是属性 |
| 它有没有自己的生命周期（会被创建、变状态、结束）？ | 实体还是属性 |
| 一个 A 能对应几个 B？一个 B 能对应几个 A？ | 关系基数 |
| 这个值将来会变吗？变了以后，过去的记录应该显示旧值还是新值？ | 要不要存快照 |
| 我需要知道"它是怎么变成现在这样的"吗？ | 要不要记流水 |
| 哪个页面、哪个接口会按什么条件查它？ | 建什么索引 |

---

## 2. 案例：瑜伽馆约课小程序

假设你接了一个客户需求（这是很典型的外包/独立交付项目），客户是一家瑜伽馆，原话大概是：

> 我们想做个小程序。会员用手机号登录，可以在线买会员卡，有次卡（比如 10 次卡）和期限卡（比如月卡）。我们每周排课，每节课有固定教练和人数上限，会员在小程序上约课，开课前 2 小时可以取消，取消了次数退回去。来上课要签到，没来的算缺席。后台要能看每节课谁约了、每张卡还剩几次、每个月卖了多少钱。

### 2.1 第①步：把需求拆成场景

先别想表，先把"谁在什么页面做什么"列出来。这一步你最熟：

**会员端（小程序）**
1. 手机号登录 / 注册，完善资料（昵称、头像、身体情况备注、紧急联系人）
2. 浏览可购买的卡（名称、价格、次数或天数）→ 下单 → 微信支付
3. 查看"我的卡"：剩余次数、有效期；查看某张卡的使用记录
4. 浏览本周课表（日期、时间、课程名、教练、剩余名额）
5. 约课（选一张可用的卡扣次）、取消约课（开课前 2 小时之前）
6. 查看"我的预约"

**后台（馆主 / 前台）**
7. 管理教练、课程（流瑜伽、阴瑜伽……）、可售卡种
8. 排课：某天某时间某教练上某课，人数上限多少
9. 查看某节课的预约名单、给会员签到
10. 给会员手动调整卡次数（补偿、纠错），要留记录
11. 报表：每月销售额、每节课到课率、每个教练上了多少节课

**隐含的规则**（需求里没写明，但做设计时必须追问客户）：
- 同一个会员能不能重复约同一节课？（通常不能）
- 卡过期了还没用完的次数怎么办？（通常作废）
- 课程改价了，已经卖出去的卡受影响吗？（不受影响）
- 教练离职了，历史课表要能看到他吗？（要）
- 一张卡能不能给家人用？（先假设不能，第 12 节讨论如果后来可以怎么办）

> **独立接需求时最重要的一个习惯**：把这些"隐含规则"写成问题清单发给客户确认。模型设计的大部分返工，都来自当初没问的问题。

### 2.2 第②步：圈名词、找动词

把上面的场景里的名词圈出来：

> 会员、手机号、昵称、头像、资料、紧急联系人、**卡**、次卡、期限卡、价格、次数、有效期、**订单**、**支付**、**课程**、**教练**、**课表 / 某节课**、人数上限、名额、**预约**、签到、缺席、**使用记录**、调整记录、销售额、到课率……

动词：登录、购买、支付、排课、约课、取消、签到、扣次、退次、调整。

**动词非常重要**：很多动词背后是一个"事件"，事件本身经常需要一张表。"约课"产生**预约**，"购买"产生**订单**，"支付"产生**支付记录**，"扣次/退次/调整"产生**次数流水**。

### 2.3 第③步：实体、属性，还是值？

| 名词 | 判断 | 理由 |
|---|---|---|
| 会员 | 实体 | 有身份，被订单、预约、卡引用 |
| 手机号、昵称、头像 | 会员的属性 | 没有独立身份，跟着会员走 |
| 身体情况、紧急联系人 | 会员的属性，但可能单独放 | 低频、敏感，见 1:1 的讨论 |
| 教练 | 实体 | 被排课引用，有自己的生命周期（入职、离职） |
| 课程（流瑜伽） | 实体 | 被排课引用，有自己的介绍、时长 |
| 某节课（周三 19:00 流瑜伽） | 实体 | 被预约引用，有自己的状态（正常、取消） |
| 卡种（10 次卡，¥1200） | 实体 | 可售商品，被订单引用 |
| 会员手里的某张卡 | 实体 | 有剩余次数、有效期，被预约扣次 |
| 订单、支付 | 实体（事件） | 有状态、有生命周期 |
| 预约 | 实体（事件） | 有状态（已约、取消、签到、缺席） |
| 次数变化记录 | 实体（流水） | 每一笔都要能追溯 |
| 剩余名额 | **不是**独立的东西 | 是"人数上限 − 已约人数"，可算出来（第 9 节讨论要不要存） |
| 销售额、到课率 | **不是**实体 | 是从订单、预约**统计**出来的，不用建表（量大以后可能做汇总表） |

**常见误区**：看到需求里的每个名词都建一张表（"销售额表""到课率表"）。能从现有数据算出来的东西，默认不存。

### 2.4 第⑤步先行：三类特殊信息

在画关系之前，先讲这个案例里最关键、也是新手最容易漏的三种模式。AI 漏掉它们的概率也非常高。

#### 模板 vs 实例

**"卡种"和"会员手里的卡"是两个东西**；**"课程"和"某节课"也是两个东西**。

**前端类比**：组件定义 vs 组件实例，`class` vs `new` 出来的对象。`<Button>` 只定义一次，页面上可以有一百个 Button 实例，每个实例有自己的 state。

| 模板（定义） | 实例 | 实例上独有的东西 |
|---|---|---|
| 卡种 `card_template`：10 次卡，¥1200，有效 180 天 | 会员卡 `member_card`：张三在 3 月 1 日买的那张 | 剩余次数、开始/结束日期、状态 |
| 课程 `course`：流瑜伽，60 分钟 | 排课 `class_session`：3 月 5 日 19:00 那节 | 具体时间、教练、人数上限、已约人数 |

如果把它们混成一张表（比如在"卡种"上存"剩余次数"），立刻就会发现：剩余次数是谁的？

#### 当前状态 vs 流水

"这张卡还剩 7 次"是**当前状态**；"3 月 5 日约课扣 1 次、3 月 6 日取消退回 1 次、3 月 8 日前台补偿加 1 次"是**流水**。

**前端类比**：React 的 state vs Redux DevTools 里的 action 日志。只存 state，你知道现在是什么样；有了 action 日志，你才能回答"怎么变成这样的"，以及在 state 算错时**对账、修复**。

凡是涉及**钱、次数、积分、库存**这类"可增可减、会被质疑"的数值，几乎都要：
- 一个字段存当前值（查起来快，可以做并发控制）
- 一张流水表记录每次变化（可追溯、可对账）
- 两者在**同一个事务**里更新

#### 快照

会员 3 月买了"10 次卡 ¥1200"，4 月馆主把这个卡种改名为"10 次畅享卡"、改价 ¥1500。会员的订单详情里应该显示什么？

当然是**买的时候的名称和价格**。所以订单上要存 `item_name`、`price` 这些字段的**快照**，而不是只存 `card_template_id` 然后 JOIN 查当前值。

> **快照不是冗余**。冗余是"同一个事实存了两份"；快照是**另一个事实**："下单那一刻，商品叫这个名字、是这个价格"。它本来就该存。判断标准就是上面那个问题：**这个值将来会变吗？变了以后，过去的记录应该显示旧值还是新值？** 答"旧值"，就存快照。

---

## 3. 关系与基数：1:1、1:N、N:M

### 3.1 双向提问法

判断两个实体的关系，**正反各问一次**：

> 一个**会员**可以有几张**会员卡**？→ 多张
> 一张**会员卡**属于几个**会员**？→ 一个
> 结论：会员 1 : N 会员卡

> 一个**会员**可以约几节**课**？→ 多节
> 一节**课**可以被几个**会员**约？→ 多个
> 结论：会员 N : M 排课 → 需要中间表，这里就是"预约"

只问一个方向是最常见的错误来源。

### 3.2 本案例的关系图

每一行是一条关系，`1 ──< N` 读作"一个左边对应多个右边"，外键字段放在右边（"多"的一方）：

```
member         1 ──── 1  member_profile
member         1 ──<  N  member_card
card_template  1 ──<  N  member_card
member_card    1 ──<  N  card_ledger
member         1 ──<  N  booking        ┐ member N:M class_session，
class_session  1 ──<  N  booking        ┘ 经由 booking（带属性）
member_card    1 ──<  N  booking
course         1 ──<  N  class_session
coach          1 ──<  N  class_session
coach          N >──< M  course           经由 coach_course（纯关联）
member         1 ──<  N  trade_order
trade_order    1 ──<  N  payment
```

| 表 | 中文名 | 角色 |
|---|---|---|
| `member` / `member_profile` | 会员 / 会员扩展资料 | 1:1 |
| `card_template` / `member_card` | 卡种 / 会员手里的卡 | 模板 → 实例（1:N） |
| `card_ledger` | 次数流水 | 会员卡 1:N 流水 |
| `course` / `class_session` | 课程 / 某节课（排课） | 模板 → 实例（1:N） |
| `coach` / `coach_course` | 教练 / 教练可授课程 | 教练 N:M 课程，纯关联 |
| `booking` | 预约 | 会员 N:M 排课，**带属性的关联** |
| `trade_order` / `payment` | 订单 / 支付记录 | 1:N（一笔订单可多次发起支付） |

### 3.3 三种关系怎么落表

**1:N —— 在"多"的一方放外键字段**

```
member (1) ──< member_card (N)
member_card.member_id → member.id
```

**前端类比**：Redux normalized state 里，`todos` 存 `userId`，而不是在 `user` 里放一个 `todoIds` 数组。数组放在"一"的那边，在关系数据库里没法建索引、没法约束、没法高效查询。

**1:1 —— 两种做法**

1. 直接合并成一张表（最常见，也最简单）
2. 拆成两张表，副表用主表 id 做唯一外键：`member_profile.member_id` 加 **UNIQUE**

什么时候值得拆：
- 一部分字段**很少用**（每次查会员列表不需要身体情况备注）
- 一部分字段**很大**（长文本），拖慢主表
- 一部分字段**敏感**，要单独控制权限或加密
- 一部分字段**只有部分记录才有**（比如只有教练才有"资质证书"，可以 `user` + `coach_profile`）

**唯一约束是 1:1 的灵魂**：没有 `UNIQUE (member_id)`，它在数据库层面就只是个 1:N，代码一出 bug 就会插进第二条。

**N:M —— 必须有中间表**

中间表分两种：

| 类型 | 例子 | 特点 |
|---|---|---|
| 纯关联 | `coach_course`：教练能教哪些课 | 只有两个 id，联合唯一 |
| 带属性的关联（其实是个实体） | `booking`：会员预约了某节课 | 有自己的状态、时间、用哪张卡扣的 |

**第二种非常常见，而且是建模水平的分水岭**。"会员和课是多对多"这个认知是对的，但如果只建一张 `member_class(member_id, session_id)`，你就没地方放"预约状态""取消时间""签到时间""扣的哪张卡"。正确的认知是：**N:M 关系本身经常就是一个业务事件，它值得一个正经名字和一张正经的表**。

**前端类比**：多选标签（文章 × 标签）是纯关联；购物车（用户 × 商品，还有数量、勾选状态、加入时间）就是带属性的关联。

---

## 4. 第⑥步：落表

### 4.1 先定团队约定

每个公司都有自己的约定，**先看现有表，跟着现有约定走，比"最佳实践"更重要**。国内 Java 团队常参考《阿里巴巴 Java 开发手册》，典型约定：

- 表名、字段名小写 + 下划线，表名用单数（`member` 不是 `members`）
- 主键 `id BIGINT UNSIGNED`
- 每张表必备 `create_time`/`update_time`（有的公司叫 `gmt_create`/`gmt_modified`，或 `created_at`/`updated_at`）
- 布尔字段 `is_xxx`，类型 `TINYINT UNSIGNED`
- 字符集 `utf8mb4`（`utf8` 在 MySQL 里只有 3 字节，存不了 emoji，会员昵称里一个 😊 就报错）
- 每张表、每个字段写 `COMMENT`

本文用 `created_at` / `updated_at` / `deleted` 风格，你看公司项目时以公司为准。

### 4.2 建表语句

下面是完整 DDL，每张表后面讲"为什么这样设计"。不用背，重点看注释和后面的说明。

```sql
-- ========== 会员 ==========
CREATE TABLE member (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  phone       VARCHAR(20)     NOT NULL COMMENT '手机号，登录凭证',
  nickname    VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '昵称',
  avatar_url  VARCHAR(512)    NOT NULL DEFAULT '' COMMENT '头像地址',
  status      TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1正常 2禁用',
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0未删除，删除时置为本行id',
  PRIMARY KEY (id),
  UNIQUE KEY uk_phone_deleted (phone, deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员';

CREATE TABLE member_profile (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id         BIGINT UNSIGNED NOT NULL COMMENT '会员id，1:1',
  health_note       VARCHAR(1000)   NOT NULL DEFAULT '' COMMENT '身体情况备注',
  emergency_name    VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '紧急联系人',
  emergency_phone   VARCHAR(20)     NOT NULL DEFAULT '' COMMENT '紧急联系人电话',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_member_id (member_id)               -- 1:1 靠它保证
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员扩展资料';

-- ========== 教练、课程 ==========
CREATE TABLE coach (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(50)     NOT NULL COMMENT '姓名',
  phone       VARCHAR(20)     NOT NULL DEFAULT '',
  intro       VARCHAR(1000)   NOT NULL DEFAULT '' COMMENT '简介',
  status      TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1在职 2离职',
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教练';

CREATE TABLE course (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name              VARCHAR(50)      NOT NULL COMMENT '课程名，如 流瑜伽',
  description       VARCHAR(2000)    NOT NULL DEFAULT '',
  duration_minutes  SMALLINT UNSIGNED NOT NULL COMMENT '时长（分钟）',
  default_capacity  SMALLINT UNSIGNED NOT NULL COMMENT '默认人数上限',
  status            TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1启用 2停用',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='课程（模板）';

CREATE TABLE coach_course (                          -- N:M 纯关联
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coach_id    BIGINT UNSIGNED NOT NULL,
  course_id   BIGINT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_coach_course (coach_id, course_id), -- 防重复，也服务"某教练能教什么"
  KEY idx_course_id (course_id)                     -- 服务"某课程有哪些教练能教"
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='教练可授课程';

-- ========== 排课（课程的实例） ==========
CREATE TABLE class_session (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id     BIGINT UNSIGNED NOT NULL,
  coach_id      BIGINT UNSIGNED NOT NULL,
  start_at      DATETIME        NOT NULL COMMENT '开始时间',
  end_at        DATETIME        NOT NULL COMMENT '结束时间',
  capacity      SMALLINT UNSIGNED NOT NULL COMMENT '本节人数上限（从课程默认值带出，可改）',
  booked_count  SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '已约人数（冗余计数，见第9节）',
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1正常 2已取消',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_by    BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '排课的后台用户id',
  PRIMARY KEY (id),
  KEY idx_start_at (start_at),                      -- 会员看本周课表
  KEY idx_coach_start (coach_id, start_at),         -- 教练看自己的课、排课时查冲突
  CONSTRAINT chk_session_time CHECK (end_at > start_at),
  CONSTRAINT chk_session_count CHECK (booked_count <= capacity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='排课';

-- ========== 卡种（模板）与会员卡（实例） ==========
CREATE TABLE card_template (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name          VARCHAR(50)      NOT NULL COMMENT '卡名',
  card_type     TINYINT UNSIGNED NOT NULL COMMENT '1次卡 2期限卡',
  total_times   SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '次卡总次数，期限卡为0',
  valid_days    SMALLINT UNSIGNED NOT NULL COMMENT '购买后有效天数',
  price         DECIMAL(10,2)    NOT NULL COMMENT '售价（元）',
  status        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1在售 2下架',
  sort_order    INT              NOT NULL DEFAULT 0 COMMENT '展示排序',
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT chk_tpl_price CHECK (price >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='卡种（可售商品）';

CREATE TABLE member_card (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_id        BIGINT UNSIGNED NOT NULL,
  template_id      BIGINT UNSIGNED NOT NULL COMMENT '来自哪个卡种',
  order_id         BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '来自哪笔订单，后台赠送为0',
  card_name        VARCHAR(50)      NOT NULL COMMENT '快照：发卡时的卡名',
  card_type        TINYINT UNSIGNED NOT NULL COMMENT '快照：1次卡 2期限卡',
  total_times      SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '快照：总次数',
  remaining_times  SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前剩余次数',
  start_date       DATE             NOT NULL COMMENT '生效日',
  end_date         DATE             NOT NULL COMMENT '到期日（含当天）',
  status           TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1可用 2已用完 3已过期 4已作废',
  version          INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_member_status (member_id, status),        -- 我的卡 / 约课时选可用的卡
  KEY idx_status_end (status, end_date)             -- 每天跑任务把过期卡置为已过期
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员持有的卡';

CREATE TABLE card_ledger (                           -- 流水：只增不改
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  member_card_id  BIGINT UNSIGNED NOT NULL,
  member_id       BIGINT UNSIGNED NOT NULL COMMENT '冗余，方便按会员查',
  change_times    SMALLINT        NOT NULL COMMENT '变化量，扣次为负，退回为正',
  balance_after   SMALLINT UNSIGNED NOT NULL COMMENT '变化后剩余次数',
  biz_type        TINYINT UNSIGNED NOT NULL COMMENT '1购卡 2约课扣次 3取消退回 4后台调整',
  biz_id          BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '关联业务id，如 booking.id',
  remark          VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '后台调整必须填原因',
  operator_id     BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '操作人，会员自己操作为0',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_card (member_card_id, id),                -- 某张卡的使用记录，按时间倒序
  UNIQUE KEY uk_biz (biz_type, biz_id, member_card_id) -- 同一笔业务只记一次（防重复扣次）
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='会员卡次数流水';

-- ========== 预约（会员 × 排课 的 N:M，带属性） ==========
CREATE TABLE booking (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  session_id      BIGINT UNSIGNED NOT NULL,
  member_id       BIGINT UNSIGNED NOT NULL,
  member_card_id  BIGINT UNSIGNED NOT NULL COMMENT '用哪张卡约的',
  status          TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1已预约 2已取消 3已签到 4缺席',
  booked_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '预约时间',
  cancelled_at    DATETIME NULL COMMENT '取消时间',
  checked_in_at   DATETIME NULL COMMENT '签到时间',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_session_member (session_id, member_id), -- 同一节课不能约两次；也服务"某节课预约名单"
  KEY idx_member_booked (member_id, booked_at)           -- 我的预约
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='约课记录';

-- ========== 订单与支付 ==========
CREATE TABLE trade_order (                           -- 不叫 order：ORDER 是 SQL 关键字
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_no        VARCHAR(32)     NOT NULL COMMENT '业务订单号，给用户和支付平台看',
  member_id       BIGINT UNSIGNED NOT NULL,
  template_id     BIGINT UNSIGNED NOT NULL COMMENT '购买的卡种',
  item_name       VARCHAR(50)     NOT NULL COMMENT '快照：下单时卡名',
  item_price      DECIMAL(10,2)   NOT NULL COMMENT '快照：下单时单价',
  quantity        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  total_amount    DECIMAL(10,2)   NOT NULL COMMENT '应付金额',
  discount_amount DECIMAL(10,2)   NOT NULL DEFAULT 0.00 COMMENT '优惠金额',
  pay_amount      DECIMAL(10,2)   NOT NULL COMMENT '实付金额',
  status          TINYINT UNSIGNED NOT NULL DEFAULT 10 COMMENT '10待支付 20已支付 30已关闭 40已退款',
  expire_at       DATETIME        NOT NULL COMMENT '超时未付自动关闭的时间点',
  paid_at         DATETIME        NULL,
  closed_at       DATETIME        NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_order_no (order_no),
  KEY idx_member_created (member_id, created_at),   -- 我的订单
  KEY idx_status_expire (status, expire_at),        -- 定时关单任务
  KEY idx_paid_at (paid_at),                        -- 按月统计销售额
  CONSTRAINT chk_order_amount CHECK (pay_amount >= 0 AND pay_amount = total_amount - discount_amount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单';

CREATE TABLE payment (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id          BIGINT UNSIGNED NOT NULL,
  channel           TINYINT UNSIGNED NOT NULL COMMENT '1微信支付',
  out_trade_no      VARCHAR(64)     NOT NULL COMMENT '我方发给支付平台的单号，每次发起支付唯一',
  channel_trade_no  VARCHAR(64)     NULL COMMENT '支付平台返回的交易号',
  amount            DECIMAL(10,2)   NOT NULL,
  status            TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1支付中 2成功 3失败',
  notify_raw        TEXT            NULL COMMENT '支付回调原文，排查用',
  paid_at           DATETIME        NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_out_trade_no (out_trade_no),        -- 回调幂等的依据
  KEY idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='支付记录（一笔订单可多次发起支付）';
```

### 4.3 逐表讲"为什么"

**`member`**
- `phone` 是业务唯一的，但**不当主键**。手机号会换，主键一旦被其他表引用就不能改。主键用无业务含义的 `id`（代理键），业务唯一性用 `UNIQUE` 约束表达。
- `deleted` 为什么是 `BIGINT` 且删除时置为 `id`？见第 7 节软删除，这是"软删除 + 唯一约束"冲突的标准解法。
- 字符串字段大多是 `NOT NULL DEFAULT ''`：避免代码里到处判 null。但"没有值"和"空字符串"含义不同时（比如 `cancelled_at`），就该允许 `NULL`。

**`member_profile`**：1:1 拆表的示范，理由是低频 + 敏感。小项目直接合进 `member` 也完全没问题。

**`class_session`**
- `capacity` 从 `course.default_capacity` 带出来，但存在排课上：馆主可能某节课临时改成 15 人。**这也是一种"模板 → 实例"的复制**，不是冗余。
- `booked_count` 是有意冗余，第 9 节详细讨论。
- 两个 `CHECK` 约束（MySQL 8.0.16+ 才真正生效）把业务规则下沉到数据库，代码出 bug 也写不进脏数据。

**`member_card`**
- 存了一堆卡种的快照字段（`card_name`、`card_type`、`total_times`）：卡种以后改了、下架了，已发出的卡不受影响。
- `start_date` / `end_date` 用 `DATE` 不是 `DATETIME`：业务语义就是"到某天为止"，用 `DATETIME` 反而要纠结是 `23:59:59` 还是次日 `00:00:00`。
- `version` 乐观锁：后台调整次数和会员约课可能同时发生。

**`card_ledger`**
- 流水**只 insert，不 update、不 delete**。改错了就再记一笔反向的。这和会计"红字冲正"是一个思路。
- `balance_after` 让你随时能核对：最后一条流水的 `balance_after` 应该等于 `member_card.remaining_times`，不等就说明有 bug。
- `uk_biz` 唯一约束：同一个 booking 不可能扣两次次数。重复请求在数据库层面就被挡住了。

**`booking`**
- `uk_session_member (session_id, member_id)`：同时承担业务规则（不能重复约）和查询加速（某节课的预约名单，最左前缀命中 `session_id`）。
- 取消后再约怎么办？因为有唯一约束，不能再 insert 一条。做法是**把原记录状态从"已取消"改回"已预约"**，更新 `booked_at`、清空 `cancelled_at`。如果业务要求保留每一次取消的历史，那就去掉这个唯一约束，改用别的办法防重复（见第 7 节）。**这就是一个需要和业务确认的设计决策**，没有唯一正确答案。
- 几个时间字段 `cancelled_at` / `checked_in_at` 可空：它们是"状态发生的时刻"，不发生就是 `NULL`。

**`trade_order` 和 `payment`**
- `order_no` 和 `id` 分开：`id` 是自增的，直接暴露给用户能被推算出你一天卖了多少单；`order_no` 是业务编号（常见格式：日期 + 随机/序列号），给用户、客服、支付平台看。
- 订单 1 : N 支付：用户第一次拉起支付没付，过一会儿重新付，每次都应该是一个新的 `out_trade_no`。把支付字段直接塞进订单表，第二次支付就没地方放了。
- 金额拆成 `total_amount` / `discount_amount` / `pay_amount`：将来加优惠券、对账、退款都需要。哪怕现在没有优惠，也别只留一个 `amount`。

### 4.4 约束：让数据库替你兜底

| 约束 | 作用 | 本案例中的例子 |
|---|---|---|
| `PRIMARY KEY` | 行的身份 | 每张表的 `id` |
| `UNIQUE` | 业务唯一性、防重复、幂等 | 手机号、订单号、同一节课不能约两次、同一笔业务只扣一次 |
| `NOT NULL` + `DEFAULT` | 消灭"不知道是没填还是空"的歧义 | 绝大多数字段 |
| `CHECK` | 值域、字段间的规则 | 结束时间晚于开始时间、已约人数不超过上限 |
| `FOREIGN KEY` | 引用的行必须存在 | 本案例没加，见下面说明 |

**为什么很多公司不建外键约束？** 外键会在每次写入时检查关联表并加锁，高并发下影响性能；分库分表后外键根本没法跨库；数据迁移和批量修复时也很碍事。所以国内团队普遍"逻辑外键"：字段叫 `xxx_id`、建索引、由代码保证。**小项目、低并发的内部系统建外键完全合理**，能挡住很多低级错误。跟着公司约定走。

**前端类比**：约束就像 TypeScript 的类型检查 + 表单校验的"最后一道防线"。前端校验是体验，后端代码校验是逻辑，**数据库约束是兜底**：哪怕将来有人写脚本直接改库、有人写了有 bug 的新接口，脏数据也进不去。

---

## 5. 索引：由查询驱动，而不是凭感觉

**原则**：先列出所有查询（也就是页面和接口），再决定索引。不要"每个 `xxx_id` 都建个索引"，也不要"等慢了再说"。

把第 2.1 节的场景翻译成查询，逐个对应索引：

| 场景 | 查询条件 | 用到的索引 |
|---|---|---|
| 手机号登录 | `member WHERE phone=? AND deleted=0` | `uk_phone_deleted` |
| 本周课表 | `class_session WHERE start_at BETWEEN ? AND ? AND status=1` | `idx_start_at` |
| 教练的课 / 排课时查时间冲突 | `class_session WHERE coach_id=? AND start_at < ? AND end_at > ?` | `idx_coach_start` |
| 我的卡（可用的） | `member_card WHERE member_id=? AND status=1` | `idx_member_status` |
| 某张卡的使用记录 | `card_ledger WHERE member_card_id=? ORDER BY id DESC` | `idx_card` |
| 某节课预约名单 | `booking WHERE session_id=?` | `uk_session_member`（最左前缀） |
| 我的预约 | `booking WHERE member_id=? ORDER BY booked_at DESC` | `idx_member_booked` |
| 我的订单 | `trade_order WHERE member_id=? ORDER BY created_at DESC` | `idx_member_created` |
| 定时关闭超时订单 | `trade_order WHERE status=10 AND expire_at < NOW()` | `idx_status_expire` |
| 支付回调 | `payment WHERE out_trade_no=?` | `uk_out_trade_no` |
| 月销售额 | `trade_order WHERE paid_at >= ? AND paid_at < ?` | `idx_paid_at` |

几个值得注意的点：
- `idx_status_expire` 里 `status` 区分度很低，单独建索引没意义；但和 `expire_at` 组合起来，"待支付"的订单通常很少，效果就很好。**区分度要看组合，不只看单列**。
- 月销售额用 `paid_at >= '2026-03-01' AND paid_at < '2026-04-01'`，**不要**写 `DATE_FORMAT(paid_at, '%Y-%m') = '2026-03'`，后者对索引列用了函数，索引失效。
- 联合索引的顺序：**等值条件的列在前，范围条件和排序的列在后**。`(member_id, booked_at)` 能做到"按会员过滤 + 按时间排序"一步完成，不用额外 filesort。

**前端类比**：索引就是你为了某个查询专门建的 `Map`。你不会给对象的每个属性都建一个 `Map`，而是看代码里哪些地方真的按什么查。

---

## 6. 状态字段与状态机

几乎每个"事件类"实体都有状态：订单、支付、预约、会员卡。状态字段设计不好，是线上 bug 的头号来源。

### 6.1 先画状态机，再定字段

```
预约 booking.status
  (新建)      → 1 已预约   约课成功
  1 已预约    → 2 已取消   会员在开课前 2 小时之前取消
  2 已取消    → 1 已预约   重新约课（复用原记录）
  1 已预约    → 3 已签到   前台签到
  1 已预约    → 4 缺席     课程结束仍未签到（定时任务）

订单 trade_order.status
  (新建)      → 10 待支付
  10 待支付   → 20 已支付  支付成功回调
  10 待支付   → 30 已关闭  超时未付 / 用户取消
  20 已支付   → 40 已退款  退款
```

**没列出来的流转默认都是非法的**，比如"已关闭 → 已支付"。

列出来以后你会自然问出很多问题：已签到还能取消吗？缺席要不要把约课时扣的次数退回（大多数馆不退）？已关闭的订单收到迟到的支付成功回调怎么办？**这些问题都要在写代码前问客户**。

### 6.2 状态流转要用"带条件的更新"

```sql
-- 取消预约：只有"已预约"的才能取消
UPDATE booking
SET status = 2, cancelled_at = NOW()
WHERE id = ? AND status = 1;
-- 看影响行数：1 表示成功；0 表示状态已经变了（被签到了、被别的请求取消了）
```

**不要**先 `SELECT` 出来在 Java 里判断状态再 `UPDATE ... WHERE id = ?`：两步之间别的请求可能已经改了状态。`WHERE status = 旧状态` 把"检查 + 修改"变成一个原子操作，同时天然幂等（重复请求第二次影响行数为 0）。

### 6.3 状态值怎么存

| 方案 | 优点 | 缺点 |
|---|---|---|
| `TINYINT` 数字（国内最常见） | 省空间，排序/范围好用 | 直接看库看不懂，要靠 `COMMENT` 和 Java 枚举 |
| 短 `VARCHAR`（`'PAID'`） | 可读 | 稍占空间，拼写错误没有约束 |
| MySQL `ENUM` 类型 | 有约束 | **不推荐**：加新状态要 `ALTER TABLE`，排序按定义顺序容易踩坑 |

数字状态的小技巧：订单状态用 `10/20/30/40` 留间隔，以后想在"待支付"和"已支付"之间加个"支付确认中"可以用 `15`，不打乱顺序。

Java 侧一定要有对应枚举，代码里写 `OrderStatus.PAID`，**禁止**在代码里出现魔法数字 `status == 20`。

### 6.4 "一个状态"还是"多个布尔"

反例：`is_paid`、`is_closed`、`is_refunded` 三个布尔字段。三个布尔有 8 种组合，其中大部分是非法的（既关闭又已退款？），数据库挡不住。**互斥的状态用一个状态字段**。

正例：真正**相互独立**的维度才拆开。比如订单的"支付状态"和"发货状态"在电商里是两条独立的状态机，可以拆成两个字段。

---

## 7. 软删除、审计字段与"历史"

### 7.1 软删除：不是默认选项

软删除（逻辑删除）就是不真删，打个 `deleted` 标记。MyBatis-Plus 的 `@TableLogic` 会自动给所有查询加上 `WHERE deleted = 0`。

**什么时候用**：数据被其他历史记录引用（教练离职了，历史排课还要显示他的名字）；需要能恢复；有合规审计要求。

**什么时候不该用，或者有更好的选择**：
- **有业务含义的"删除"应该是状态**，而不是软删除。教练离职是 `status = 离职`，订单取消是 `status = 已关闭`，下架是 `status = 下架`。它们是业务流程的一部分，软删除是"这行数据不该存在了"。
- 纯关联表（`coach_course`）一般直接物理删除，历史意义不大。
- 流水表、日志表**永远不删**。

**软删除最大的坑：和唯一约束冲突**

`member` 有 `UNIQUE(phone)`。会员注销（软删除，`deleted = 1`），过几个月用同一个手机号重新注册：insert 失败，因为那条软删除的记录还占着这个手机号。

常见错误解法：`UNIQUE(phone, deleted)`。第一次注销没问题，但第二次注销时，就有两条 `(13800000000, 1)`，又冲突了。

另一个错误解法：用 `deleted_at DATETIME NULL` 然后 `UNIQUE(phone, deleted_at)`。MySQL 的唯一索引里 `NULL` 互不相等，**两条未删除的记录 `(13800000000, NULL)` 都能插进去**，唯一约束对正常数据失效了。

标准解法就是本文的写法：`deleted BIGINT NOT NULL DEFAULT 0`，删除时 `SET deleted = id`。未删除的都是 0，互相冲突（正确）；已删除的各不相同，不冲突。

### 7.2 审计字段

| 字段 | 作用 | 谁来填 |
|---|---|---|
| `created_at` / `updated_at` | 什么时候建的、最后什么时候改的 | 数据库默认值 + `ON UPDATE`，或 MyBatis-Plus 自动填充 |
| `created_by` / `updated_by` | 谁建的、谁改的 | 代码从登录上下文取 |
| `version` | 乐观锁 | 框架维护 |

`updated_at` 只记录"最后一次"。**如果需要知道"每一次谁把什么从什么改成了什么"，审计字段不够，需要专门的流水表或操作日志表**。本案例里后台调整次数用 `card_ledger` 记录了操作人和原因，就是这个思路。

经验法则：**和钱、次数、权限相关的变更，都要能回答"谁、什么时候、为什么、从多少变成多少"**。客户来问"我的卡怎么少了一次"，你要能当场查出来。

---

## 8. 金额、时间、ID 的类型选择

### 8.1 金额

**绝不用 `FLOAT` / `DOUBLE`**。前端类比：你一定见过 `0.1 + 0.2 === 0.30000000000000004`，浮点数存钱就是这个问题，加加减减几次就差一分钱，对账永远对不平。

两种正确做法：

| 方案 | 数据库 | Java | 说明 |
|---|---|---|---|
| 定点小数 | `DECIMAL(10,2)` | `BigDecimal` | 直观，看库就是元。注意 Java 里比较用 `compareTo` 不用 `equals`（`1.0` 和 `1.00` equals 不相等） |
| 整数分 | `BIGINT`（单位：分） | `Long` | 计算快、无精度问题，微信支付接口本身就用分。缺点是看库要心算，前端展示要除以 100 |

一个项目里**只用一种**，并在字段 `COMMENT` 写清单位。混用是灾难。

`DECIMAL(10,2)` 表示总共 10 位、2 位小数，最大 `99999999.99`。按业务最大可能金额留够余量。汇率、单价折扣这种可能要更多小数位。

### 8.2 时间

| 类型 | 存什么 | 适合 |
|---|---|---|
| `DATE` | 只有日期 | 生日、卡的有效期、营业日 |
| `DATETIME` | 日期 + 时间，**原样存储**，不带时区 | 国内业务最常用 |
| `TIMESTAMP` | 存 UTC，读写时按连接的 `time_zone` 转换 | 跨时区场景；**范围只到 2038 年** |
| `DATETIME(3)` | 精确到毫秒 | 需要严格排序的事件（支付回调、流水） |

**时区是最隐蔽的坑**：数据库服务器时区、JDBC 连接参数 `serverTimezone`、Java 应用时区、前端浏览器时区，任何一个不一致都会出现"差 8 小时"。国内单时区业务的稳妥做法：统一用 `Asia/Shanghai`，`DATETIME` + Java `LocalDateTime`，在团队里写下来。

**区分"时间点"和"日期"**：`end_date` 是"到 3 月 31 日为止（含）"，查询时写 `end_date >= CURDATE()`。如果用 `DATETIME` 存 `2026-03-31 00:00:00`，那 3 月 31 日下午这张卡就"过期"了，这是很常见的 bug。

**时间范围用左闭右开**：`start_at >= '2026-03-01' AND start_at < '2026-04-01'`，不用 `BETWEEN '2026-03-01' AND '2026-03-31 23:59:59'`（会漏掉 59.5 秒，也不优雅）。

### 8.3 ID

| 方案 | 优点 | 缺点 |
|---|---|---|
| 自增 `BIGINT` | 简单、有序、索引友好 | 可被推算业务量；分库分表时不唯一 |
| 雪花 ID（MyBatis-Plus `ASSIGN_ID` 默认） | 分布式唯一、大致有序 | 19 位数字，**超过 JS 的安全整数范围** |
| UUID 字符串 | 全局唯一 | 无序，做 InnoDB 主键会导致频繁页分裂，插入慢、索引大 |

**前端必须知道的坑**：雪花 ID 是 `1798234567890123456` 这样的数，超过 `Number.MAX_SAFE_INTEGER`（2^53 − 1）。后端返回 JSON 数字，前端 `JSON.parse` 后**最后几位会变**，拿去查详情就查不到。解法是后端把 `Long` 序列化成字符串（Jackson 配置 `ToStringSerializer`）。AI 写的后端经常漏这个，前端看起来像"偶发查不到数据"。

---

## 9. 范式与有意冗余

### 9.1 范式，一句话版

教科书的 1NF / 2NF / 3NF 很绕，记住这一句就够了：

> **每个非主键字段，都应该描述"这个主键"本身，描述完整的主键，而且只描述这个主键。**

逐条翻译：

- **1NF：一个格子只放一个值**。反例：`member.tags = '孕期,腰伤,初学'`。前端类比：把数组 `join(',')` 存成字符串，以后要"查所有有腰伤的会员"只能 `LIKE '%腰伤%'`，没法建索引，改标签要做字符串手术。正确做法是关联表。
- **2NF：描述完整的主键**。只在联合主键时出现：如果 `booking` 用 `(session_id, member_id)` 做主键，又存了 `member_nickname`，昵称只依赖 `member_id`，不依赖整个主键，就违反了。
- **3NF：只描述这个主键**。反例：`booking` 里存 `coach_name`。教练名描述的是教练，不是预约。教练改名后，所有预约里的教练名都是旧的，而且没人知道该不该更新。

**前端类比**：这就是 Redux 文档里"normalized state"的思想：每个实体按 id 存一份，别处用 id 引用。你在前端遇到过的"同一个用户头像改了，列表里更新了、详情里没更新"，就是数据存了多份的后果。

### 9.2 什么时候有意冗余

范式是默认值，冗余是**有理由的例外**。合理的冗余都能回答三个问题：**为什么要冗余？由谁保证同步？不同步了怎么修？**

本案例里的冗余逐个过一遍：

| 冗余 | 为什么 | 怎么保证一致 | 坏了怎么修 |
|---|---|---|---|
| `class_session.booked_count` | 课表页每节课都要显示剩余名额，避免每次 `COUNT`；**更重要的是用它做并发控制**（见下） | 和 `booking` 的增改在同一个事务里 | 脚本用 `COUNT(booking)` 重算 |
| `member_card.remaining_times` | 约课时要快速判断和扣减 | 和 `card_ledger` 在同一个事务里 | 用流水重算，或对比 `balance_after` |
| `card_ledger.member_id` | 按会员查所有流水时不用 JOIN | 写入后不会变（卡不会换主人） | 基本不会坏 |
| `trade_order.item_name` 等 | **不是冗余，是快照** | 不需要同步，本来就该是旧值 | — |

**`booked_count` 的并发价值**：约课最怕超卖，两个人同时约最后一个名额。有了这个字段，可以用一条原子更新抢名额：

```sql
-- 约课事务的核心步骤（Service 方法加 @Transactional）
-- 1) 抢名额：只有还有空位、课程正常时才成功
UPDATE class_session
SET booked_count = booked_count + 1
WHERE id = ? AND status = 1 AND booked_count < capacity;
-- 影响行数为 0 → 满员或已取消，直接返回失败

-- 2) 扣次数：只有卡可用、有余次、未过期时才成功
UPDATE member_card
SET remaining_times = remaining_times - 1, version = version + 1
WHERE id = ? AND member_id = ? AND status = 1
  AND remaining_times > 0 AND end_date >= CURDATE();
-- 影响行数为 0 → 抛异常，事务回滚，第 1 步的名额也会退回

-- 3) 写预约（唯一约束挡住重复约）
INSERT INTO booking (session_id, member_id, member_card_id, status) VALUES (?, ?, ?, 1);

-- 4) 写流水
INSERT INTO card_ledger (member_card_id, member_id, change_times, balance_after, biz_type, biz_id)
VALUES (?, ?, -1, ?, 2, ?);
```

如果只靠 `SELECT COUNT(*) FROM booking WHERE session_id = ?` 判断有没有空位，两个并发请求都会读到"还剩 1 个"，然后都插入成功。这就是第 01 篇 5.4 节讲的经典并发问题在建模阶段的体现：**表结构设计会直接决定并发问题好不好解**。

### 9.3 冗余的反面教材

- 为了"少写一个 JOIN"在很多表里冗余了会变的名称字段，又没有同步机制，最后数据五花八门。
- 存了一个可以算出来的"总价"字段，却在改单价时忘了更新它。
- 计数字段不在事务里更新，在事务外"顺手 +1"，出错时计数和实际对不上。

---

## 10. 从表到 Java：Entity 长什么样

表定下来以后，AI 一般会生成对应的 Entity。用 MyBatis-Plus 时大致是这样，对照着看几个关键点：

```java
@Data
@TableName("member_card")
public class MemberCard {
    @TableId(type = IdType.AUTO)          // 和表的 AUTO_INCREMENT 对应；若用雪花则 ASSIGN_ID
    private Long id;
    private Long memberId;                // 下划线自动映射为驼峰
    private Long templateId;
    private String cardName;
    private CardType cardType;            // 枚举，配合 @EnumValue 存数字
    private Integer remainingTimes;
    private LocalDate startDate;          // DATE → LocalDate
    private LocalDate endDate;
    private MemberCardStatus status;
    @Version
    private Integer version;              // 乐观锁
    private LocalDateTime createdAt;      // DATETIME → LocalDateTime
    private LocalDateTime updatedAt;
}
```

审 AI 生成的 Entity 时看：
- 金额字段是 `BigDecimal`（或 `Long` 分），**不是 `Double`**
- 时间是 `LocalDateTime` / `LocalDate`，不是老的 `java.util.Date`
- 状态是枚举，不是裸 `Integer`
- 主键策略和表一致（表是自增，Entity 却写了 `ASSIGN_ID`，会插入一个巨大的雪花数）
- Entity 不要直接返回给前端（见第 01 篇第 2 节），尤其 `Long` 类型 id 记得转字符串

---

## 11. 常见错误（AI 和新手都爱犯）

按"出事概率 × 后果"大致排序：

1. **模板和实例混为一谈**：只有"卡种"没有"会员卡"；只有"课程"没有"排课"。
2. **该存快照的没存**：订单只存商品 id，改价后历史订单金额"变了"。
3. **N:M 用了纯关联表，丢了关系上的属性**：预约只有两个 id，没状态没时间。
4. **用逗号分隔字符串存列表**：`tags`、`role_ids`、`image_urls = 'a.jpg,b.jpg'`。图片列表少量、不查询时可以用 JSON 字段，但凡要按它查、要关联，就该拆表。
5. **金额用 `DOUBLE`**，或者一个项目里有的用元有的用分。
6. **只有当前值没有流水**：次数、余额、积分出问题时无从查起。
7. **用多个布尔表示互斥状态**：`is_paid` + `is_cancelled` + `is_refunded`。
8. **状态流转先查后改**：没有 `WHERE status = ?` 条件，并发下状态乱跳。
9. **软删除和唯一约束冲突**没处理，或用 `deleted_at` + 唯一索引踩 `NULL` 的坑。
10. **业务字段当主键**：手机号、订单号做主键，将来要改就麻烦了。
11. **索引凭感觉建**：每个字段都建，或者一个都不建；联合索引列顺序随便排。
12. **用保留字做表名、字段名**：`order`、`desc`、`key`、`group` 都是保留字，写 SQL 要到处加反引号，MyBatis 里还容易漏。所以本文用 `trade_order`、`description`。
13. **`utf8` 而不是 `utf8mb4`**：emoji 存不进去。
14. **`VARCHAR(255)` 一把梭**：长度应该有业务含义。手机号 20、昵称 50、备注 500，太长浪费内存排序空间，太短截断报错。
15. **为"将来可能需要"预留一堆字段**：`ext1`、`ext2`、`reserved_field`。将来真需要时再加字段，`ext1` 半年后没人知道它存的是什么。
16. **一张表包办一切**：`user` 表里既有会员又有教练又有后台管理员，用 `type` 区分，各种字段大部分是空的。身份差异大时，账号（登录凭证）和角色资料应该分开。

---

## 12. 设计会演进：怎么改表才不出事

### 12.1 需求变化的例子

上线三个月后，客户提了几个新需求。看看你的模型能不能接住：

**"我们开了第二家店"** → 新增 `store` 表；`class_session` 加 `store_id`（课在哪家店上）；`card_template` 要不要加？取决于"卡能不能跨店用"，**又是一个要问客户的问题**。如果有的卡通用、有的卡限店，那就是卡种 N:M 门店，需要 `card_template_store` 关联表。

**"一张卡可以给家人用"** → 原来 `member_card.member_id` 是 1:N 的"持有人"。现在变成"一张卡可以被多个会员使用"，需要新增 `member_card_user(member_card_id, member_id)` 关联表；`member_card.member_id` 保留，语义变成"购买人/主卡人"。约课时校验"这个会员是不是这张卡的使用人"。

**"课程要分初级、中级、高级"** → 如果只是展示用，给 `course` 加一个 `level TINYINT`。如果会员也要有等级、并且要限制"初级会员不能约高级课"，那等级就成了业务规则，要考虑会员表也加字段，并在约课逻辑里校验。

**规律**：好的模型在需求变化时，大部分改动是**新增**（新表、新字段、新关联），而不是**推翻**。如果一个小需求导致你要改主键、拆表、搬数据，说明当初某个关系的基数判断错了，或者把两个概念混在了一起。

### 12.2 改表的安全姿势

**前端类比**：这和改一个被很多页面调用的公共 API 一样，不能直接改签名，要先兼容、再迁移、最后删除。

**扩展 → 迁移 → 收缩（expand-contract）**：

```
1. 扩展：只加不删。新增字段/新表，允许为空或有默认值，老代码不受影响
2. 回填：脚本把老数据补到新结构里（分批执行，别一个 UPDATE 改几百万行）
3. 切换：新代码读写新结构（必要时一段时间内双写）
4. 收缩：确认没有代码再用旧字段后，再删除旧字段
```

**几条硬规则**：
- **永远不要直接改线上字段名、改字段类型**。改名等于"删掉旧的 + 加一个新的"，正在跑的老代码瞬间报错。
- 加 `NOT NULL` 字段必须带 `DEFAULT`，否则老代码的 insert 会失败。
- 表结构变更脚本**纳入版本管理**：用 Flyway / Liquibase，或至少在仓库里按 `V3__add_store_id.sql` 这样编号保存。每个环境执行过哪些脚本要可追溯。你作为独立交付者，这一点尤其重要：客户的测试环境和正式环境结构不一致，是最难排查的问题之一。
- 大表（几百万行以上）`ALTER TABLE` 可能锁表或导致主从延迟，要用 MySQL 8 的 Online DDL（`ALGORITHM=INPLACE/INSTANT`）或 gh-ost / pt-osc 之类工具，在公司里先找 DBA 或后端同事确认。

### 12.3 JSON 字段：逃生舱，不是捷径

MySQL 8 的 `JSON` 类型很诱人："字段不确定，先塞 JSON 里"。

适合：第三方回调原文、前端的展示配置、确实不参与查询和统计的扩展属性、结构经常变而且只整体读写的东西。

不适合：要按它筛选、排序、统计、关联的数据；有业务规则约束的数据。一旦放进 JSON，就失去了类型、约束、普通索引、清晰的 Entity 映射。

---

## 13. 判断一份设计对不对：检查清单

每次自己做完设计，或者 AI 给出一份设计，按顺序过一遍。前几项发现问题，后面就不用看了，先回去改模型。

### 业务覆盖
- [ ] 把需求里的每个页面、接口、报表列出来，**每一个都能写出对应的 SQL**，而且 SQL 不别扭（不需要 `LIKE '%,3,%'`、不需要从 JSON 里抠字段、不需要 JOIN 七八张表）
- [ ] "隐含规则"都问过客户了，并在设计里有体现（不能重复约、过期作废、能否转让……）
- [ ] 没有为不存在的需求过度设计（没有 `ext1`、没有"万一以后"的表）

### 实体与关系
- [ ] 每个关系都用双向提问法确认过基数
- [ ] 模板 vs 实例分开了
- [ ] N:M 的中间表上，该有的属性（状态、时间、数量）都有
- [ ] 1:1 拆表有理由，并且有唯一约束

### 时间维度（最容易漏）
- [ ] **"会变的值"逐个问一遍：变了以后，历史记录该显示旧值还是新值？** 该快照的都快照了
- [ ] 钱、次数、库存、积分这类数值有流水，流水只增不改
- [ ] 被历史记录引用的实体（教练、商品），"删除"用的是状态，而不是物理删除
- [ ] 每个有状态的实体都画了状态机，非法流转在数据和代码层面都被挡住

### 字段与类型
- [ ] 金额 `DECIMAL` 或整数分，全项目统一，注释写明单位
- [ ] 日期用 `DATE`，时间点用 `DATETIME`，时区约定写下来了
- [ ] 主键无业务含义；若用雪花 ID，前端 JSON 序列化为字符串
- [ ] 字段长度有业务依据；`NOT NULL` / `NULL` 的选择有含义
- [ ] 字符集 `utf8mb4`，没有用保留字命名
- [ ] 审计字段齐全，符合团队约定

### 约束与索引
- [ ] 业务唯一性都有 `UNIQUE` 约束（手机号、订单号、一个人一节课一个预约、一笔业务一条流水）
- [ ] 软删除表的唯一约束能处理"删除后再创建"
- [ ] 每个高频查询都有对应索引；联合索引列顺序是"等值在前，范围/排序在后"
- [ ] 没有区分度极低的单列索引，没有重复索引（`(a)` 和 `(a, b)` 同时存在时前者通常多余）

### 并发与一致性
- [ ] 会被并发修改的数值（名额、库存、余额）有原子更新或锁的方案，表结构支持它
- [ ] 冗余字段都能回答：为什么冗余、谁保证同步、坏了怎么修
- [ ] 关联更新的几张表在同一个事务里
- [ ] 重复请求（双击、重试、重复回调）会被唯一约束或状态条件挡住

### 演进
- [ ] 想象 2–3 个合理的新需求（多门店、多币种、共享），模型改动主要是"新增"而不是"推翻"
- [ ] DDL 有版本化管理方案

---

## 14. 和 AI 协作做表设计

**核心思路**：不要一句"帮我设计一个约课系统的数据库"就收货。分成三轮：**你先给足业务，AI 先问问题再设计；然后换一个"审查者"视角批判；最后用业务场景逐个走查**。

### 14.1 第一轮：设计（让 AI 先提问）

```text
你是一名资深后端工程师，擅长 MySQL 数据建模。请帮我设计一个业务的数据模型。

## 技术栈与约定
- MySQL 8.0，InnoDB，utf8mb4；Java + Spring Boot + MyBatis-Plus
- 命名：小写下划线、表名单数；主键 id BIGINT UNSIGNED 自增
- 必备字段：created_at、updated_at；需要逻辑删除的表用 deleted（删除时置为 id）
- 不建物理外键，用逻辑外键 + 索引
- 金额统一用 DECIMAL(10,2)，单位元；时间统一 DATETIME，时区 Asia/Shanghai
- （如有现成表，贴 1~2 张 SHOW CREATE TABLE 的结果，让它照着风格来）

## 业务背景
<一段话说明这是什么业务、谁在用>

## 场景清单
<按角色列出每个页面/操作，像本文 2.1 节那样>

## 已确认的业务规则
<比如：同一会员不能重复预约同一节课；卡过期作废；改价不影响已售出的卡>

## 规模预估
<比如：会员 5000，每天约课 300 次，不需要分库分表>

## 要求
1. 先不要给 DDL。先列出你认为我没说清楚、但会影响表设计的问题（至少 5 个），每个问题说明不同答案会怎样影响设计。
2. 我回答之后，再给出：
   - 实体清单，每个实体一句话说明它是什么、为什么是独立实体
   - 关系图（文本即可），标明每个关系的基数，并说明判断理由
   - 哪些字段是快照、哪些数值需要流水、哪些字段是有意冗余（及同步方式）
   - 每个有状态的实体的状态机
   - 完整 DDL，每个字段写 COMMENT
   - 一张"场景 → SQL → 使用的索引"对照表，覆盖我列出的所有场景
```

关键在"**先提问**"：它会逼 AI 暴露它的默认假设，你也能借此发现自己没想到的规则。

### 14.2 第二轮：批判（开一个新对话）

**为什么开新对话**：同一个对话里，AI 倾向于为自己刚写的东西辩护。新对话里给它一个"审查者"身份，它会更挑剔。

```text
你是一名严格的数据库设计评审专家，正在审查一位同事提交的表设计。
你的目标是找出问题，而不是肯定它。

## 业务背景与场景清单
<和第一轮相同，原样贴上>

## 待审查的设计
<贴上第一轮得到的 DDL 和说明>

## 请逐项审查，每项给出：问题、严重程度（高/中/低）、具体场景下会出什么错、修改建议
1. 实体与关系：是否有模板/实例混淆？基数是否正确？N:M 中间表是否缺少属性？
2. 时间维度：哪些会变的值没有快照？哪些数值缺少流水？删除策略是否会破坏历史记录？
3. 状态：状态机是否完整？是否存在可以用多个布尔表达的互斥状态？
4. 类型：金额、时间、ID、字符串长度是否合理？
5. 约束：哪些业务规则只能靠代码保证、其实可以用唯一约束或 CHECK 下沉到数据库？软删除和唯一约束是否冲突？
6. 索引：对照场景清单，哪些查询没有合适的索引？哪些索引多余？联合索引顺序是否正确？
7. 并发：哪些操作在并发下会出错（超卖、重复扣减、状态乱跳）？表结构是否支持安全的写法？
8. 演进：假设出现以下新需求 <列 2 个你能想到的>，这个设计需要多大改动？

最后，列出你认为最需要我向客户确认的 3 个业务问题。
```

### 14.3 第三轮：场景走查（最能发现问题的一步）

挑最重要的几个场景，让 AI（或者你自己）**写出完整的 SQL 和事务步骤**，然后追问"时间流逝"和"出错"的情况：

```text
基于这份表设计，请逐个回答，每个都写出具体 SQL：

1. 会员 A 用卡 X 约了周三 19:00 的课，写出完整事务。如果两个会员同时约最后一个名额，会发生什么？
2. A 在开课前 3 小时取消，写出完整事务。如果 A 连点两次取消按钮呢？
3. 馆主把"10 次卡"从 1200 元改成 1500 元，A 三个月前的订单详情显示多少钱？
4. 教练 B 离职了，上个月 B 上过的课在报表里怎么显示？
5. 客户投诉"我的卡少了一次"，怎么查出每一次次数变化的原因和操作人？
6. 统计 3 月每个教练上了多少节课、平均到课率，写出 SQL，并说明用到的索引。
7. 微信支付回调重复推送了 3 次，会不会发 3 张卡？
```

**你自己的判断方法**：哪一题 AI 写得支支吾吾、需要加字段才答得上来、或者答案依赖"代码里注意一下"，哪里就是设计的漏洞。

### 14.4 怎么用 AI 的回答练自己

AI 的设计和批判都看完以后，花十分钟做这件事：**把它指出的每个问题，归类到本文第 13 节清单的某一项**。归不进去的，说明是你还没掌握的新知识点，补到清单里。几个项目下来，这份清单就是你自己的设计能力。

---

## 下一步建议

1. **手画一遍**：不看本文，用第 2 节的需求原文，自己走一遍七步法，画出实体关系图，再和本文对比差异。差异处就是要补的地方。
2. **拿公司的表练眼力**：找一个你熟悉的页面，找到它用到的 2–3 张核心表，`SHOW CREATE TABLE` 看结构，用第 13 节清单过一遍。重点找：快照、流水、状态字段、唯一约束。看不懂为什么这样设计的，就去问后端同事"当时为什么这么设计"，这是最快的学习方式。
3. **换个业务再练一次**：比如"社区团购"（商品、团长、拼团、订单、自提点）或"预约制美甲店"，用 14.1–14.3 的模板和 AI 走完三轮，自己当最终评审。
4. **补一个知识点**：本文提到但没展开的乐观锁 / 悲观锁 / 幂等，回到第 01 篇 5.4 节，结合本文的约课事务再读一遍，会有新的理解。
