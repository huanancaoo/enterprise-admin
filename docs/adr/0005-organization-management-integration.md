---
status: accepted
---

# 组织管理保留 Better Auth 生命周期，以数据库保护不变量和原子审计

Better Auth 1.7.5 的公开调用未加入项目外层 Drizzle 事务，after hook 失败也不能撤销已提交写入，且真实并发探针复现了零 owner 和悬空角色。依据 [S8 规格](https://github.com/huanancaoo/enterprise-admin/issues/8)，保留 Better Auth 唯一生命周期，选择数据库级不变量与同事务审计触发器作为集成路径，而不把外层事务或 before/after hook 作为原子性保证。

## 影响

项目必须将可信 actor/request、组织锁与授权版本绑定到实际 auth 写连接，且覆盖原生 HTTP 和内部调用；该绑定尚未证明，相关管理写能力仍被阻塞。单角色规则、显式委派目录和引用约束见 [S8 集成约束](../architecture/s8-integration-contract.md)，复现依据和未通过项见 [S8-00 验证](../architecture/s8-00-validation.md)；接受此路径不等于生产集成已验收。
