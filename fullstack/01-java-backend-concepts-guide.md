# 前端视角的 Java 后端 + 数据库概念指南

> 目标：不是学会手写 Java，而是**看得懂 AI 写的后端代码、能和 AI 说清楚需求、能判断 AI 写得对不对**。
> 读法：每个概念都按「前端类比 → 为什么存在 → 在 Spring Boot 项目里长什么样 → 审 AI 代码时看什么」来讲。

## 学习路线

1. 一个请求在后端走了哪些地方（全局地图）
2. Spring Boot 分层：Controller / Service / Repository / Entity / DTO
3. IoC 和依赖注入（Spring 的灵魂）
4. 事务（@Transactional）
5. MySQL：建模、索引、事务隔离、锁、慢查询
6. ClickHouse：为什么公司还要一个 CK，什么时候用它
7. 后端的"非功能性"常识：异常、校验、日志、配置、安全
8. 怎么和 AI 协作写后端：提问模板 + 审查清单

建议节奏：1–3 先读透（这是看懂代码的地基），4–5 是最容易出事故的地方，6 结合公司实际业务看，7–8 每次让 AI 写代码时对照用。

---

## 1. 全局地图：一个请求的旅程

前端类比：你熟悉的 `fetch('/api/orders/1')`，在浏览器里发出去以后，到了后端大概经历这些：

```
HTTP 请求
  → Filter / Interceptor（类似前端的 axios 拦截器 / 路由守卫：鉴权、日志、跨域）
  → Controller（类似路由处理函数：解析参数，调用业务）
  → Service（业务逻辑，类似你抽出来的 hooks / store actions）
  → Repository / Mapper（访问数据库，类似封装好的 api 层）
  → MySQL / ClickHouse / Redis / 其他服务
  ← 一路返回，Controller 把结果序列化成 JSON
  ← 统一异常处理（@ControllerAdvice，类似 React 的 ErrorBoundary）
```

**核心思想**：前端的状态主要活在浏览器内存里，丢了刷新就好；后端的状态活在数据库里，**写错了就是真的错了**，而且同时可能有成百上千个请求在改同一份数据。后端大部分"复杂概念"（事务、锁、幂等）都是为了解决这两件事：**数据持久且正确**、**并发下仍然正确**。

---

## 2. Spring Boot 分层

| 层 | 职责 | 前端类比 | 常见注解 |
|---|---|---|---|
| Controller | 接收 HTTP 请求、参数校验、返回响应 | 路由 + 页面组件的"入口" | `@RestController` `@GetMapping` `@PostMapping` `@RequestBody` `@PathVariable` |
| Service | 业务规则、编排多个数据操作、事务边界 | 业务 hooks / store 的 action | `@Service` `@Transactional` |
| Repository / Mapper | 只负责读写数据库 | api 请求层 | `@Repository`（JPA）或 `@Mapper`（MyBatis） |
| Entity / PO / DO | 和数据库表一一对应的类 | 后端返回的原始数据类型 | `@Entity` `@Table` 或纯 POJO |
| DTO / VO | 接口入参出参的形状 | 你写的 TS `interface` | 纯类，常配合 `@Valid` `@NotNull` |

长这样（极简示例）：

```java
@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;           // 依赖注入，见第 3 节
    public OrderController(OrderService orderService) { this.orderService = orderService; }

    @PostMapping
    public OrderVO create(@Valid @RequestBody CreateOrderDTO dto) {
        return orderService.create(dto);
    }
}

@Service
public class OrderService {
    private final OrderMapper orderMapper;
    // ...
    @Transactional
    public OrderVO create(CreateOrderDTO dto) { /* 业务规则 + 写库 */ }
}
```

**为什么要分层**：和前端把"展示组件"和"数据逻辑"分开是一个道理，方便替换、测试、复用。同一个 Service 可以被 HTTP 接口、定时任务、MQ 消费者同时调用。

**国内公司常见**：持久层多用 **MyBatis / MyBatis-Plus**（手写或半自动 SQL，SQL 在 XML 或注解里），而不是 JPA。先确认你们项目用哪个，让 AI 生成代码时要说清楚。

**审 AI 代码时看什么**
- Controller 里有没有写业务逻辑、直接调 Mapper？（应该只做"接参数→调 Service→返回"）
- 有没有把 Entity 直接当接口返回？（会把内部字段、密码等暴露出去，也让表结构和接口绑死）应该转成 VO/DTO。
- 入参 DTO 有没有加校验注解（`@NotNull` `@Size` 等）且 Controller 上写了 `@Valid`？
- 新增代码有没有遵循项目已有的包结构、命名、统一返回体（很多公司有 `Result<T>` / `R<T>` 包装）。

