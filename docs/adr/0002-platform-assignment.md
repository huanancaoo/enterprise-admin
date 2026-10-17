---
status: accepted
date: 2026-09-18
updated: 2026-10-17
---

# 独立平台任职与多角色动作授权

平台员工复用 Better Auth 全局账号和 Session，平台任职、角色及权限独立于租户 Membership。组织 owner/admin、自定义租户角色、路由、Cookie 和客户端状态都不能产生平台权限。

2026-10-17 用户确认平台系统管理需要不同运营岗位、多角色权限并集，以及网页任职与角色授权管理。该决定替代原有两个固定角色和仅部署 CLI 管理任职的限制。

`platform_assignment` 按 userId 唯一记录任职状态、版本、授予/撤销时间、操作者和原因。`platform_role` 保存平台角色、启停状态和代码已注册的动作集合；`platform_assignment_role` 建立多角色关联。每个请求按当前有效 Session、全局账号状态、有效任职和有效角色重新计算权限并集；权限变更在下一请求生效。菜单隐藏不改变权限。

内置 `platform_admin` 是超级管理员，角色不可删除、停用或修改权限；它取得代码注册的全部动作。`platform_auditor` 迁移为内置只读角色，保留旧任职的原有权限。自定义角色不得授予 `platform.authorization:manage`，只有内置超级管理员可管理平台任职和角色授权。

允许自我降权。任职、角色关联及全局账号暂停使用同一事务级 advisory lock；数据库延迟约束在提交时保证至少留有一位全局账号正常、任职有效的超级管理员。停用或撤销任职清除角色关联，恢复任职不恢复已撤销角色；不修改全局账号状态或租户成员关系。全局账号暂停仍是独立管理动作，同样受最后超级管理员约束。

部署 CLI 使用专用 `PLATFORM_ASSIGNMENT_DATABASE_URL`，不注入在线 API。`platform admin create` 原子创建已验证邮箱的新账号、Better Auth 原生密码凭据、超级管理员任职及内部审计；密码仅从标准输入读取。`platform assignment grant/revoke` 接受精确 userId、平台角色 key 和原因，分别添加或撤销一项角色，写入与审计共同提交。最后角色撤销时终止任职。网页创建员工使用同一原生身份结构，管理员设初始密码或选择已有已验证账号，不修改既有邮箱验证事实。

平台 MFA 保持可选；已启用者遵循 Better Auth 原生挑战。原生 assurance 继续记录实际验证事实，不作为平台额外准入要求。

密码登录锁按全局 userId 共用：滚动 15 分钟内连续 5 次密码错误锁定 15 分钟；成功验密、到期或具 `platform.user:unlock` 权限的管理员解锁清零。原生 verifier 在同一账号的数据库行锁事务中执行，计数在原生邮箱校验和 MFA 挑战之前提交。锁不踢已有 Session，不影响 GitHub 或原生 MFA 临时锁。解锁是独立动作并同事务留痕。

## 数据库边界

`require_platform_action(actor, session, action)` 是固定平台函数的共同授权入口。所有既有组织、账号、审计、设置、登录日志和会话函数都检查各自代码动作，不再按固定角色名放行。受限 NOLOGIN `platform_executor` 拥有函数，固定 search_path、启用 RLS、撤销 PUBLIC；在线 runtime 不直接读写平台任职、角色或密码锁表。

## 验证证据

[数据库身份管理测试](../../packages/database/test/identity-management.test.ts) 验证旧账号管理函数、事务审计和会话状态约束。[多角色与密码锁测试](../../packages/database/test/platform-authorization.test.ts) 覆盖权限并集、旧动作函数、并发最后超级管理员保护和真实 Better Auth 密码流程。实际运行结果由本次交付记录说明；这些测试不代表生产部署或浏览器验收。
