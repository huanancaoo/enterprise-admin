---
status: accepted
---

# 平台运营采用独立任职、会话二次验证与固定数据库函数

平台运营需要跨组织查询，但不能因此取得租户业务访问权；按 [S8 规格](https://github.com/huanancaoo/enterprise-admin/issues/8)，采用独立的 platform_admin/platform_auditor 任职、仅部署 CLI 授权、绑定当前 Session 的第二因素事实，以及独立 platform_runtime 连接池调用受限 NOLOGIN 角色持有的固定函数。该边界同时限制应用动作与数据库访问范围，替代旧版单平台角色、在线授予及运行账号直接访问基础表的设计；组织状态统一为 ACTIVE/SUSPENDED，不保留 enabled 与组织状态两套事实，见 [组织状态](0006-organization-status.md)。

## 影响

可信设备登录和 twoFactorEnabled 不能证明当前会话完成了第二因素验证，平台写操作要求最近 15 分钟的服务端验证事实。角色矩阵、CLI、状态迁移与函数授权约束见 [S8 集成约束](../architecture/s8-integration-contract.md)；[验证记录](../architecture/s8-00-validation.md)中的会话与事务阻塞解除前，不开放相关平台能力。