---

## 3. IoC 与依赖注入（DI）

**前端类比**：React 的 Context / Provider。组件不自己 `new` 一个 store，而是从上层"注入"。Spring 就是一个巨大的全局 Provider，叫 **容器（ApplicationContext）**，里面放的对象叫 **Bean**。

- **IoC（控制反转）**：对象不再自己创建依赖，而是交给容器创建并组装。
- **DI（依赖注入）**：容器把依赖"塞"给你，推荐用**构造器注入**（上面示例那样，或 Lombok 的 `@RequiredArgsConstructor` + `final` 字段）。
- 被 `@Component` `@Service` `@Repository` `@Controller` `@Configuration`/`@Bean` 标记的类会被容器管理。
- Bean 默认是**单例**：整个应用只有一个 `OrderService` 实例，被所有请求共享。

**这一点非常关键**：单例意味着**不要在 Service 里放会变的成员变量**（比如把当前用户、当前订单存成字段），否则并发请求会互相串数据。前端里类比"把请求级数据存在全局模块变量里"。

**AOP（面向切面）** 顺带一提：`@Transactional`、日志切面、权限注解，本质是 Spring 用**代理对象**包住你的 Bean，在方法前后插入逻辑，类似前端的高阶函数 / 装饰器 / 中间件。理解"代理"能解释第 4 节里事务失效的坑。

**审 AI 代码时看什么**
- 有没有在 Bean 里 `new` 另一个 Service（绕过了容器，注入和事务都会失效）？
- 单例 Bean 里有没有可变的实例字段在存请求数据？
- 有没有大量 `@Autowired` 字段注入？能用但不推荐，构造器注入更清晰、可测。
- 循环依赖（A 依赖 B，B 依赖 A）通常是设计信号不对，别让 AI 用配置强行绕过。

---

## 4. 事务（@Transactional）

**前端类比**：你提交一个表单要连续调三个接口，第二个失败了，第一个已经生效，数据就"半成品"了。事务就是让一组数据库操作**要么全成功，要么全回滚**。

**ACID** 一句话版：
- **A 原子性**：全做或全不做
- **C 一致性**：事务前后数据满足约束（比如余额不能为负）
- **I 隔离性**：并发事务互不干扰到什么程度（见 5.3）
- **D 持久性**：提交了就不会丢

**Spring 里的用法**：在 Service 方法上加 `@Transactional`，方法正常返回就提交，抛异常就回滚。

**经典坑（AI 很常犯，务必记住）**
1. **同类内部调用不生效**：`this.methodB()` 调用自己类里带 `@Transactional` 的方法，不走代理，事务不生效。
2. **默认只对 RuntimeException 回滚**：抛受检异常（`Exception` 子类但不是 `RuntimeException`）不回滚，需要 `@Transactional(rollbackFor = Exception.class)`。
3. **异常被 try-catch 吞掉**：catch 了没再抛，Spring 以为成功，直接提交。
4. **方法不是 public**：代理拦不到。
5. **事务里干慢活**：在事务方法里调用第三方 HTTP、发消息、大循环，会长时间占用数据库连接和锁，高并发下拖垮数据库。事务要**短**。
6. **事务和外部副作用不一致**：事务里发了 MQ / 调了支付，然后数据库回滚了，消息却发出去了。需要"提交后再发"或本地消息表等方案（让 AI 解释这块时可以追问"事务提交后再发送"怎么做）。

**审 AI 代码时看什么**
- 有多次写库的业务方法有没有 `@Transactional`？只读查询一般不需要（或用 `readOnly = true`）。
- 有没有上面 1–6 里任何一条。
- 事务注解是加在 Service 上，而不是 Controller 或 Mapper 上。

---

## 5. MySQL

MySQL 是 **OLTP**（在线事务处理）数据库：擅长大量小而快的读写，比如"创建订单""查某个用户的信息"，要求强一致。

### 5.1 数据建模

**前端类比**：设计 TS 类型 + 设计 Redux 的 normalized state（按 id 拆表、用 id 引用，而不是嵌套复制）。

