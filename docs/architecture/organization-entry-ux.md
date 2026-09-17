# 组织进入门（选择/创建）UX 调研

调研日期：2026-09-17。本文是对第一方文档与本仓库已有约束的记录，不是规格，不选定实现。产品行为以各来源原文为准；未登录各产品实测界面。文档未写明的 0/1/N 分流，不补写为产品行为。

## 问题

登录之后、进入租户工作区之前，用户必须完成下列之一：

- 成员数为 0：创建组织
- 成员数为 N（N≥2）：选择已有组织

用户已否定把这两项任务放进工作区壳层（侧栏、面包屑、「项目」导航、TeamSwitcher、AppShell）。独立页面或对话框可以接受。

需要了解真实产品如何把组织/工作区的**选择与创建**做成工作区之前的门，以及首次创建与「已在某个工作区内再创建一个」是否同一套界面。

## 本仓库已有约束（事实）

以下条目只陈述仓库内已有文字或当前工作区代码，不解释为产品已批准的新交互。

### 架构决策

- 身份、组织、成员、邀请与动态组织角色统一使用 Better Auth Organization，不建立第二套身份或成员模型。[ADR-0001](../adr/0001-architecture-baseline.md)
- 组织路径由 TanStack Router 持有。[ADR-0001](../adr/0001-architecture-baseline.md)
- `activeOrganizationId` 只表示工作区偏好，不是访问凭据。每次业务请求仍验证目标组织、Session、Membership、组织状态和动作权限。[ADR-0002](../adr/0002-organization-identifiers.md)
- 实施计划重复同一边界：active organization 只是工作区偏好；客户端路径、Header、Body 或当前 UI 选中的组织都不是授权证明。[implementation-plan.md](implementation-plan.md)
- 业务请求的目标组织来自路由参数 `organizationId`，不由 active organization 决定。[s4-04-validation.md](s4-04-validation.md)

[ADR-0001](../adr/0001-architecture-baseline.md) 写明：[归档研究](multi-tenant-foundation.md)中的建议不自动成为实施授权。该文路由示意含 `/app/select-organization` 与 `/app/:organizationId/`，只能当作研究原文，不能当作已接受决策。[multi-tenant-foundation.md](multi-tenant-foundation.md)

本仓库没有与 Clerk Personal Account 或 GitHub 个人仓库主页对等的「无组织也可办公」模型。租户业务以 URL `organizationId` 为范围。[s4-04-validation.md](s4-04-validation.md)

### S4-02 当时交付

S4-02 记录：Admin `/login` 之后进入 `/app/select-organization`，支持空组织、创建组织和切换组织；创建成功后选中新组织，刷新恢复服务端保存的选择。[s4-02-validation.md](s4-02-validation.md)

### 当前工作区路由与壳层

当前文件（含未提交改动）与 S4-02 记录不一致：

- 登录成功后的认证落地路径是 `/app`，不是 `/app/select-organization`。[apps/admin/src/App.tsx](../../apps/admin/src/App.tsx)
- `/app` 使用 `AdminLayout`，内部是 `AppShell`、面包屑、侧栏 TeamSwitcher 与「项目」导航。[apps/admin/src/router.tsx](../../apps/admin/src/router.tsx)、[apps/admin/src/components/admin-layout.tsx](../../apps/admin/src/components/admin-layout.tsx)
- `/app/select-organization` 是 `/app` 的子路由，因此也套在 `AdminLayout` / `AppShell` 里。[apps/admin/src/router.tsx](../../apps/admin/src/router.tsx)
- `/app` 索引 `WorkspaceEntry`：成员数为 1 时直接进入 `/app/projects/$organizationId`；否则（0 或大于 1）跳到 `/app/select-organization`。注释写明组织管理页本身不自动跳走，否则无法创建下一个组织。[apps/admin/src/components/organization-workspace.tsx](../../apps/admin/src/components/organization-workspace.tsx)
- `/app/select-organization` 在同一页列出已有组织并提供创建表单；列表项用链接进入项目页，创建调用 `organization.create({ keepCurrentActiveOrganization: false })`。[apps/admin/src/components/organization-workspace.tsx](../../apps/admin/src/components/organization-workspace.tsx)、[apps/admin/src/hooks/use-organization-workspace.ts](../../apps/admin/src/hooks/use-organization-workspace.ts)
- 侧栏 TeamSwitcher 在已进入 `AdminLayout` 后切换组织并 `setActive`。[apps/admin/src/components/admin-layout.tsx](../../apps/admin/src/components/admin-layout.tsx)、[packages/admin/src/components/team-switcher.tsx](../../packages/admin/src/components/team-switcher.tsx)
- 未登录只渲染 `/login`，登录页不使用 `AppShell`。[packages/admin/src/auth/auth-session.tsx](../../packages/admin/src/auth/auth-session.tsx)
- `AuthSession` 只区分有无 Session，不检查组织成员数。[packages/admin/src/auth/auth-session.tsx](../../packages/admin/src/auth/auth-session.tsx)

