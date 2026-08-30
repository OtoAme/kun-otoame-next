# Quality, Testing, Review

本模块说明测试、review 和项目 skills 的质量门槛。

## 测试入口

- `vitest.config.ts`
- `tests/unit/*`
- `docs/project/testing.md`

命令：

```bash
pnpm test
pnpm typecheck
```

当前没有统一的 `@playwright/test` config/runner 或 CI harness，但 `tests/e2e/*.e2e.ts` 有三套直接使用 `playwright-core` / HTTP 客户端的投稿与上传脚本。它们会写真实数据，只能连接单独 3100 服务和 disposable `touchgal_e2e`；运行边界见 `docs/project/testing.md`。

## 当前测试覆盖

| 文件                                                   | 覆盖                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/theme.test.ts`                             | 主题 token 和语义色。                                                                                                   |
| `tests/unit/redis.test.ts`                             | Redis getOrSet、错误处理和缓存逻辑。                                                                                    |
| `tests/unit/jwt-session.test.ts`                       | Redis-backed JWT session、多设备、会话删除、legacy token 迁移。                                                         |
| `tests/unit/edit-store.test.ts`                        | 创建/重写 store 函数式合并，防止外部数据异步返回互相覆盖。                                                              |
| `tests/unit/company-merge-plan.test.ts`                | 公司 name/alias 脏数据自动合并计划和预览。                                                                              |
| `tests/unit/company-identity-maintenance.test.ts`      | 公司身份碰撞盘点、权威 VNDB 证据回填计划，以及只允许权威 alias 驱动自动合并。                                           |
| `tests/unit/resource-link.test.ts`                     | 资源链接和提取码解析。                                                                                                  |
| `tests/unit/api/resource-access-policy.test.ts`        | 游客游戏资源每日/每周额度、登录用户和补丁资源免产品限额，以及 24 小时授权常量。                                         |
| `tests/unit/api/resource-access-grant.test.ts`         | 资源级 grant、`resource_grant` / `link_reveal` 分类、日/周边界、并发冲突和不延长授权。                                  |
| `tests/unit/api/resource-access-rate-limit.test.ts`    | 每 actor 技术限频、首次游客 IP 边界、Redis fail-open 和脱敏错误日志。                                                   |
| `tests/unit/api/resource-access.test.ts`               | Access route 的链接脱敏边界、归属/可见性、游客 cookie、授权结果、产品 429、技术限频和 no-store。                        |
| `tests/unit/api/resource-access-restore.test.ts`       | Restore 只读、只返回点过且仍有效的镜像，以及 429/503、no-store 和安全 outcome 日志。                                    |
| `tests/unit/resource-download-card.test.tsx`           | 下载卡片的镜像级展示、不重复授权时长说明、首次 grant 额度提示和组件内存敏感状态。                                       |
| `tests/unit/resource-download-restore.test.tsx`        | 按资源批量恢复、自动展开、未点镜像隐藏、请求竞态和失败后的单镜像重试入口。                                              |
| `tests/unit/resource-access-links-helper.test.ts`      | 资源编辑入口打开前按需水合完整链接，并保留排序和下载计数等预览字段。                                                    |
| `tests/unit/resource-classification.test.ts`           | 资源类型/语言/平台分类、游戏类型与中文支持类型配对、资料集/工具单独使用豁免及混合类型校验。                             |
| `tests/unit/patch-resource-attributes.test.ts`         | 游戏资源派生标签和卡片资源数只统计已发布资源。                                                                          |
| `tests/unit/search-store.test.ts`                      | 搜索 store。                                                                                                            |
| `tests/unit/captcha.test.ts`                           | CAPTCHA。                                                                                                               |
| `tests/unit/message-card.test.tsx`                     | 消息正文纯文本渲染和换行保留。                                                                                          |
| `tests/unit/user-message-bell.test.tsx`                | 顶栏消息铃铛只导航到通知中心，不在通知展示前标已读。                                                                    |
| `tests/unit/message-container.test.tsx`                | 通知列表首屏 hydrate 保留服务端数据，同时后台刷新当前页并防止旧分页响应覆盖新页。                                       |
| `tests/unit/chat-input.test.tsx`                       | 私聊输入法组合期 Enter 不发送、`Shift+Enter` 换行和发送去重。                                                           |
| `tests/unit/chat-container-realtime.test.tsx`          | 私聊实时同步、回复预览跳转、高亮反馈、浮动回底部按钮和滚动位置保持。                                                    |
| `tests/unit/api/message-unread.test.ts`                | 消息通知/私聊未读状态查询、通知已读/清理幂等和私聊已读写入。                                                            |
| `tests/unit/api/notification-toggle-abuse.test.ts`     | 取消收藏、取消点赞等关系移除路径不创建误导性通知。                                                                      |
| `tests/unit/api/mention-message.test.ts`               | 评论提及通知去重、跳过自己、忽略不存在用户并限制单条评论通知数量。                                                      |
| `tests/unit/api/conversation-service.test.ts`          | 私聊会话权限、创建竞态、图片消息、删除清理和基于 `last_message_id` 的列表摘要。                                         |
| `tests/unit/api/admin-resource-get.test.ts`            | 后台资源列表按资源链接或 BLAKE3 Hash 搜索。                                                                             |
| `tests/unit/api/admin-resource-update-message.test.ts` | 管理员后台修改他人资源时通知资源发布者、保留列表上下文并区分游戏资源 / 补丁资源日志。                                   |
| `tests/unit/api/patch-resource-update.test.ts`         | 资源更新前校验资源和游戏归属，避免错误派生属性和缓存刷新。                                                              |
| `tests/unit/patch-submission-*.test.ts` / `.test.tsx`  | 投稿押金与状态机、共享预览、重复外部 ID、素材清理 outbox、上传重试、权限和审核发布。                                    |
| `tests/unit/admin-resource-container-layout.test.tsx`  | 后台资源表资源列宽、分页脱离表格横向滚动区并居中显示。                                                                  |
| `tests/unit/admin-resource-render-cell.test.tsx`       | 后台资源列表资源名 / 游戏名两行展示。                                                                                   |
| `tests/unit/resource-links-input.test.tsx`             | 对象存储资源大小输入禁用，普通外链大小仍可编辑。                                                                        |
| `tests/unit/resource-details-form.test.tsx`            | 资源详情表单 label 不可选中、两行标签/选项提示与红色必填星号、HeroUI 分组标题排版、原有多选勾选、上拉方向和无边缘渐隐。 |
| `tests/unit/resource-dialog-helper-text.test.tsx`      | 发布资源和更改资源链接弹窗说明小字不可选中。                                                                            |
| `tests/unit/api/*`                                     | API service 业务规则。                                                                                                  |

## TDD 规则

行为变更和 bugfix 应先写失败测试：

1. 写最小测试。
2. 运行目标测试确认失败。
3. 实现最小修复。
4. 运行目标测试。
5. 运行相关测试或全量。

## Review 重点

详见 `docs/project/review.md`。项目特定高风险点：

- 角色和 CSRF。
- Prisma 事务、计数器和删除引用。
- Redis 缓存失效。
- 上传 lock、S3 compensation、finalize。
- 部署 standalone runtime assets。
- `.env` 与 CI secrets 同步。
- NSFW 过滤和标题隐藏。

## 项目 Skill 设计

项目 skills 是项目资产，不属于某个 agent 工具。唯一来源是仓库根目录 `skills/`，`.codex/skills` 和 `.claude/skills` 是指向它的软链接；只修改 `skills/` 下的文件，不要新建工具专用副本。原则：

- Skill 保持精简，不复制长文档。
- Skill frontmatter 描述触发条件，不描述完整流程。
- 详细知识放在 `docs/project/*` 和 `docs/modules/*`。
- 新模块如果只是现有模块的子功能，优先更新现有 skill，不新增 skill。
- Skill body 应只保留必须读的路径、规则和验证命令；具体业务知识回链到文档。
- 通用入口 skill 可以稍长，领域 skill 目标控制在 100-250 words。

代码提交后的同步规则：

- 本仓库的所有提交都必须使用约定式提交，格式为 `<type>(<scope>): <subject>`；用户给出非约定式提交信息时，应转换成最接近的约定式格式，意图不明确时再询问。
- 每个代码提交后都要检查并更新对应 docs 和 skill；重大行为、API、数据、缓存、部署、测试或工作流变更必须同步。
- 文档 / skill 同步必须单独提交，不能和业务代码、测试或迁移混在同一个 commit 中。
- 若某次代码提交确实不需要文档或 skill 内容变化，需要在最终说明或 PR 说明中写明已检查且无需更新。

Skill 分工表的唯一来源是 [`skills/README.md`](../../skills/README.md)，不在本文件和 `docs/modules/index.md` 中重复维护副本。

更新 docs 后必须检查对应 skill 的 Required References 是否仍指向正确文档；更新 skill 后必须检查 `skills/README.md` 的分工表和触发说明。

## 完成前证据

按改动范围分层验证，让验证成本随改动大小而不是测试总量增长：

```bash
# 1. 迭代中：只跑目标测试
pnpm test tests/unit/<target>.test.ts

# 2. 提交前默认门槛：受影响测试 + 类型检查
pnpm test:changed && pnpm typecheck

# 3. 全量：推送/发布前、共享基础设施改动、或 --changed 覆盖不到时
pnpm test

# 4. 构建产物受影响时（next.config、postbuild、部署脚本、依赖变更）
pnpm build
```

`pnpm test:changed`（`vitest run --changed --passWithNoTests`）按 git 未提交变更沿 import 反向图选出受影响的全部测试；提交后复核可用 `pnpm vitest run --changed HEAD~1`。共享模块（`lib/*`、`app/api/utils/*`、`validations/*`）的改动会自然扩散成大范围回归，`vitest.config.ts` 等 forceRerunTriggers 命中时自动回退全量。

`--changed` 的边界：只追踪 import 图。通过文件系统读取的资产不被追踪——改 `styles/*.css`（`theme.test.ts`）、`migration/*.sql`（各 migration 契约测试）、`prisma/schema/*`（source-guard 测试）、以及 README/docs/skills 里被契约测试直接读取的文件时，手动指定对应测试或直接跑全量。

只改 docs/skills 时 import 图同样选不出任何用例，但不等于免测：bootstrap、sticker、deploy 命令和主题契约测试会直接读取 README、部分 `docs/project/*`、`docs/modules/*`、`docs/theme-color-system.md` 和部分 `skills/*/SKILL.md`。docs/skills-only 提交必须做：

```bash
pnpm test:docs-contracts
rg -n "T[B]D|TO[D]O|f[i]ll in|implement late[r]" docs skills README.md
wc -w skills/*/SKILL.md
```

`test:docs-contracts` 固定列出所有通过文件系统读取文档/skill 的契约测试；新增这类测试时必须同步把文件加进该脚本。`wc -w` 用于核对领域 skill 的 100-250 words 预算；该预算适用于所有领域 skill，完整操作流程下沉到 Required References 指向的文档，skill 内只保留高风险不变量。