- **主键**：通常是自增 `bigint` 或雪花 ID。别用业务字段（手机号、订单号）当主键。
- **范式**：同一份数据只存一处，用外键 id 关联（如订单表存 `user_id`，不复制用户名）。为了查询性能，有时**有意冗余**，这是权衡，要说得出理由。
- **字段类型**：金额用 `DECIMAL`（**绝不用 float/double**），时间用 `DATETIME`/`TIMESTAMP`，状态用 `TINYINT` 或短 `VARCHAR`，长度给够但别滥用 `TEXT`。
- **常见约定字段**：`id`、`create_time`、`update_time`、`deleted`（逻辑删除）、有时 `version`（乐观锁）。
- **一对多 / 多对多**：多对多需要中间表（如 `user_role`）。
- 很多公司**不在数据库里建外键约束**，由代码保证关联正确，这是常见的工程选择，不是 AI 的错误。

### 5.2 索引（最值得花时间的一节）

**前端类比**：数组 `find` 是全表扫描 O(n)；建一个 `Map<id, item>` 就是索引 O(1)/O(log n)。代价是写入时也要维护这个 Map，占空间。

- InnoDB 索引是 **B+ 树**，数据本身按主键组织（**聚簇索引**）；其他索引叫**二级索引**，叶子存的是主键，查完还要"回表"拿整行。
- **联合索引 + 最左前缀**：索引 `(user_id, status, create_time)` 能服务 `where user_id=?`、`where user_id=? and status=?`，但**不能**服务只有 `where status=?` 的查询。像查字典先按第一个字母排。
- **覆盖索引**：查询的字段都在索引里，不用回表，更快。
- **索引失效的常见写法**：对索引列用函数（`DATE(create_time) = ...`）、隐式类型转换（字符串列用数字比较）、`LIKE '%xx'` 前导模糊、`OR` 混用、不符合最左前缀。
- **区分度低的列单独建索引意义不大**（比如只有 0/1 的 `deleted`）。
- 索引不是越多越好，每个索引都让写入变慢。

**怎么验证**：`EXPLAIN SELECT ...`，重点看 `type`（`ALL` 是全表扫描，要警惕；`ref`/`range`/`const` 较好）、`key`（用了哪个索引）、`rows`（预估扫描行数）、`Extra`（出现 `Using filesort`、`Using temporary` 要留意）。

### 5.3 事务隔离级别

并发事务互相能"看到"多少，从弱到强：

| 级别 | 可能出现的问题 |
|---|---|
| 读未提交 | 脏读（读到别人没提交的数据） |
| 读已提交 | 不可重复读（同一事务两次读同一行，结果不同） |
| **可重复读（MySQL 默认）** | 理论上的幻读，InnoDB 通过 MVCC + 间隙锁大幅缓解 |
| 串行化 | 最安全最慢 |

**MVCC** 一句话：每行有多个版本，读操作看的是"事务开始时的快照"，所以普通读不加锁、读写不互相阻塞。类比前端的不可变数据 / 快照。

### 5.4 锁与并发

经典场景：库存还剩 1，两个人同时下单，都读到 1，都扣减，库存变成 -1。这在前端几乎遇不到，在后端是日常。

几种解法，AI 写扣库存/扣余额类代码时**必须用其中一种**：
- **原子更新**：`UPDATE stock SET num = num - 1 WHERE id = ? AND num >= 1`，看影响行数是否为 1。最简单也最常用。
- **乐观锁**：表里有 `version` 字段，`UPDATE ... SET version = version + 1 WHERE id = ? AND version = ?`，失败就重试或提示。冲突少的场景好用。
- **悲观锁**：`SELECT ... FOR UPDATE`，在事务中锁住这行。冲突多时用，注意锁的范围和持有时间。
- **分布式锁**（Redis 等）：多实例、跨库的场景。

**行锁要命中索引**：`FOR UPDATE` / `UPDATE` 的 where 条件没走索引，可能锁住大量行甚至近似锁表。

**死锁**：两个事务互相等对方的锁。常见原因是不同代码以不同顺序更新同几行数据。MySQL 会检测并回滚一方，代码要能处理。

**幂等**（顺带）：同一个请求被重复提交（用户双击、网络重试、MQ 重投），结果应该和提交一次一样。常见手段：唯一索引、请求 token、状态机判断。前端防双击只是体验，**后端必须兜底**。

### 5.5 慢查询与常见性能问题

- **N+1 查询**：查 100 个订单，再循环 100 次查每个订单的用户。前端类比：在 `map` 里逐个 `await fetch`。应该批量查（`WHERE id IN (...)`）或 JOIN。AI 非常爱写这个。
- **深分页**：`LIMIT 1000000, 20` 会扫一百万行再丢掉。可改为"游标分页"（`WHERE id > 上一页最后的id LIMIT 20`）。
- **`SELECT *`**：多取字段、无法覆盖索引。
- **大事务 / 大批量写**：一次更新几十万行，锁多、主从延迟大，应分批。
- **在循环里单条 insert**：改成批量插入。
- 线上排查：慢查询日志 + `EXPLAIN`。

