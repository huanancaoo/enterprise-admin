# 后台布局原型实施验收

日期：2026-10-23。范围：租户后台、平台后台的页面结构，以及本次页头加载修复。执行依据为既有三张原型和《统一后台页面布局方案》，并保留现有业务、权限、查询及表单提交边界。

## 对照依据与状态

方案明确沿用现有主题、字体、按钮和基础组件 token；原型表达页面层级，精确尺寸与业务行为以方案契约为准。本次验收判断结构、信息层级和交互是否落实，未将生成图中的虚构数据或视觉尺寸当成新业务需求。

| 页面       | 原型源图                                                                                                                                                        | 浏览器实现证据                                                                                                                                                                     | 状态                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 员工列表   | [prototype-list.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-proposal/prototype-list.png)           | [employees-desktop.jpg](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/employees-desktop.jpg)               | 真实平台账号、3 条实际任职记录、无筛选、浅色主题           |
| 角色权限   | [prototype-detail.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-proposal/prototype-detail.png)       | [role-permissions-desktop.jpg](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/role-permissions-desktop.jpg) | 真实审计员角色、完整 19 个资源组、浅色主题                 |
| 文件工作台 | [prototype-workspace.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-proposal/prototype-workspace.png) | [files-populated-desktop.jpg](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/files-populated-desktop.jpg)   | 现有 Storybook/MSW 文件场景、10 条记录、预览关闭、浅色主题 |

真实租户组织当前文件集合为空，另以 [真实空状态](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/tenant-files-desktop.jpg) 验证实际路由、权限入口及查询呈现。有数据的列布局、组织级搜索、预览和焦点恢复使用现有 Storybook 场景验证，没有向真实组织写入示例文件。

尺寸与密度：

- 原型源像素：列表 1487 × 1058，权限 1486 × 1058，文件 1485 × 1059；均为生成图，没有 CSS 或设备像素比元数据。
- 原型的预期设计视口为 1440 × 1024。比较副本等比缩放至 1440px 宽，不拉伸、不修改原图内容；高度约 1025–1027px。
- 当前桌面实现：CSS 视口 1440 × 1024，deviceScaleFactor = 1，截图像素 1440 × 1024。比较板额外的 36px 说明栏和 16px 分隔不属于应用界面。
- 初次实施证据为 1440 × 960；只比较共同可见区域，不把底部缺少的 64px 计作布局问题。
- 补充断点：320 × 844、390 × 844、768 × 1024，均为 1 倍密度。原型没有给出移动端图，按方案的响应式契约验收。

## 完整画面与局部比较

源图与实现截图已放入同一比较板观察。局部图保持原有比例，重点检查控件排序、文字密度、列对齐、资源分组和边框，避免只看整页缩略图。

| 页面       | 全图比较                                                                                                                                                                   | 局部比较                                                                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 员工列表   | [comparison-list.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-list.png)           | [筛选、集合操作、身份列与表格](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-list-focus.png)      |
| 角色权限   | [comparison-detail.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-detail.png)       | [资源名称、权限网格与分隔](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-detail-focus.png)        |
| 文件工作台 | [comparison-workspace.png](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-workspace.png) | [面包屑、搜索、视图与文件表格](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-workspace-focus.png) |

## 发现、修复与复查历史

以下 P1/P2 在修复前均视为阻断；当前没有尚待修复的 P0/P1/P2 布局问题。

