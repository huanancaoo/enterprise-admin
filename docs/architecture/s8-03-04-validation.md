# S8-03 / S8-04：成员目录与成员管理验证

日期：2026-09-26。对应 [#11](https://github.com/huanancaoo/enterprise-admin/issues/11)、[#12](https://github.com/huanancaoo/enterprise-admin/issues/12)。本记录描述本地源码与自动化证据，不代表远端 CI 或部署结果。

## 实现边界

- 成员读取和写入继续使用 Better Auth Organization 原生入口，没有新增 Nest 成员接口或 Orval 成员客户端。
- 目录搜索、角色筛选、排序和分页由服务端执行。搜索空页保留总数，搜索与非搜索返回相同的 UTC 加入时间；URL 恢复表单状态，保留动态角色筛选。失去 `member:read` 后不再展示或保留其他筛选页的成员缓存。
- 修改角色、移除和退出通过确认窗口提交打开时的授权版本。版本冲突保留草稿，要求关闭并核对成员状态；成功后刷新组织范围查询，退出后清理该组织查询并跳转组织选择页。
- 服务端在组织锁内重新确认操作者、目标原角色、新角色和组织。只有 owner 能管理 owner/admin 或授予这两个角色；晋升 owner 要求目标已入组且邮箱已验证。内部 `addMember` 不能直接完成所有权交接，组织创建时的首位 owner 除外。
- 最后一位 owner 不能被移除、退出或降级，统一返回 `409 LAST_OWNER_REQUIRED`。版本比较、成员写入及成功审计共用事务；审计失败全部回滚。
- 新迁移 `0017_member-management-audit.sql` 区分 `member.role_changed`、`member.removed` 和 `member.left`。历史迁移未修改。

## 验证入口与证据

```sh
pnpm verify
pnpm exec vitest run --config vitest.config.e2e.mjs tests/e2e/auth.test.mjs -t '成员目录|成员管理'
pnpm --filter tenant lint
pnpm --filter tenant typecheck
```

完整 `pnpm verify` 通过：单元/契约/文档 57 项，API 69 项，Storybook 84 项，浏览器 25 项，数据库 17 项，共 252 项；同时通过 peer、lint、类型、翻译、文档内容、Schema、构建和生成客户端漂移检查。随后增加的目录撤权回归与最终前端调整，已补跑上述三个成员浏览器用例、租户 lint 和类型检查，全部通过。

`tests/api/organization-integration.test.mjs` 的 26 项集成测试覆盖 HTTP 与内部 `auth.api`、缺少/陈旧版本、管理员与动态角色边界、UUID/邮箱规范化、跨组织目标拒绝、最后 owner、并发交接和审计故障回滚。移除测试验证全局 User、其他组织 Membership 与 Projects 保留，原 Cookie 仅失去当前组织访问权限。

目录数据库测试验证姓名/邮箱搜索、角色过滤、排序、分页与总数、跨组织及 `member:read` 约束。浏览器用例验证 URL 刷新/后退、动态角色筛选、权限撤回、冲突草稿、先交接再降级/退出、移除取消与确认、键盘焦点及中英阿文窗口。角色变更后行因筛选消失时，焦点转到搜索框；触发按钮仍存在时回到原按钮。

运行浏览器用例会生成 `test-results/s8/member-directory-rtl.png` 和 `test-results/s8/member-role-rtl.png`，用于复核阿拉伯语布局。测试产物不纳入源码提交。

## 尚未执行的边界

数据库与浏览器测试复用仓库测试运行时，连接临时 PostgreSQL 并执行正式迁移链；没有将新迁移应用到现有开发库或生产库。没有推送、部署或执行远端 CI。并发与审计结论限定于上述测试覆盖的入口和场景，不代表 S8 后续任务已验收。
