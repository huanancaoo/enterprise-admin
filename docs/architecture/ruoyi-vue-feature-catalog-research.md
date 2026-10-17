# RuoYi-Vue 功能目录研究

## 范围与证据版本

调查日期：2026-10-17。对象为官方 **RuoYi-Vue 前后端分离版**，以初始化菜单为目录主轴，以接口与前端路由确认实际能力。本报告是固定源码快照研究，未部署上游系统进行运行验收；不比较本项目，也不提出实施路线。

官方站点的下载入口指向 `y_project/RuoYi-Vue`，官方文档提供 `yangzongzhuan` 的 GitHub 仓库入口。本次据此使用下列官方源码，而非名称相近的社区扩展。[官网][official]、[官方文档][official-docs]

| 证据                    | 固定版本                                                                                                          | 用途                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 官方后端 RuoYi-Vue      | 调查时 `master` 提交 `13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3`，提交日期 2026-08-26；该快照 README 标题为 v3.9.2 | 菜单种子、权限、服务端操作与配置。[提交][backend-commit]、[README][readme]                |
| 官方配套前端 RuoYi-Vue3 | 调查时 `master` 提交 `838965c5a18d2c61b73ec30c6e288057aaa08b63`，提交日期 2026-08-26                              | 页面交互、隐藏路由和开发工具入口。[提交][frontend-commit]、[前端 README][frontend-readme] |
| 初始化数据库            | 后端上述提交的 `sql/ry_20260417.sql`                                                                              | `sys_menu` 层级、菜单权限标识及默认参数。[初始化 SQL][menu-sql]                           |

两个提交号均从 GitHub 的 `refs/heads/master` 提交对象核实，使用的是仓库分支快照，而非某个文件最近修改时的提交号。[后端分支指针][backend-ref]、[前端分支指针][frontend-ref]

后端 README 列出 Vue2、Vue3、TypeScript 前端组合；本报告只用官方 Vue3 JavaScript 前端交叉核实页面，不推断其他前端分支的每项交互完全一致。上述提交是研究基线，不将 README 中的版本标题等同于发布标签。[版本说明][readme]、[配套关系][frontend-readme]

## 初始化功能树

SQL 将 `menu_type` 分为目录 `M`、页面菜单 `C` 和按钮 `F`。按 `C` 计数，共 **19 个页面菜单**：系统管理 10 个、系统监控 6 个、系统工具 3 个；“日志管理”是中间目录，“若依官网”是外链。以下树保留初始化层级。[初始化菜单][menu-sql]

```text
系统管理
├── 用户管理
├── 角色管理
├── 菜单管理
├── 部门管理
├── 岗位管理
├── 字典管理
├── 参数设置
├── 通知公告
└── 日志管理
    ├── 操作日志
    └── 登录日志
系统监控
├── 在线用户
├── 定时任务
├── 数据监控
├── 服务监控
├── 缓存监控
└── 缓存列表
系统工具
├── 表单构建
├── 代码生成
└── 系统接口
若依官网（外链）
```

README 的“内置功能”是 18 项概述，名称与页面并非一一对应：“在线构建器”对应“表单构建”，“连接池监视”对应“数据监控”；初始化菜单还将缓存概览与缓存列表分为两页。因此目录数量按 SQL 计算，不按 README 条目编号计算。[功能概述][readme]、[菜单定义][menu-sql]

## 页面功能与权限标识

下表的“菜单权限标识”取自 `sys_menu.perms`，用于识别菜单配置，**不等于该页面全部操作权限**。增删改、导入导出等动作还应查看对应接口的 `@PreAuthorize`；例如用户菜单是 `system:user:list`，重置密码使用 `system:user:resetPwd`。[菜单种子][menu-sql]、[用户接口][user]

### 系统管理