| 级别 | 初次发现及影响                                                                                       | 实施修复                                                                                                                                                   | 修复后证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1   | 首轮主要统一容器和间距，列表的身份信息、筛选与集合操作仍未形成原型的分区，部分新增入口仍混在表格内。 | 姓名与脱敏邮箱合并为身份单元；页面新增入口放页头；查询条件在工具栏起始侧，导入、导出和列视图在结束侧；统一表格行高。                                       | [初次对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-list-before.png)、[当前对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-list.png)                                                                                                                                                                  |
| P1   | 权限页仍有多层卡片、技术权限标识和按钮式子导航，层级比原型复杂。                                     | 返回、标题、角色身份、下划线链接导航、权限表单依次排列；资源标签与复选框平面分组；去掉重复技术代码，保留资源与动作组成的可访问名称；保存仍只在原表单底部。 | [初次对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-detail-before.png)、[当前对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-detail.png)、[保存区](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/role-permissions-footer.jpg) |
| P1   | 文件页搜索、面包屑、当前文件夹标题重复分层，表格贴边，未落实原型的工作台结构。                       | 常驻页头下分为 224px 目录与内容；内容按面包屑、搜索及视图、带边框表格排列；删除重复文件夹标题；保留配额、回收站和原预览流程。                              | [初次对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-workspace-before.png)、[当前对照](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/comparison-workspace.png)                                                                                                                                                        |
| P1   | 整页路由组件延迟加载时，页头也被替换为加载页，导致标题和操作位置消失。                               | 后台页面入口同步挂载；只在正文内设置 Suspense；富文本和项目正文继续独立延迟加载；移除伪装成页面标题的“正在加载”路由页头。                                  | [真实岗位请求暂挂](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/posts-data-loading.jpg)；两项延迟正文测试验证标题、返回节点在加载前后保持同一 DOM 节点，document.title 正确。                                                                                                                                                                                                                               |
| P2   | 390px 下，工具栏右侧操作挤压搜索框，占位文字几乎不可读。                                             | 窄屏筛选区占完整一行，集合操作随后排列；桌面保持两侧分区。                                                                                                 | [修复前](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/employees-390.jpg)、[修复后](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/employees-390-fixed.jpg)。390px 输入区域实测 266px；320px 为 196px。                                                                                                                               |
| P2   | 新建角色移到页头后，删除弹窗关闭时焦点可能进入新建按钮。                                             | headingRef 指向 h1，tabIndex = -1，明确恢复到标题。                                                                                                        | 成员、角色及公共页头焦点相关的 106 项复测通过；完整受影响集合随后 291 项通过。                                                                                                                                                                                                                                                                                                                                                                                                       |

## 五项视觉核查

| 表面             | 结论与合理差异                                                                                                                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 字体与文字层级   | 使用现有 DM Sans 正文、Outfit 标题及系统中文回退；桌面 h1 实测 30px / 36px、600 字重，移动 24px。保留 14px 正文和已有控件字号。生成图的文字更大，依据已确认方案沿用项目字号，未新增字体。标题、元信息、子导航、正文的层级已落实。        |
| 间距与布局节奏   | 桌面标准页 padding 32px，主区域间隔 24px；全局侧栏 256px、顶栏 64px；文件目录 224px、内容水平留白 24px。列表无额外包裹卡片，权限组采用分隔行；页头动作与表格动作边界清楚。表格仅在本区域横向滚动。                                       |
| 颜色与 token     | 沿用当前 primary、muted、border、背景和语义状态 token。按钮圆角及品牌蓝与生成图不同，这是方案指定的主题约束；没有页面级覆写基础按钮样式。真实租户浅色和跟随系统深色均已观察，结束时恢复跟随系统。                                        |
| 图像、资产与图标 | 原型中的虚构员工头像、账号和示例文件不写入产品。沿用既有 AppSidebar 头像及 Lucide 图标，无重绘图标或模拟产品资产。现有文件图片预览在 390px 下清晰、比例正常，关闭入口可见。                                                              |
| 文案与内容       | 删除解释布局或复述标题的次级说明；去掉权限说明中的内部实现措辞，保留菜单可见性与授权的业务约束。同步清理不再使用的三语言说明词条。真实任职状态、岗位列、脱敏邮箱、角色与岗位数量、日期格式、完整权限目录、组织级搜索及配额沿用现有业务。 |

原型中“员工管理”的侧栏示例与当前系统的“用户管理”导航名不同；当前菜单名称来自现有导航数据，未通过布局重构改写业务菜单。权限页示例仅有 6 个资源组，真实实现使用完整的 19 组，因此保存按钮位于滚动后的表单底部。文件原型为 7 条示例记录，现有场景为 10 条，未据图删除数据或权限项。

## 浏览器验收

实际页面使用本地 3200 / 3201 和现有本地 API、个人开发数据库，未切换到隔离数据库。

