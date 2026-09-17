# S8 集成约束

依据 [父规格 #8](https://github.com/huanancaoo/enterprise-admin/issues/8) 与 [验证任务 #9](https://github.com/huanancaoo/enterprise-admin/issues/9) 固化。本文记录平台与组织管理的具体权限和实施约束，不表示功能已交付；证据与发布阻塞见 [S8-00 验证](s8-00-validation.md)。

## 平台集成

### 身份与任职

复用 Better Auth User/Session。平台权限只来自独立的 platform_role_assignments：userId 唯一、role、status、version、grantedAt/By、revokedAt/By；一位用户最多一个当前平台角色。组织 owner/admin、自定义角色同名字符串、metadata、URL、Cookie 和客户端状态都不产生平台任职。保留平台角色名称，禁止租户创建。

平台角色只由受控部署 CLI 授予/撤销：输入精确 userId、role、reason，检查用户存在且邮箱已验证，使用独立部署凭据并在同一事务审计。拒绝在线运行凭据；无授予/撤销 HTTP 接口、首位注册者或邮箱域名自动授权。每次平台请求重新检查权威 Session 和有效任职，撤销后旧 Session 的下一请求被拒绝。

| 动作                                   | platform_admin           | platform_auditor   |
| -------------------------------------- | ------------------------ | ------------------ |
| platform.organization:read             | 允许                     | 允许               |
| platform.organization:suspend / resume | 允许                     | 禁止               |
| platform.user:read                     | 脱敏                     | 脱敏               |
| platform.user:readSensitive            | 明示 purpose，审计后返回 | 禁止               |
| platform.audit:read                    | purpose + 范围审计       | purpose + 范围审计 |
| platform.settings:read                 | 安全摘要                 | 安全摘要           |
| platform.settings:update               | 仅平台默认语言           | 禁止               |

没有 Projects 访问、冒充用户、任意 SQL 或平台动态角色。平台人员访问租户 API 仍须有该组织 Membership，并通过普通租户动作和 Domain Policy。

### 当前 Session 的第二因素事实

平台访问要求启用 2FA，且有服务端绑定当前 Session 的 platform_session_assurance(sessionId、verifiedAt、method)。twoFactorEnabled、可信设备 Cookie、客户端 mfaVerified 或通过其他登录方式都不构成第二因素成功事实。平台写操作要求 verifiedAt 在最近 15 分钟内。

使用 Better Auth 第二因素验证能力，不自建验证码算法。只从成功验证入口建立事实，不能在普通登录、启用 2FA 或可信设备登录时自动授予。轮换产生的新 Session 不继承旧事实；删除/撤销/过期的 Session 不可通过孤立 assurance 放行。每个请求先验证 Session。不同登录方式尚未验证时不得开放平台访问。

当前生产配置未启用 2FA，也没有 assurance 存储。独立插件实验不能替代生产 Drizzle 集成验收，详见验证记录。

### 状态与版本的唯一来源

物理表名为 organization_status，表达组织状态；不使用 organization_runtime_state，也不再保留 enabled。该表以 organizationId 为 PK/FK，持有 ACTIVE/SUSPENDED、statusVersion、authorizationVersion、statusChangedAt/By、internalReason。缺失状态失败关闭；新组织由 INSERT 触发器建立 ACTIVE。迁移旧 enabled 时 false → SUSPENDED、true → ACTIVE，核对既有事实后移除旧字段，不能并存两套独立状态。

停用拒绝该组织业务、管理、受保护原生读入口及邀请接受；仍允许全局登录/退出、本人语言设置、最小组织列表、切其他可用组织及拒绝自己的邀请。恢复不重建 Membership、不恢复权限、不延长邀请。

租户写事务与停用、授权变更在组织状态行上使用相冲突的锁，并在锁内重新校验状态/权限。状态/设置变更校验 expectedVersion，原子写入业务、审计和幂等收据。收据范围为 actor + 非空 scopeKey + action + key，保留 24 小时；重放前重新授权，同键不同请求冲突。no_change 仍审计尝试，不重复状态转换事件。

### 固定函数与数据库身份

保持同一 NestJS 模块化单体。Platform 模块独占 platform_runtime Pool，租户 Repository 不得取得该连接。平台身份、MFA 和动作校验通过后，只执行参数化固定函数。

| 身份              | 允许范围                                         | 禁止                                                |
| ----------------- | ------------------------------------------------ | --------------------------------------------------- |
| app_runtime       | 既有认证集成、TenantTx/RLS                       | 平台函数、角色继承、平台授权写、DDL/BYPASSRLS       |
| platform_runtime  | 显式列举的固定函数 EXECUTE                       | 基础表 CRUD、租户业务、SET ROLE 提权、DDL/BYPASSRLS |
| platform_executor | NOLOGIN，固定函数需要的列级读写和专用审计 policy | 超级用户、表 Owner、DDL/BYPASSRLS、平台任职写入     |
| app_migrator      | reviewed migration                               | API 日常凭据                                        |
| 部署授权身份      | 专用 CLI 的任职与审计命令                        | 注入在线 API                                        |

函数清单限定组织 list/get/status transition、用户 list/get/sensitive projection、审计 list/get、平台设置 get/update、当前 actor 任职读取。函数内重新检查可信服务端 actor 的有效任职及固定动作；不接受 SQL、表名或自由 join。actorId 是服务端 Session 解析结果，但数据库不会仅凭该参数证明最终用户身份。

SECURITY DEFINER 函数由最小权限 NOLOGIN 角色持有，固定安全 search_path，显式限定对象名，撤销 PUBLIC EXECUTE，仅向指定角色授予；创建和授权在同一迁移事务完成。为运营审计/设置增加仅面向 executor 的必要 RLS policy，不放宽 Projects/译文，不关闭 row_security。

敏感读取、跨组织审计查询先写成功访问审计再返回；写操作与审计同事务提交。平台审计员的所有响应投影均脱敏，包括组织成员概览和 actor 快照。租户只见 tenantVisible 的组织动作摘要，不见内部理由或平台操作者私人信息。

### 发布门禁

生产迁移需撤销现有 platform_runtime 直接列权限，并验证 PUBLIC、函数、视图、继承及连接池隔离；不能只检查 NOBYPASSRLS。任职表默认无授权。现存 organization.enabled 与语言字段的迁移保持唯一事实，不回写为默认 ACTIVE。

MFA 事实传递、可信 actor/request、组织锁与审计原子性未通过真实故障注入前，相关平台管理能力阻塞。旧 API 不理解停用/撤权约束时不得直接回退上线。实施顺序和完整要求仍以 #8 为准，不能以本 ADR 缩减 S8。

## 组织集成

### 单角色与委派

每个成员和邀请只允许一个角色，服务端拒绝数组、逗号及编码组合。保留 owner/admin/member；自定义角色为组织内唯一的稳定小写 key，3–48 位字母、数字、连字符，禁止内置名称和平台前缀，不允许改 key。S7 project:* 语义保持不变。

权限声明唯一归属 packages/permissions。合并原生 defaultStatements 时按 resource 合并 action，不能用新增 member:read 覆盖原生 member:update/delete。

| 能力      | 规则                                              |
| --------- | ------------------------------------------------- |
| 成员目录  | member:read，member 默认有；不隐含邀请目录权限    |
| 邀请/取消 | invitation:create/cancel + 拟授予角色策略         |
| 修改/移除 | member:update/delete + 目标原角色/拟角色/组织策略 |
| 动态角色  | ac:create/read/update/delete；内置角色只读        |
| 组织设置  | tenantSettings:read/update                        |
| 租户审计  | audit:read                                        |

动态角色授予集合 = 已注册租户动作 ∩ 操作者当前权限 ∩ 服务端显式委派目录。目录包含已启用 project 动作、member:read、invitation:create/cancel、member:update/delete、tenantSettings:read、audit:read；不含 ac 写、tenantSettings:update、组织删除、平台动作、未交付动作或通配符。成员动作仍不允许管理 owner/admin 身份。UI 从服务端取得动态权限快照。

owner 可管理 admin/owner，但始终至少保留一个 owner；admin 不能邀请/任命 admin，不能修改 owner/admin。owner 只能由现有 owner 晋升已有成员，禁止邀请 owner。退出也遵守最后 owner 保护。

### 唯一集成路径及验证门禁

当前公开 auth API 不加入调用方 Drizzle 事务；after hook 审计失败也不能撤销已提交写入。不能选择“外层 transaction 包 auth.api”作为原子性实现。

采用父规格规定的数据库级不变量保护与同事务审计触发器路径，Better Auth 仍执行生命周期。before hook 负责拒绝非法业务输入，不能用单独 count 代替并发保证；after hook 不承载必须原子的成功审计。数据库保护覆盖 member、invitation、organization_role 的真实写入，包含原生 HTTP、服务器内部调用和退出路径。

身份集成必须把可信 actor、requestId、组织目标和版本传入实际执行 Better Auth 写入的数据库事务/连接；禁止对 Pool 任意连接 SET 后假定下次写入复用该连接。没有可信上下文时拒绝管理写入。该连接绑定在本次尚未证明，后续实现不得宣称可上线。

组织范围锁覆盖 owner 变化、角色定义/引用、邀请状态转换及授权版本比较递增。Member 组织/用户唯一、角色组织/key 唯一、有效邀请唯一均需审查锁定 Schema 的实际约束。邀请过期不能以依赖 now() 的 partial index 解决。角色被成员或有效邀请引用时禁止删除；删除与分配必须在同一串行边界内重查。

邀请接受须验证已验证匹配邮箱、ACTIVE、pending/有效期、角色仍可授予、原邀请者仍具资格。状态认领、Membership、Session 变化及审计必须得到一致的外部结果；失败后的补偿不能被当作已证明的原子事务。重复接受不得重复入组，移除后旧邀请不能重建成员。

成员改角色、动态角色更新/删除校验 authorizationVersion；原生客户端使用项目扩展 X-Expected-Authz-Version，服务器特殊邀请入口取当前版本。Session、Membership、动态权限和平台任职不使用陈旧正缓存放行。

### 入口覆盖与职责

Native /api/auth 路由不经过 Nest TenantGuard，必须在认证集成边界执行一致策略。组织创建、更新、删除、组织详情、完整组织、成员/邀请列表、邀请操作、退出、角色 CRUD 和服务器 addMember 均在盘点范围；不能只保护页面使用的路径。

个人语言、组织 defaultLocale、平台默认语言各自唯一；复用已有个人/组织字段并增加所需版本与 nullable 语义，不新建重复事实表。平台状态、会话与固定函数遵循上文平台集成约束。当前仅完成技术验证及决策，未生成或应用 S8 生产迁移。