| 页面                | 菜单权限标识              | 已核实的能力与边界                                                                                                  | 一手证据                                                                       |
| ------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 用户管理            | `system:user:list`        | 维护账户、调整状态、重置密码、分配角色；提供 Excel 导入、导入模板和导出。                                           | [菜单][menu-sql]、[用户接口][user]                                             |
| 角色管理            | `system:role:list`        | 维护角色与状态、分配菜单和数据范围；管理已授权及待授权用户，支持撤销授权和导出。                                    | [菜单][menu-sql]、[角色接口][role]                                             |
| 菜单管理            | `system:menu:list`        | 维护目录、页面和按钮权限配置，提供菜单树、角色菜单树及排序操作。                                                    | [菜单][menu-sql]、[菜单接口][menu]                                             |
| 部门管理            | `system:dept:list`        | 维护部门层级、部门资料及排序。                                                                                      | [菜单][menu-sql]、[部门接口][dept]                                             |
| 岗位管理            | `system:post:list`        | 维护岗位资料及状态，查询岗位选项并导出。                                                                            | [菜单][menu-sql]、[岗位接口][post]                                             |
| 字典管理            | `system:dict:list`        | 维护字典类型及其条目，按类型读取数据，支持导出与字典缓存刷新；条目页是关联隐藏路由。                                | [菜单][menu-sql]、[类型接口][dict-type]、[数据接口][dict-data]、[路由][router] |
| 参数设置            | `system:config:list`      | 维护系统配置键值，按键获取参数，导出和刷新参数缓存。                                                                | [菜单][menu-sql]、[参数接口][config]                                           |
| 通知公告            | `system:notice:list`      | 维护标题、类型、状态及富文本内容；支持已读标记和阅读用户查询。首页接口最多返回 5 条公告，未读计数仅统计该返回集合。 | [菜单][menu-sql]、[公告接口][notice]、[公告页面][notice-ui]                    |
| 日志管理 → 操作日志 | `monitor:operlog:list`    | 查询、导出、删除及清空操作记录；日志由标注 `@Log` 的业务操作采集，可记录成功与异常。                                | [菜单][menu-sql]、[日志接口][operlog]、[日志切面][log]                         |
| 日志管理 → 登录日志 | `monitor:logininfor:list` | 查询、导出、删除及清空登录记录；账户解锁动作清理该用户名的密码登录记录缓存，不是修改用户启停状态。                  | [菜单][menu-sql]、[登录记录接口][logininfor]                                   |

“日志管理”本身没有独立的菜单权限字符串；它的两个子页面虽然显示在“系统管理”下，权限前缀仍是 `monitor`。[目录及子项定义][menu-sql]

### 系统监控

| 页面     | 菜单权限标识          | 已核实的能力与边界                                                                                                                  | 一手证据                                                                   |
| -------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 在线用户 | `monitor:online:list` | 按用户名、IP 查询在线会话；页面提供对指定会话 token 的强退。当前接口和页面不支持据 SQL 的“批量强退”按钮种子直接推断批量操作已接入。 | [菜单及按钮][menu-sql]、[在线接口][online]、[在线页面][online-ui]          |
| 定时任务 | `monitor:job:list`    | 维护 Quartz 任务、调整状态、立即执行及导出；关联执行日志可查询、导出、删除与清空，日志页不是额外一级菜单。                          | [菜单][menu-sql]、[任务接口][job]、[执行日志接口][job-log]、[路由][router] |
| 数据监控 | `monitor:druid:list`  | 内嵌 Druid 监控入口，用于连接池及 SQL 统计分析；实际开放与登录受 Druid 部署配置控制。                                               | [菜单][menu-sql]、[页面入口][druid-ui]、[监控配置][druid-config]           |
| 服务监控 | `monitor:server:list` | 展示服务器和 JVM 资源信息，例如 CPU、内存与磁盘；这是当前服务资源监控页面。                                                         | [菜单][menu-sql]、[服务接口][server]、[功能概述][readme]                   |
| 缓存监控 | `monitor:cache:list`  | 读取 Redis 信息、命令统计和键数量，形成缓存概览。                                                                                   | [菜单][menu-sql]、[缓存接口][cache]                                        |
| 缓存列表 | `monitor:cache:list`  | 浏览缓存名称、键和值，并按名称、单键或全部清理；与缓存监控共用菜单权限。清理接口也使用该 `:list` 权限，不能把名字解释为只读授权。   | [菜单][menu-sql]、[缓存接口][cache]                                        |

### 系统工具

这三项服务于开发与调试，应与业务功能区分。[工具菜单][menu-sql]、[表单构建源码][build]、[生成接口][gen]、[系统接口入口][swagger]