- 真实员工搜索提交后 URL 保留 q=Admin、分页与排序参数，返回 1 条匹配记录；清除筛选恢复 3 条记录。
- 页头新建入口进入既有员工表单；空表单提交仍显示姓名、邮箱、密码校验；通过既有返回入口回到列表。未创建账号。
- 角色权限与员工授权链接互相切换，静态标题、角色身份和当前导航项正确；完整权限目录及单一保存按钮存在。未保存或改动真实权限。
- 暂挂真实岗位列表请求后，导航、岗位管理 h1 和页头入口保持显示，只有表格展示加载骨架；验收后已恢复请求。
- 有数据文件场景中搜索“秋季”仍搜索整个文件库，并显示所在文件夹；清除筛选恢复当前目录。预览关闭后焦点回到“秋季发布主视觉.png”。
- 320 / 390 / 768px 下，列表和文件工作台的 document.scrollWidth 均等于视口宽度；角色页 320 / 390px 同样无整页溢出；实际页面均为一个 main 和一个 h1。Storybook 自带的隐藏错误模板不计入产品标题。
- 小屏侧栏可打开并以 Escape 关闭；目录可展开；文件预览及关闭可操作。RTL 文件场景方向、目录、搜索和动作排列正确。
- 控制台已检查：开发环境出现 React 的 script tag 提示，未出现本次布局交互导致的运行异常；该提示也存在于组件测试输出中。

补充证据：[员工 320px](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/employees-320.jpg)、[员工 768px](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/employees-768.jpg)、[权限 320px](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/role-permissions-320.jpg)、[文件 390px](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/files-populated-390.jpg)、[文件预览 390px](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/files-preview-390.jpg)、[RTL](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/files-rtl-desktop.jpg)、[真实租户深色](/Users/huanancao/.codex/visualizations/2026/10/22/01a16368-b0b1-7863-bacd-060d201590f5/admin-layout-prototype-rebuild/tenant-files-system-theme.jpg)。

## 工程验证与边界

| 检查                  | 结果                                                                  |
| --------------------- | --------------------------------------------------------------------- |
| pnpm typecheck        | 25 / 25 通过                                                          |
| pnpm lint             | 25 / 25 通过；API 既有一处 no-floating-promises warning               |
| pnpm lint:boundaries  | 通过                                                                  |
| pnpm i18n:check       | 通过，三语言目录、插值、类型及词条提取一致                            |
| 两端生产构建          | tenant、platform 及所需依赖 6 / 6 通过                                |
| 受影响 Storybook 集合 | 16 个文件、291 项交互及无障碍测试通过                                 |
| 页头与角色焦点复测    | 4 个文件、106 项通过，与上一集合部分重叠，不累计为唯一测试总数        |
| 最后工具栏与权限复测  | 2 个文件、32 项通过，与上一集合部分重叠                               |
| 工作区                | 未暂存、未提交、未推送；既有 API CONTEXT 及两份知识库文档内容指纹未变 |

页头入口同步加载带来可测量的包体积取舍：相对修复前记录，HTML 初始引用的 JS 合计 gzip 大小，租户约从 434KB 增至 519KB，平台约从 435KB 增至 528KB。富文本及项目正文仍独立延迟加载。构建继续提示大于 500KB 的 chunk；本次没有通过抬高阈值隐藏告警，也没有测量生产网络下的加载时延。

本报告覆盖页面结构、所列浏览器交互和受影响组件测试。没有重新执行完整 API、数据库隔离和全量业务 E2E，也没有在真实组织中执行权限变更、上传、删除或账号创建；这些不作为本次布局验收已验证的结果。

## 完成清单

- [x] 三张原型的页面结构和操作分区落实到原有业务页面。
- [x] 复用公共页头、表格工具栏和文件浏览器，移除重复呈现及失效文案。
- [x] 页头独立于正文加载，标题与焦点行为已验证。
- [x] 桌面、窄屏、深色及 RTL 的所列状态已验收。
- [x] 当前没有尚待修复的 P0/P1/P2 布局发现。

final result: passed