当前工作区未检索到在 `session.create` 时把上一会话的 `activeOrganizationId` 写入新会话的 hook。这与 Better Auth 文档默认值一致：新登录后 active organization 为 `null`。[Better Auth Organization](https://better-auth.com/docs/plugins/organization)

## 行业产品怎么做（分产品，带来源）

### Better Auth Organization 插件

来源：[Organization 插件](https://better-auth.com/docs/plugins/organization)。

插件提供 API 与 React hook，不提供官方选择页、对话框或切换器。文档示例只是把组织名映射成列表。

| 主题                         | 文档事实                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录后 0 个组织              | 文档不规定必须创建。默认「any user can create an organization」。                                                                                                                                                                                                                                                                       |
| 登录后 1 / N 个组织          | 文档不规定自动进入或强制选择。`useListOrganizations()` 列出成员组织。                                                                                                                                                                                                                                                                   |
| 登录后的 active organization | 「By default when the user is signed in the active organization is set to `null`.」                                                                                                                                                                                                                                                     |
| 是否跨会话保留               | 可以写入 session；「It's not always you want to persist the active organization in the session。」也可以只放在客户端，例如不同标签页不同组织。若要在创建 session 时自动指定，使用 `databaseHooks.session.create.before`，「You'll need to implement logic to determine which organization to set as the initial active organization。」 |
| 首次创建 vs 再创建一个       | 同一 `organization.create`。`keepCurrentActiveOrganization` 控制新建后是否保持当前 active organization，默认 false。                                                                                                                                                                                                                    |
| UI 位置                      | 无官方工作区壳层组件。应用自己决定。                                                                                                                                                                                                                                                                                                    |

插件没有「必须属于一个组织才能使用产品」的开关，也没有 0/1/N 的路由规则。

### Clerk Organizations

来源：[Organizations overview](https://clerk.com/docs/guides/organizations/overview)、[Create and manage](https://clerk.com/docs/guides/organizations/create-and-manage)、[Configure](https://clerk.com/docs/guides/organizations/configure)、[Session tasks](https://clerk.com/docs/guides/configure/session-tasks)、[`<TaskChooseOrganization />`](https://clerk.com/docs/react/reference/components/authentication/task-choose-organization)、[`<OrganizationList />`](https://clerk.com/docs/react/reference/components/organization/organization-list)、[`<OrganizationSwitcher />`](https://clerk.com/docs/react/reference/components/organization/organization-switcher)、[`<CreateOrganization />`](https://clerk.com/docs/react/reference/components/organization/create-organization)。

Clerk 把「登录后还没有可用组织上下文」做成认证会话任务，而不是工作区侧栏里的一项功能。

| 主题                   | 文档事实                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 必须属于组织           | 2025-08-22 之后新建的实例默认关闭 Personal Accounts。「When disabled, users are required to choose an Organization after authenticating。」CLI：`--force-selection (force Organization selection on login, i.e. membership required)`。「All new and existing users will be prompted to create or join an Organization。」[Configure](https://clerk.com/docs/guides/organizations/configure)            |
| 0 个组织               | 关闭 Personal Accounts 时，走 session tasks：「prompted to create or join an Organization through the session tasks flow」。任务未完成的会话状态是 Pending，「By default, treated as signed-out, and therefore can't access protected content or routes。」[Session tasks](https://clerk.com/docs/guides/configure/session-tasks)                                                                       |
| 1 个组织               | 文档未写「只有一个组织就跳过选择」。另有「Clerk can automatically create the user's first Organization」（`--auto-create`）。[Configure](https://clerk.com/docs/guides/organizations/configure)                                                                                                                                                                                                         |
| N 个组织               | 「Users can belong to multiple Organizations and switch between them with the OrganizationSwitcher component。」[Overview](https://clerk.com/docs/guides/organizations/overview)                                                                                                                                                                                                                        |
| 进入门 UI              | `<TaskChooseOrganization />` 用于完成 `choose-organization` 任务。内置 `<SignIn />` / Account Portal 会自动处理。也可自托管，示例路径 `/session-tasks/choose-organization`，完成后 `redirectUrlComplete`。[TaskChooseOrganization](https://clerk.com/docs/react/reference/components/authentication/task-choose-organization)                                                                           |
| 列表页组件             | `<OrganizationList />` 展示 memberships、invitations、suggestions。提供 `afterCreateOrganizationUrl`、`afterSelectOrganizationUrl`、`hidePersonal`。React 示例把该组件当作页面根节点。[OrganizationList](https://clerk.com/docs/react/reference/components/organization/organization-list)                                                                                                              |
| 工作区内切换           | `<OrganizationSwitcher />`「allows a user to switch between their joined Organizations」，并「handles all Organization-related flows, including full Organization management for admins」。创建默认 `createOrganizationMode: 'modal'`，也可 `'navigation'` 并指定 `createOrganizationUrl`。[OrganizationSwitcher](https://clerk.com/docs/react/reference/components/organization/organization-switcher) |
| 首次创建 vs 再创建     | Create and manage 页不区分首次与后续，同一套 `<CreateOrganization />` / Switcher。`CreateOrganization` 可按 `path` 挂在例如 `/create-organization`。[Create and manage](https://clerk.com/docs/guides/organizations/create-and-manage)、[CreateOrganization](https://clerk.com/docs/react/reference/components/organization/create-organization)                                                        |
| 是否在工作区 chrome 外 | `choose-organization` 发生在受保护路由之前。Pending 会话默认不能访问受保护内容。[Session tasks](https://clerk.com/docs/guides/configure/session-tasks)                                                                                                                                                                                                                                                  |

文档未写 `choose-organization` 是否在「已有组织的每一次重新登录」都出现。

### Vercel Teams

来源：[Account Management](https://vercel.com/docs/accounts)、[Hobby](https://vercel.com/docs/plans/hobby)、[2024-01 account changes](https://vercel.com/changelog/2024-01-account-changes)。

Vercel 没有「登录后 0 个 team」的常规状态。个人账号被转换成 Hobby team。

| 主题             | 文档事实                                                                                                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 注册之后         | 「When you first sign up for Vercel, you'll create an account。」changelog：「Your Vercel personal account will soon automatically become a free team。」Hobby 文档：「When your personal account gets converted to a Hobby team…」             |
| 登录后 0 个 team | 文档未描述该状态。                                                                                                                                                                                                                              |
| 登录后 1 个 team | 「The first Hobby or Pro team you create will automatically be nominated as the default team。」「It will also be the team shown whenever you first log in to Vercel or navigate to `/dashboard`.」[Accounts](https://vercel.com/docs/accounts) |
| 登录后 N 个 team | Dashboard 左上角 team switcher 切换。「To choose which team appears when you first log in or open the dashboard, change your default team。」[Accounts](https://vercel.com/docs/accounts)                                                       |
| 再创建一个 team  | 在已进入 dashboard 之后：左上角 team switcher → create a new team。文档步骤不经过登录前的独立门。[Accounts](https://vercel.com/docs/accounts)                                                                                                   |
| 进入门？         | 文档把首次登录去向定义为 default team 的 dashboard，而不是先选 team 再进产品。创建额外 team 在工作区导航里。                                                                                                                                    |

### GitHub Organizations

来源：[Types of accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)、[About organizations](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/about-organizations)、[Creating a new organization from scratch](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch)、[Accessing an organization](https://docs.github.com/en/account-and-profile/how-tos/organization-membership/accessing-an-organization)、[About organization membership](https://docs.github.com/en/account-and-profile/setting-up-and-managing-your-personal-account-on-github/managing-your-membership-in-organizations/about-organization-membership)。

GitHub 登录对象永远是个人账号。组织不是进入产品的前置门。

| 主题         | 文档事实                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登录         | 「Every person who uses GitHub signs in to a user account。」「you cannot sign in to an organization。」[Types of accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)                                                                                                                                          |
| 0 个组织     | 合法。个人账号即可使用 GitHub。文档没有登录后强制创建组织的步骤。                                                                                                                                                                                                                                                                                           |
| 1 / N 个组织 | 「Each user can be a member of multiple organizations。」进入某个组织：右上角头像 → Organizations → 点组织名。[Accessing an organization](https://docs.github.com/en/account-and-profile/how-tos/organization-membership/accessing-an-organization)                                                                                                         |
| 创建组织     | 任意 GitHub 页面 → 头像 → Settings → Organizations → New organization → 「Follow the prompts to create your organization。」这是账号设置里的专用流程，不在某个仓库或已打开的组织工作区内部完成。[Creating a new organization](https://docs.github.com/en/organizations/collaborating-with-groups-in-organizations/creating-a-new-organization-from-scratch) |
| 进入门？     | 没有。组织是可选的协作容器，不是登录后的必选工作区。                                                                                                                                                                                                                                                                                                        |

### Linear Workspaces

来源：[Start guide](https://linear.app/docs/start-guide)、[Workspaces](https://linear.app/docs/workspaces)、[Conceptual model](https://linear.app/docs/conceptual-model)。

Linear 的使用前提是已有 workspace。登录指向具体 workspace，而不是「先登录账号、再在产品壳层里建第一个」。

| 主题              | 文档事实                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次              | 「The first step to using Linear is to create a workspace for your team。」Start guide：用工作邮箱注册（[linear.app/signup](https://linear.app/signup)），然后「Create a workspace for your organization」。[Workspaces](https://linear.app/docs/workspaces)、[Start guide](https://linear.app/docs/start-guide) |
| 登录              | 「When you log into Linear, you're logging into a specific workspace。」每个 workspace 有独立 URL，形如 `linear.app/example`。[Conceptual model](https://linear.app/docs/conceptual-model)                                                                                                                       |
| 0 个 workspace    | 文档未单独描述「已登录但零 workspace」的产品页。把创建 workspace 写成使用 Linear 的第一步。                                                                                                                                                                                                                      |
| 1 个 workspace    | 产品设计假设组织留在单个 workspace：「We recommend organizations stay within a single workspace as this is the conceptual model we use when designing the product。」[Workspaces](https://linear.app/docs/workspaces)                                                                                            |
| N 个 workspace    | 「you can have accounts on one or many workspaces and can switch between these accounts。」同一账号可以有多个 workspace，成员与账单分离。[Conceptual model](https://linear.app/docs/conceptual-model)、[Workspaces](https://linear.app/docs/workspaces)                                                          |
| 再创建一个 / 切换 | 已在某个 workspace 内：左上角点 workspace 名 → Hover「Switch workspace」→「Create or join a workspace」；若同账号已有其他 workspace，会列出可选。快捷键 `O` 然后 `W`。[Workspaces](https://linear.app/docs/workspaces)                                                                                           |
| 进入门 vs 壳层内  | 第一个 workspace：注册/创建路径，不在已有工作区壳层里。第二个及以后：工作区左上角切换器。                                                                                                                                                                                                                        |

### Notion Workspaces

来源：[Create, join, & leave workspaces](https://www.notion.com/help/create-delete-and-switch-workspaces)（帮助中心类目 [Meet your workspace](https://www.notion.com/help/category/meet-your-workspace) 指向该文）。

帮助文只写「已经在用 Notion 之后如何再创建一个 / 切换」，没有写注册后 0 个 workspace 的专用门。

| 主题       | 文档事实                                                                                                                                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次       | 「When you're brand new to Notion, it's best to keep it simple and start with just one workspace。」帮助文没有逐步描述注册后的创建页。                                                                                  |
| 再创建一个 | 左上角 workspace switcher → 选邮箱 → overflow → `Join or create workspace` → 滚过已有列表后 `Create workspace`。                                                                                                        |
| 切换       | 「Open the workspace switcher at the top left of your Notion window。」「Just click on the name of your current workspace and select the one you want to jump to from the dropdown menu。」桌面快捷键 Ctrl+Shift+数字。 |
| 载体       | 帮助文把切换和再创建放在左上角下拉，不是独立页，也未写成对话框。离开 workspace 走侧栏 Settings。                                                                                                                        |
| 进入门？   | 检索到的帮助文不描述登录后、进入工作区前的强制选择页。                                                                                                                                                                  |

### Slack Workspaces

来源：[Create a Slack workspace](https://slack.com/help/articles/206845317-Create-a-Slack-workspace)、[Join a Slack workspace](https://slack.com/intl/en-sg/help/articles/212675257-Join-a-Slack-workspace)、[Getting started for new Slack users](https://slack.com/intl/en-sg/help/articles/218080037-Getting-started-for-new-Slack-users)。Getting started 类目未列出「切换 workspace」文章。

Slack 把创建和加入放在 `slack.com` 上的独立站点，不在某个已打开的 workspace 壳层里。

| 主题             | 文档事实                                                                                                                                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 创建（含第一个） | 桌面打开 [slack.com/get-started#/createnew](https://slack.com/get-started#/createnew)，填邮箱或 Apple/Google，输入邮件验证码，然后「Create a workspace」并完成提示。创建者成为 workspace primary owner。[Create a Slack workspace](https://slack.com/help/articles/206845317-Create-a-Slack-workspace)       |
| 加入已有         | 桌面打开 [slack.com/signin](https://slack.com/signin)，输入邮箱并验证码后，「Below Accept an invitation, click Join next to the workspace that you'd like to join。」同一邮箱可加入任意多个 workspace。[Join a Slack workspace](https://slack.com/intl/en-sg/help/articles/212675257-Join-a-Slack-workspace) |
| 0 个 workspace   | 创建走 get-started 独立页；加入走 signin 独立页。两者都在进入 workspace 之前。                                                                                                                                                                                                                               |
| 1 个 workspace   | 新用户指南假定读者已经加入一个 workspace，不再讲选择。[Getting started for new Slack users](https://slack.com/intl/en-sg/help/articles/218080037-Getting-started-for-new-Slack-users)                                                                                                                        |
| N 个 workspace   | 加入流程在 signin 页列出可 Join 的邀请。已进入 workspace 之后如何切换，本次检索到的帮助首页与 Getting started 类目没有对应文章，本文不补写。                                                                                                                                                                 |
| 进入门 vs 壳层内 | 创建与接受邀请发生在 slack.com 独立页。新用户指南里的产品内设置发生在已经签入某个 workspace 之后。                                                                                                                                                                                                           |

## 可归纳的模式（只写有来源支撑的）

下列模式每条都能指回上一节来源。没有来源的产品习惯不写入。

1. **「没有组织就不能进受保护产品」时，选择/创建发生在工作区壳层之前。** Clerk 关闭 Personal Accounts 后，`choose-organization` 是 session task；Pending 会话默认视为未登录，不能访问受保护路由。[Session tasks](https://clerk.com/docs/guides/configure/session-tasks)、[Configure](https://clerk.com/docs/guides/organizations/configure)。Slack 创建走 `get-started#/createnew`，加入走 `signin` 上的邀请列表。[Create](https://slack.com/help/articles/206845317-Create-a-Slack-workspace)、[Join](https://slack.com/intl/en-sg/help/articles/212675257-Join-a-Slack-workspace)。

2. **「账号本身就是可工作的默认空间」时，没有登录后组织门。** GitHub 只能登录个人账号，组织可选。[Types of accounts](https://docs.github.com/en/get-started/learning-about-github/types-of-github-accounts)。Vercel 注册账号并转换成 Hobby team，首次登录进入 default team 的 `/dashboard`。[Accounts](https://vercel.com/docs/accounts)、[Changelog](https://vercel.com/changelog/2024-01-account-changes)。

3. **第一个工作区与「已经在一个工作区里再创建一个」通常不是同一载体。** Linear：第一步在 signup 创建 workspace；再创建/切换在左上角 Switch workspace。[Start guide](https://linear.app/docs/start-guide)、[Workspaces](https://linear.app/docs/workspaces)。Vercel：额外 team 从 dashboard 左上角 switcher 创建。[Accounts](https://vercel.com/docs/accounts)。Notion 帮助文把再创建放在左上角 switcher。[Notion help](https://www.notion.com/help/create-delete-and-switch-workspaces)。Clerk：强制选择用 session task；工作区内再用 OrganizationSwitcher，创建默认 modal，也可导航到独立 `createOrganizationUrl`。[OrganizationSwitcher](https://clerk.com/docs/react/reference/components/organization/organization-switcher)。

4. **独立页、对话框、应用内切换器在第一方文档里都出现过，但用途不同。** 独立页：Clerk 自托管 `/session-tasks/choose-organization`、Clerk 示例中的 `/create-organization`、Slack get-started/signin、GitHub Settings → New organization。对话框：Clerk OrganizationSwitcher 默认 `createOrganizationMode: 'modal'`。应用内切换器：Vercel / Linear / Notion 左上角，以及 Clerk OrganizationSwitcher。没有一份第一方文档把「0 个组织时的强制创建」放进侧栏 TeamSwitcher。

5. **1 个组织是否跳过选择，文档没有统一说法。** Vercel：第一个 Hobby/Pro team 自动成为 default team，登录显示它。[Accounts](https://vercel.com/docs/accounts)。Clerk：可自动创建第一个组织，但 force-selection 的原文是所有用户会被提示 create or join，未写「仅一个则跳过」。[Configure](https://clerk.com/docs/guides/organizations/configure)。Better Auth：默认不自动 setActive。[Organization 插件](https://better-auth.com/docs/plugins/organization)。

6. **登录落到哪一个组织，产品自己存偏好，而不是认证插件代为决定。** Vercel 有 Default Team。[Accounts](https://vercel.com/docs/accounts)。Better Auth 默认新会话 `activeOrganizationId = null`，若要自动指定必须自己写 `session.create` hook。[Organization 插件](https://better-auth.com/docs/plugins/organization)。Clerk 也可以主要把组织上下文放在 session，URL slug 是可选能力，且官方不建议除非必要。[Org slugs in URLs](https://clerk.com/docs/guides/organizations/org-slugs-in-urls)。

7. **Better Auth 不提供进入门 UI。** 列表、创建、setActive 都是 API/hook。0/1/N 分流、页面还是对话框，都由应用实现。[Organization 插件](https://better-auth.com/docs/plugins/organization)

## 对本仓库的含义（不是方案，只指出冲突与可选载体）

不是设计建议，只标出调研事实与仓库约束之间的交叉点。

- **本仓库更接近「必须有组织才能做租户业务」，而不是 GitHub/Vercel 的「账号即默认空间」。** 业务请求以 URL `organizationId` 为租户范围，没有个人工作区模型。[s4-04-validation.md](s4-04-validation.md)、[ADR-0002](../adr/0002-organization-identifiers.md)。与此同类的第一方做法是 Clerk 的 session task（受保护路由之前 create or join）和 Slack 的 get-started/signin 独立页。

- **当前实现把选择/创建放在 `AdminLayout` / `AppShell` 内，与「不要放进工作区壳层」直接冲突。** `/app/select-organization` 是 `/app` 子路由；0 个组织时 `WorkspaceEntry` 仍先进入带 TeamSwitcher 和「项目」导航的壳，再跳到选择页。[apps/admin/src/router.tsx](../../apps/admin/src/router.tsx)、[apps/admin/src/components/admin-layout.tsx](../../apps/admin/src/components/admin-layout.tsx)、[apps/admin/src/components/organization-workspace.tsx](../../apps/admin/src/components/organization-workspace.tsx)

- **S4-02 记录与当前落地路径冲突。** 当时登录后进入 `/app/select-organization`；当前 `authenticatedPath` 是 `/app`。[s4-02-validation.md](s4-02-validation.md)、[apps/admin/src/App.tsx](../../apps/admin/src/App.tsx)

- **当前「1 个组织自动进入」是仓库代码行为，不是行业文档共识。** [organization-workspace.tsx](../../apps/admin/src/components/organization-workspace.tsx) 在成员数等于 1 时 `Navigate` 到项目页。Clerk force-selection 未承诺这一跳过。

- **当前同一页同时承担「0 个时创建」和「N 个时选择 + 再创建」。** Linear / Vercel / Notion 的第一方文档把「再创建一个」放在已进入工作区之后的 switcher。用户已否定用壳层承担进入门，但「已在组织内再创建」是否仍算进入门，仓库还没有产品结论。

- **会话偏好不能替代进入门，也不能替代 URL。** Better Auth 新会话默认 active organization 为 `null`；本仓库也不把该字段当授权。进入租户页最终仍要落到带 `organizationId` 的路由。[Better Auth Organization](https://better-auth.com/docs/plugins/organization)、[ADR-0002](../adr/0002-organization-identifiers.md)

- **文档里出现过、且不依赖工作区壳层的载体只有这些（罗列，不选型）：**
  - 独立页：Clerk `TaskChooseOrganization` 自托管路径、Clerk `CreateOrganization` 的 `path`、Slack `get-started` / `signin`、GitHub 账号设置里的 New organization。
  - 对话框：Clerk OrganizationSwitcher 创建组织的默认 modal 模式。Clerk 文档把该 modal 绑在 Switcher 上，而 Switcher 本身是工作区内组件。
  - 登录页之后的全屏间隙：Clerk 把 choose-organization 嵌在 SignIn / Account Portal 流程里，Pending 完成前不能进受保护内容。

- **工作区内切换器在 Vercel、Linear、Notion、Clerk 文档中用于「已经在一个工作区之后」的切换或再创建。** 与本次被否定的进入门载体是同一类 UI，但文档中的任务不同。

## 仍需产品确认的问题

以下问题会改变进入门的任务边界，本文不给答案。

1. **0 个组织：独立页还是对话框？** 两者都未被否定。Clerk 用受保护路由之前的 session task 页；Slack 用站点级 get-started 页。对话框在 Clerk 文档里出现在工作区内 Switcher 的创建流，是否允许一个「无 AppShell」的对话框，需要产品决定。

2. **N 个组织：是否每次新登录都要经过进入门？** 本仓库新会话不携带 `activeOrganizationId`。Vercel 用 Default Team 避免每次选择。若每次都要选，进入门是登录后的固定步骤；若允许记住上次 URL 或自行写 session hook，进入门只在「没有可用组织上下文」时出现。

3. **恰好 1 个组织：自动进入，还是仍要确认？** 当前代码自动进入。Clerk force-selection 原文是提示 create or join，未写跳过。自动进入会取消一次显式选择。

4. **「创建第一个组织」和「已经在组织 A 时创建组织 B」是不是同一任务？** 用户否定的是进入门放进壳层。Linear / Vercel / Notion 把后者放在已进入后的 switcher。若后者仍算进入门，它也不能使用 AppShell；若不算，壳层内再创建是否允许，需要另一次确认。

5. **创建成功后的去向？** 当前创建会 `setActive`（`keepCurrentActiveOrganization: false`），但选择列表走的是项目 URL。S4-02 写的是创建后选中新组织。需要确认：第一个组织创建后是直接进入该组织的租户页，还是留在进入门。

6. **进入门完成前，是否允许渲染 `AdminLayout` / `AppShell` / TeamSwitcher / 「项目」导航？** 当前路由会。Clerk Pending 会话默认不能访问受保护内容。这是壳层边界问题，不是组件皮肤问题。

7. **已进入某组织之后，侧栏 TeamSwitcher 是否仍用于切换组织？** 这不是进入门。Vercel / Linear / Notion / Clerk 都有工作区内切换器。若保留，它与进入门是两条任务；若去掉，N 个组织的日常切换需要另一载体。

8. **直接打开带 `organizationId` 的租户 URL（刷新、书签、外链）是否还要经过进入门？** 授权仍以该 URL 的组织为准。[s4-04-validation.md](s4-04-validation.md)。前端是否在缺少成员关系或缺少组织时改走进入门，当前 `AuthSession` 没有做。
   )