| 页面     | 菜单权限标识        | 已核实的能力与边界                                                                                   | 一手证据                                                            |
| -------- | ------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 表单构建 | `tool:build:list`   | 拖拽组合输入、选择和布局组件，复制或下载生成的前端表单代码。                                         | [菜单][menu-sql]、[构建页面][build]                                 |
| 代码生成 | `tool:gen:list`     | 导入数据库表结构，配置生成信息与字段，同步结构，预览、下载或批量生成代码。另有管理员限定的建表入口。 | [菜单][menu-sql]、[生成接口][gen]                                   |
| 系统接口 | `tool:swagger:list` | 打开 Swagger UI，查看和调试 API 文档。                                                               | [菜单][menu-sql]、[页面入口][swagger]、[Springdoc 配置][api-config] |

## 不在初始化菜单树中的页面

### 固定入口与个人辅助功能

官方前端将下列页面定义在固定路由中，而不是由上述 `sys_menu` 叶菜单生成。首页可显示在导航中；“隐藏”表示路由配置为 `hidden: true`，不等于未经身份或权限检查即可访问。[固定路由][router]、[导航守卫][permission-ui]

| 页面或入口   | 路由与显示方式                                    | 实际能力或限制                                                                                        | 一手证据                                                                                               |
| ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 首页         | `/index`，固定首页入口                            | 默认跳转入口，独立于初始化菜单表。                                                                    | [固定路由][router]                                                                                     |
| 登录与退出   | `/login` 隐藏；退出由 `/logout` 接口处理          | 用户名、密码和验证码登录；服务端返回当前用户、角色、权限与动态菜单。验证码可由参数控制。              | [路由][router]、[登录请求][login-body]、[登录接口][login]、[验证码接口][captcha]、[安全配置][security] |
| 注册         | `/register`，隐藏                                 | 存在自助注册入口，但初始化参数 `sys.account.registerUser=false`，默认不开放；后端按参数判断是否允许。 | [路由][router]、[默认参数][menu-sql]、[注册接口][register]                                             |
| 个人中心     | `/user/profile/:activeTab?`，隐藏                 | 查看和修改个人资料、头像及密码，属于当前用户自助操作。                                                | [路由][router]、[个人资料接口][profile]、[个人中心页面][profile-ui]                                    |
| 锁定屏幕     | `/lock`，隐藏                                     | 前端进入锁屏状态，解锁接口验证当前用户密码。                                                          | [路由][router]、[导航守卫][permission-ui]、[解锁接口][lock]                                            |
| 错误与重定向 | `/401`、404 匹配路由、`/redirect/:path(.*)`，隐藏 | 权限失败、未匹配路径及页面重定向辅助页。                                                              | [固定路由][router]                                                                                     |

### 菜单内部的隐藏关联页

以下均在前端声明 `hidden: true`，由既有功能进入；它们扩展父页面操作，不再计入 19 个菜单页面。路由中的 ID 还有限定数字格式，表中省略正则以便阅读。[动态路由][router]

| 隐藏关联页   | 路由                              | 归属与路由权限                                                        |
| ------------ | --------------------------------- | --------------------------------------------------------------------- |
| 分配角色     | `/system/user-auth/role/:userId`  | 用户管理，`system:user:edit`。[路由][router]、[用户接口][user]        |
| 分配用户     | `/system/role-auth/user/:roleId`  | 角色管理，`system:role:edit`。[路由][router]、[角色接口][role]        |
| 字典数据     | `/system/dict-data/index/:dictId` | 字典管理，`system:dict:list`。[路由][router]、[数据接口][dict-data]   |
| 调度日志     | `/monitor/job-log/index/:jobId`   | 定时任务，`monitor:job:list`。[路由][router]、[执行日志接口][job-log] |
| 修改生成配置 | `/tool/gen-edit/index/:tableId`   | 代码生成，`tool:gen:edit`。[路由][router]、[生成接口][gen]            |

## 非独立菜单能力与解释边界