**审 AI 写的 SQL / Mapper 时看什么**
- 每条查询的 where 条件有没有对应索引？新建表时 AI 有没有同时给出索引设计？
- 有没有 N+1、深分页、`SELECT *`、循环里查库/写库？
- 金额是不是 `DECIMAL`？时间字段时区处理是否一致？
- 并发写同一行时用了哪种方案（原子更新 / 乐观锁 / 悲观锁）？
- 是否用了参数化（MyBatis 用 `#{}`），**不能用 `${}` 拼接用户输入**（SQL 注入）。

---

## 6. ClickHouse（CK）

### 6.1 它和 MySQL 是两种东西

| | MySQL（OLTP） | ClickHouse（OLAP） |
|---|---|---|
| 典型问题 | "这个订单的状态是什么" | "过去 30 天每天各渠道的订单量和 GMV" |
| 存储方式 | **行存**：一行的所有字段放在一起 | **列存**：同一列的数据放在一起，压缩率高 |
| 擅长 | 按主键/索引精确读写少量行，高频小事务 | 扫描海量行但只读几列，做聚合（sum/count/group by） |
| 不擅长 | 亿级数据的复杂统计 | 频繁的单行更新/删除、事务、高并发点查 |
| 更新删除 | 常规操作 | 代价高的异步 "mutation"，尽量避免 |
| 事务 | 完整支持 | 基本没有你熟悉的那种事务 |

**前端类比**：行存像数组里放对象 `[{a,b,c}, {a,b,c}]`；列存像 `{a:[...], b:[...], c:[...]}`。算 `sum(b)` 时，列存只需要扫 `b` 这一个数组。

**通常的架构**：业务数据写 MySQL → 通过同步（Binlog、Kafka、定时任务等）进入 CK → 报表、数据看板、分析查询走 CK。所以你看到"同一个业务数据在两边都有"是正常的。问清楚你们公司数据怎么流进 CK 的。

### 6.2 MergeTree 基础

CK 最常用的表引擎是 **MergeTree 家族**：

```sql
CREATE TABLE events (
    event_date Date,
    user_id    UInt64,
    event_type LowCardinality(String),
    amount     Decimal(18, 2)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(event_date)   -- 分区：按月切成多个目录，方便按时间裁剪和删除旧数据
ORDER BY (event_type, event_date, user_id);  -- 排序键：决定数据怎么排、"稀疏主键索引"怎么建
```

- **ORDER BY（排序键）是 CK 里最重要的设计决策**：查询常用的过滤条件应该放在前面，类似 MySQL 联合索引的最左前缀思想。它不保证唯一。
- **PARTITION BY**：一般按时间（天/月），分区不要太细，否则文件过多。
- **数据写入是追加 + 后台合并（merge）**，所以要**批量写入**，不要一条一条插（每次插入都会生成一个数据片段）。
- **ReplacingMergeTree**：按排序键去重，保留最新版本，但**去重发生在后台合并时，不是立刻**，查询时可能看到重复，需要 `FINAL` 或 `argMax` 等写法。AI 很容易忽略这一点。
- **SummingMergeTree / AggregatingMergeTree + 物化视图**：预聚合，用于加速固定报表。

### 6.3 什么时候用哪个

- 需要事务、频繁更新、按 id 查详情 → MySQL
- 需要大范围统计、报表、日志/埋点分析、数据量很大且基本只追加 → ClickHouse
- **在 MySQL 上做大报表**会拖垮业务库；**在 CK 上做业务写入/频繁更新**会很痛苦。

**审 AI 写的 CK 代码时看什么**
- 是不是在用 CK 做逐条写入、频繁 UPDATE/DELETE？
- 表的 ORDER BY 是否贴合主要查询的过滤条件？分区粒度是否合理？
- 用 ReplacingMergeTree 时，查询有没有处理"还没合并的重复数据"？
- 查询有没有带上分区/时间范围条件？有没有不必要的 `SELECT *`？
- JOIN：CK 的 JOIN 默认会把右表加载到内存，右表应尽量小。

---

## 7. 其他后端常识（每次都该检查的）

