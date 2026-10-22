# 平台文件库与公告链路验收

日期：2026-10-22。对应[实施规格](platform-files-spec.md)。

## 验收范围

平台文件库具备目录、上传与同名覆盖、搜索、预览下载、历史版本、移动改名、回收恢复、永久删除、批量操作和独立存储策略；动作接入平台角色授权。公告正文图片与附件可选择文件库中的固定版本，读者通过公告受众授权读取该版本。

正式 HTTP 与浏览器测试分别在 Linux Local 和项目固定的 RustFS S3 后端运行，使用真实认证、迁移、数据库角色及文件字节；浏览器访问生产构建产物。组件测试使用 Storybook/MSW，不替代这条业务链路。

## 完整业务路径

- 创建目录并上传文件，覆盖生成第二个版本；预览与下载校验实际内容。
- 公告选取历史附件版本，保存并发布到指定组织；受众实际下载的内容仍是旧版本。非受众、未被公告引用的新版本、撤回后的公告媒体均拒绝访问。
- 正文图片从文件库选择旧版本，保存与发布后读取原图字节；图片选择结果只传递文件 ID 与版本 ID，避免附加展示字段违反严格引用契约。
- 公告引用阻止回收文件及其祖先目录，并保护到期历史版本。Local/RustFS 的 HTTP 增量测试直接验证文件、父目录和上级目录均返回 `FILE_REFERENCED`。移除引用后，回收、恢复和保留维护按文件生命周期执行。
- 文件库及公告文件选择器分别切换中文、英文、阿拉伯语；验证页面方向、边界无横向溢出、可选文件加载完成，以及 Escape 关闭后的焦点返回。
- 独立角色的读取、上传、修改权限及即时撤权均经过 HTTP 验证；公告管理权限不隐含文件管理权限。
- 文件库与任务结果使用独立物理归属；即使上传文件名等于任务资源 UUID，同名上传、回收和永久删除也不改变任务文件字节。

## 迁移与本机证据

迁移链延伸至 `0108_platform-import-upgrade-boundary.sql`。真实迁移测试覆盖从旧公告资源升级、重复运行、最小授权、RLS，以及旧导入仍持有效租约、已复制部分对象或已有部分导入完成时拒绝升级并回滚。

升级前必须先由旧服务完成已有操作的恢复与结算，再停止旧服务执行迁移。全新旧资源导入计划可由新服务执行；不能让两个归属不同的执行器同时写入。

本机个人开发数据库 `localhost:5433` 已应用至 0108。本机使用 S3 存储，迁移前后逐版本读取的 **8 个文件、575 字节**全部通过长度与 SHA-256 比对，旧公告导入和存储归属迁移均完成。本机平台页面还实际打开了迁入的历史图片并显示预览。

## 自动化结果

验收分层运行，未将这些结果表述为一次 `pnpm verify` 的执行结果。

| 检查                                         | 结果                                                                         |
| -------------------------------------------- | ---------------------------------------------------------------------------- |
| 工程、API 和文档单元测试                     | 288 + 302 + 41 = 631 项通过                                                  |
| Nest HTTP 启动测试                           | 15 项通过                                                                    |
| 数据库及隔离                                 | 209 项通过                                                                   |
| 平台文件专项 HTTP                            | Local/RustFS 共 28 项通过                                                    |
| 全量 API HTTP                                | 59 个文件、666 项全部通过                                                    |
| 全量浏览器业务测试                           | 286 项完成验证：其余 185 项全量通过，曾失败的四个文件完整重跑 101 项全部通过 |
| Storybook 组件交互及无障碍                   | 857 项通过；最后修改涉及的 61 项再次通过                                     |
| HTTP 性能                                    | 2 项通过                                                                     |
| lint、类型、三语、文档、Schema、构建及生成物 | 全部通过；生产构建 13 个任务成功，OpenAPI/Orval 重新生成无漂移               |

首次全量 HTTP 运行有两项故障恢复测试超时；两项分别在 Local/RustFS 重跑通过，随后全量 666 项通过。浏览器首次全量为 277 项通过、9 项失败：两处旧搜索文案、一处管理员新增文件导航、五处双设置表单的旧定位、一处在初次查询结束前按 Enter 的成员搜索时序。前八项修正对应断言范围；搜索测试等待表单结束加载后才按 Enter，不修改产品的查询语义。四个受影响文件随后完整重跑，结果见上表。

### 实际运行入口

以下命令均在仓库根目录运行。测试运行前已执行 `pnpm release:prepare` 并构建 API、Worker、tenant、platform；随后直接调用对应 Vitest project，避免测试期间重建其挂载的产物。

```sh
pnpm peers check
pnpm lint
pnpm typecheck
pnpm i18n:check
pnpm --filter docs check:content
pnpm test:unit
pnpm --filter api test:e2e
pnpm exec vitest run --config vitest.config.mjs --project api
pnpm --filter @workspace/database test:database
pnpm --filter storybook test --maxWorkers=2
pnpm exec vitest run --config vitest.config.e2e.mjs
pnpm exec vitest run --config vitest.config.e2e.mjs tests/e2e/auth.test.mjs tests/e2e/platform-settings.test.mjs tests/e2e/navigation.test.mjs tests/e2e/files.test.mjs
pnpm exec vitest run --config vitest.config.mjs --project performance
pnpm db:check
pnpm build
pnpm api:check
```

最后受影响的组件增量通过 `pnpm --filter storybook test invitation-directory.stories announcements/pages.stories --maxWorkers=1` 复跑。平台文件专项入口为 `tests/api/platform-files.test.mjs` 与 `tests/e2e/platform-files.test.mjs`，后者已包含在全量浏览器结果中。

祖先目录保护增量使用 `pnpm exec vitest run --config vitest.config.mjs --project api tests/api/platform-files.test.mjs -t '公告复用固定文件版本'`，两种存储下共 2 项通过；同文件其余 26 项因名称筛选跳过，其先前全量结果已计入上表。

## 审查

### 规格审查

独立审查最终未发现剩余阻断项。特别复核了导入升级的租约、半完成对象、部分完成状态以及停止旧服务的前提；迁移失败回滚另由真实数据库测试证明。

### 代码规范审查

独立审查最终未发现剩余阻断项。特别复核了图片引用投影、附件选择后等待按钮恢复可用再归还焦点，以及富文本选择期间的取消、映射和清理。

最后四个浏览器测试文件的增量再次只读复审通过：等待真实可提交状态、精确限定语言表单、按角色断言完整导航，均未放宽业务及授权校验。

## 证据边界

以上为本机与自动化容器中的实现验收，未执行远端 CI、生产部署或独立的自托管发行验收。其他知识库任务的既有工作区改动不包含在本次交付中。

提交前空白检查仅提示已应用的 0106 迁移末尾多一个空行。依据数据库规范保留该文件原始字节；其余文件通过标准检查，0106 仅排除 `blank-at-eof` 后的检查通过，未修改仓库 Git 配置。