- **权限控制**：登录信息包含角色和权限，菜单由当前用户的菜单树生成；服务端操作通过权限注解校验。前端导航显隐与服务端操作授权应分开理解。[登录与菜单接口][login]、[用户动作授权示例][user]
- **数据范围**：角色可配置全部、自定义部门、本部门、本部门及子部门、本人等范围；`DataScopeAspect` 对适用查询施加部门或用户条件。该机制按部门或用户约束适用查询的数据范围。[角色接口][role]、[数据范围实现][data-scope]
- **操作日志采集**：切面围绕 `@Log` 标注的方法采集结果、异常及相关请求信息，并排除密码等字段；这不能等同于记录全部 HTTP 请求的访问日志。[日志实现][log]
- **菜单不是完整行为合同**：SQL 同时包含目录、页面与按钮种子；在线用户的 `monitor:online:batchLogout` 存在于种子中，但固定版本的页面只调用单会话强退接口。因此功能目录以菜单确定位置，以实际页面和接口确认操作。[种子][menu-sql]、[页面][online-ui]、[接口][online]
- **版本与产品范围**：本报告只覆盖上述官方 RuoYi-Vue 源码快照及配套 Vue3 前端，不将 RuoYi-Cloud 的微服务控制台，或 RuoYi-Vue-Plus、ruoyi-vue-pro 等社区项目的租户、工作流、支付、商城能力并入目录。其他前端或后端分支应另行核对；官方快速了解页不作为本报告的当前技术版本依据。[官方版本说明][readme]、[前端配套说明][frontend-readme]

## 主要来源

- [官方站点][official]与[官方文档][official-docs]：核实官方项目入口。
- [固定后端 README][readme]与[固定前端 README][frontend-readme]：功能概述、版本及前后端配套边界。
- [初始化 SQL][menu-sql]：菜单层级、权限标识和初始参数。
- [官方前端路由][router]：固定入口、隐藏关联页和路由权限。
- 各页面表格已逐项链接固定提交下的 Controller、页面及配置，作为具体操作能力的证据。

[official]: https://ruoyi.vip/
[official-docs]: https://doc.ruoyi.vip/
[backend-ref]: https://api.github.com/repos/yangzongzhuan/RuoYi-Vue/git/ref/heads/master
[frontend-ref]: https://api.github.com/repos/yangzongzhuan/RuoYi-Vue3/git/ref/heads/master
[backend-commit]: https://github.com/yangzongzhuan/RuoYi-Vue/commit/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3
[frontend-commit]: https://github.com/yangzongzhuan/RuoYi-Vue3/commit/838965c5a18d2c61b73ec30c6e288057aaa08b63
[readme]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/README.md
[frontend-readme]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/README.md
[menu-sql]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/sql/ry_20260417.sql
[router]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/router/index.js
[user]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysUserController.java
[role]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysRoleController.java
[menu]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysMenuController.java
[dept]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysDeptController.java
[post]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysPostController.java
[dict-type]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysDictTypeController.java
[dict-data]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysDictDataController.java
[config]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysConfigController.java
[notice]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysNoticeController.java
[notice-ui]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/system/notice/index.vue
[operlog]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/monitor/SysOperlogController.java
[logininfor]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/monitor/SysLogininforController.java
[online]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/monitor/SysUserOnlineController.java
[online-ui]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/monitor/online/index.vue
[job]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-quartz/src/main/java/com/ruoyi/quartz/controller/SysJobController.java
[job-log]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-quartz/src/main/java/com/ruoyi/quartz/controller/SysJobLogController.java
[druid-ui]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/monitor/druid/index.vue
[druid-config]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/resources/application-druid.yml
[server]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/monitor/ServerController.java
[cache]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/monitor/CacheController.java
[build]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/tool/build/index.vue
[gen]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-generator/src/main/java/com/ruoyi/generator/controller/GenController.java
[swagger]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/tool/swagger/index.vue
[api-config]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/resources/application.yml
[login]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysLoginController.java
[login-body]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-common/src/main/java/com/ruoyi/common/core/domain/model/LoginBody.java
[captcha]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/common/CaptchaController.java
[register]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysRegisterController.java
[security]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-framework/src/main/java/com/ruoyi/framework/config/SecurityConfig.java
[profile]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysProfileController.java
[profile-ui]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/views/system/user/profile/index.vue
[lock]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-admin/src/main/java/com/ruoyi/web/controller/system/SysIndexController.java
[permission-ui]: https://github.com/yangzongzhuan/RuoYi-Vue3/blob/838965c5a18d2c61b73ec30c6e288057aaa08b63/src/permission.js
[data-scope]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-framework/src/main/java/com/ruoyi/framework/aspectj/DataScopeAspect.java
[log]: https://github.com/yangzongzhuan/RuoYi-Vue/blob/13db1fcef36bee9ce45d2d636a1d4e8f5ed5bbc3/ruoyi-framework/src/main/java/com/ruoyi/framework/aspectj/LogAspect.java