- **统一异常处理**：`@RestControllerAdvice` 把异常转成统一错误响应。业务错误用自定义业务异常，别到处 `return null` 或吞异常。
- **参数校验**：前端校验是体验，**后端校验是安全**。永远不要信任前端传来的数据（包括价格、用户 id、权限相关字段）。
- **鉴权与越权**：接口不能只看"登录了没"，还要看"这个数据属不属于他"。例如 `GET /orders/{id}` 必须校验订单属于当前用户，否则就是越权漏洞。AI 很常漏掉。
- **日志**：用 SLF4J（`log.info("... {}", x)`），不要 `System.out.println`；不要打印密码、token、身份证等敏感信息。
- **配置**：`application.yml` + 多环境（dev/test/prod）。密钥、密码不能硬编码在代码里。
- **空值**：Java 的 `NullPointerException` 相当于前端的 `Cannot read properties of undefined`。留意 `Optional`、判空。
- **时间与时区**：`LocalDateTime` 没有时区信息，前后端、数据库时区要统一约定。
- **Lombok**：`@Data` `@Getter` `@Builder` 等注解自动生成样板代码，看到不用慌。

---

## 8. 和 AI 协作写后端

### 8.1 提需求时给足上下文

和 AI 说清楚这些，结果会好很多：
- **技术栈**：Java 版本、Spring Boot 版本、MyBatis 还是 MyBatis-Plus 还是 JPA、统一返回体和异常类名称。
- **现有代码风格**：贴一个现有的 Controller/Service/Mapper 作为参照，要求"照这个风格写"。
- **数据**：相关表结构（`SHOW CREATE TABLE` 的结果）、数据量级（几千行还是几亿行）、读写比例。
- **并发和一致性要求**：会不会多人同时操作同一条数据？重复提交怎么办？
- **边界**：哪些字段必填，失败时返回什么。

一个可用的提问模板：

> 项目是 Spring Boot X + MyBatis-Plus，统一返回 `Result<T>`，业务异常用 `BizException`。参考下面这个已有的 Controller/Service 风格。
> 需求：……
> 相关表结构：……（数据量约 N 行，主要查询是 ……）
> 要求：先说你的设计（接口、表/索引改动、事务边界、并发处理），我确认后再写代码。

**"先方案后代码"** 是最值得养成的习惯：方案阶段你能用本指南的概念去挑毛病，代码阶段就只剩对照检查。

### 8.2 让 AI 解释，而不是只让它写

很好用的追问：
- "这个方法的事务边界在哪？如果第 X 步失败，哪些数据会回滚、哪些不会？"
- "两个请求同时修改这条数据会发生什么？"
- "这条 SQL 会走哪个索引？请给出 EXPLAIN 的预期并说明理由。"
- "如果这个接口被重复调用两次会怎样？"
- "这个数据量涨到 1000 万 / 1 亿时，哪里会先出问题？"
- "这里为什么用 MySQL 而不是 CK（或反过来）？"

### 8.3 审查清单（每次 AI 交付代码时过一遍）

**分层与结构**
- [ ] Controller 薄、Service 承担业务、Mapper 只管数据
- [ ] 没有把 Entity 直接返回给前端
- [ ] 遵循项目已有的命名、包结构、返回体、异常体系

**正确性**
- [ ] 多次写库的方法有事务，且没有事务失效的坑（内部调用、吞异常、受检异常）
- [ ] 并发写同一数据有明确方案（原子更新 / 乐观锁 / 悲观锁）
- [ ] 重复请求是幂等的（或说明为什么不需要）
- [ ] 金额用 `DECIMAL` / `BigDecimal`

**性能**
- [ ] 查询条件有索引支撑；新表附带索引设计
- [ ] 没有 N+1、循环查库、深分页、`SELECT *`
- [ ] 事务内没有远程调用、长耗时操作
- [ ] CK：批量写入、排序键合理、查询带时间范围

**安全**
- [ ] 入参有校验；SQL 用 `#{}` 参数化
- [ ] 有数据归属/越权校验
- [ ] 没有硬编码密钥，日志不打敏感信息

**可验证**
- [ ] 能说清怎么测：至少 Service 层有单元测试或给出了手动验证步骤

---

## 下一步建议

1. 找公司项目里一个你熟悉的页面，顺着它调用的接口，从 Controller 一路读到 Mapper 和表结构，对照第 1–2 节画出这条链路。
2. 挑一张核心业务表，`SHOW CREATE TABLE` 看它的字段和索引，再挑几条常用查询 `EXPLAIN` 一下。
3. 问后端同事：数据是怎么同步进 CK 的？CK 主要支撑哪些报表？
4. 下次让 AI 写后端，先用 8.1 的模板要方案，用 8.3 的清单审一遍。
