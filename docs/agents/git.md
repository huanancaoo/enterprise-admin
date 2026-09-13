# Git 协作规范

本项目使用 GitHub 作为协作平台，`main` 是集成分支。本规范的目标是让每项变更可追溯、可审查，并保护其他人正在进行的工作。

## 基本原则

- 建议在任务分支完成日常开发；是否直接向 `main` 推送或通过 PR 集成，遵循用户要求及仓库实际的分支保护规则。
- 一个分支只解决一个可独立审查的任务；不要将格式化、依赖升级或其他无关改动混入其中。
- 任何 Git 操作前都先检查工作区、当前分支和暂存区。未提交或未跟踪的文件属于现有工作，除非任务明确包含它们，否则必须保留。
- 自动化代理不得自行推送、创建或合并 PR，也不得改变远端分支；这些操作需要用户明确授权。

## 开始任务

开始修改前，执行以下检查以确认基线和本地改动边界：

```bash
git status --short --branch
git diff
git diff --cached
git worktree list --porcelain
```

- 若工作区不干净，只处理本任务文件；不要使用全局还原来“清理”工作区。
- 需要同步远端时，先执行 `git fetch origin`，再显式检查目标分支的差异和提交；不要以隐式合并或变基替代这一步。
- 并行任务使用独立 worktree。每个 worktree 只检出一个分支，且不要在其他 worktree 正在使用的分支上继续开发。

## 分支

- 新任务建议从最新的 `origin/main` 创建分支；用户指定基线或继续已有任务时，使用对应分支。
- 分支格式为 `<type>/<short-description>`，名称使用小写 kebab-case。
- `<type>` 使用 `feat`、`fix`、`docs`、`refactor`、`test`、`chore` 或 `ci`；如有 Issue，在描述中保留其编号，例如 `fix/123-login-timeout`。
- 删除本地任务分支前，确认变更已集成到目标分支，且没有其他 worktree 使用该分支；不以创建或合并 PR 作为唯一完成条件。

## 暂存与提交

### 暂存规则

- 暂存前检查已有暂存内容。只有文件内全部改动均属于本任务时，才按完整路径暂存，例如 `git add docs/agents/git.md AGENTS.md`。
- 同一文件混有其他任务的改动时，按变更块选择本任务内容，例如 `git add -p -- <path>`；不能准确拆分的内容先厘清归属，不得整文件暂存。
- 已有无关暂存内容必须保留其内容及暂存状态，不得一并提交，也不得擅自取消暂存。在原工作区无法独立提交本任务时，将已明确识别的任务改动放入独立 worktree 的任务分支后验证、提交，保留原工作区和暂存区；同一文件混合改动时同样按变更块隔离。
- 禁止用 `git add .` 或 `git add -A` 将未知改动一并纳入提交。
- 提交前必须检查暂存内容：

```bash
git diff --cached --check
git diff --cached
```

`git status` 会区分已暂存、未暂存和未跟踪的路径；上述检查因此是确认提交边界的必要步骤。

### 提交信息

提交采用 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：

```text
<type>[optional scope]: <short description>

[optional body]

[optional footer(s)]
```

- `feat` 表示新功能，`fix` 表示缺陷修复。
- 其他允许类型：`docs`、`refactor`、`test`、`perf`、`build`、`ci`、`chore`、`revert`。
- `scope` 是可选的受影响区域，例如 `feat(ui): add accordion component`。
- 标题简洁地说明结果；需要解释动机、影响或验证方式时，在空行后的正文中补充。
- 破坏性变更必须在类型或 scope 后使用 `!`，或在页脚使用 `BREAKING CHANGE: <description>`。
- 每个提交必须可独立理解并保持构建、测试或相应文档检查通过；不要提交密钥、令牌、`.env` 内容、构建产物或本地 IDE 状态。

## 验证与拉取请求

- 在提交和创建 PR 前，运行与修改范围相匹配的最小验证；代码变更必须运行相关 lint、类型检查、测试或构建。只改文档时，执行格式与链接检查即可。
- PR 必须包含：变更目的、主要实现、已执行的验证及结果、已知限制；UI 改动还应提供可复现的界面证据。
- 一个 PR 只对应一个目标。无关改动必须拆分，不得通过“顺带修复”扩大审查范围。
- 是否使用 PR，以及采用 merge、squash 或 rebase 集成，遵循用户要求和仓库设置；使用 PR 时满足其实际要求的审查和 CI 检查。
- 使用 squash 时，合并前检查并编辑最终生成的提交信息，使其同样符合上述提交规范；正文保持可选，但已有的关键动机、影响说明和破坏性变更信息应在最终提交中保留，不能直接依赖 GitHub 自动生成的消息。

## 历史与工作区安全

- 已推送分支不一律禁止改写；确需整理历史时，先确认用户已授权、仓库规则允许且协作者已协调。更新远端使用带明确预期旧提交的 `git push --force-with-lease=<ref>:<expected-old-sha>`，若远端已变化则重新检查，不得改用 `--force` 覆盖。
- 未推送的个人任务分支如需整理提交，先确认没有其他 worktree 或协作者依赖该分支，再进行 rebase 或 amend。
- 未经明确授权，禁止执行会丢弃或批量删除内容的命令：`git reset --hard`、`git clean -f/-fd`、`git checkout .`、`git restore .`、`git branch -D`。
- 需要撤销已发布改动时，使用新的 `revert` 提交保留审计记录；需要撤销本地未发布改动时，先由任务发起者确认精确文件和目标提交。
- 合并、切换分支或删除 worktree 前，重新检查 `git status --short --branch` 与 `git worktree list --porcelain`，确保不会覆盖本地工作。

## 参考

- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)：提交类型、scope 与破坏性变更标记。
- [Git `status` 文档](https://git-scm.com/docs/git-status)：工作区、暂存区和未跟踪文件的状态语义。
- [Git `worktree` 文档](https://git-scm.com/docs/git-worktree)：并行工作目录和分支占用约束。
- [GitHub 受保护分支文档](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)：通过审查和状态检查保护集成分支的机制。
