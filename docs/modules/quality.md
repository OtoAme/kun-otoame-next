# Quality, Testing, Review

本模块说明测试、review 和 Codex skills 的质量门槛。

## 测试入口

- `vitest.config.ts`
- `tests/unit/*`
- `docs/project/testing.md`

命令：

```bash
pnpm test
pnpm typecheck
```

当前没有 Playwright/E2E harness。涉及完整浏览器流程时，需要写清手动验证步骤。

## 当前测试覆盖

| 文件                                                   | 覆盖                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `tests/unit/theme.test.ts`                             | 主题 token 和语义色。                                                                 |
| `tests/unit/redis.test.ts`                             | Redis getOrSet、错误处理和缓存逻辑。                                                  |
| `tests/unit/jwt-session.test.ts`                       | Redis-backed JWT session、多设备、会话删除、legacy token 迁移。                       |
| `tests/unit/edit-store.test.ts`                        | 创建/重写 store 函数式合并，防止外部数据异步返回互相覆盖。                            |
| `tests/unit/company-merge-plan.test.ts`                | 公司 name/alias 脏数据自动合并计划和预览。                                            |
| `tests/unit/resource-link.test.ts`                     | 资源链接和提取码解析。                                                                |
| `tests/unit/api/resource-access.test.ts`               | 游戏详情资源列表链接脱敏、按需获取接口的资源归属 / 可见性校验和 no-store 响应。       |
| `tests/unit/resource-download-card.test.tsx`           | 下载卡片点击“获取下载链接”后展示真实链接、提取码、解压码，并展示获取失败错误。        |
| `tests/unit/resource-access-links-helper.test.ts`      | 资源编辑入口打开前按需水合完整链接，并保留排序和下载计数等预览字段。                  |
| `tests/unit/resource-classification.test.ts`           | 资源类型/语言/平台分类。                                                              |
| `tests/unit/patch-resource-attributes.test.ts`         | 游戏资源派生标签和卡片资源数只统计已发布资源。                                        |
| `tests/unit/search-store.test.ts`                      | 搜索 store。                                                                          |
| `tests/unit/captcha.test.ts`                           | CAPTCHA。                                                                             |
| `tests/unit/message-card.test.tsx`                     | 消息正文纯文本渲染和换行保留。                                                        |
| `tests/unit/user-message-bell.test.tsx`                | 顶栏消息铃铛只导航到通知中心，不在通知展示前标已读。                                  |
| `tests/unit/message-container.test.tsx`                | 通知列表首屏 hydrate 保留服务端数据，同时后台刷新当前页并防止旧分页响应覆盖新页。     |
| `tests/unit/chat-input.test.tsx`                       | 私聊输入法组合期 Enter 不发送、`Shift+Enter` 换行和发送去重。                         |
| `tests/unit/chat-container-realtime.test.tsx`          | 私聊实时同步、回复预览跳转、高亮反馈、浮动回底部按钮和滚动位置保持。                  |
| `tests/unit/api/message-unread.test.ts`                | 消息通知/私聊未读状态查询、通知已读/清理幂等和私聊已读写入。                          |
| `tests/unit/api/notification-toggle-abuse.test.ts`     | 取消收藏、取消点赞等关系移除路径不创建误导性通知。                                    |
| `tests/unit/api/mention-message.test.ts`               | 评论提及通知去重、跳过自己、忽略不存在用户并限制单条评论通知数量。                    |
| `tests/unit/api/conversation-service.test.ts`          | 私聊会话权限、创建竞态、图片消息、删除清理和基于 `last_message_id` 的列表摘要。       |
| `tests/unit/api/admin-resource-get.test.ts`            | 后台资源列表按资源链接或 BLAKE3 Hash 搜索。                                           |
| `tests/unit/api/admin-resource-update-message.test.ts` | 管理员后台修改他人资源时通知资源发布者、保留列表上下文并区分游戏资源 / 补丁资源日志。 |
| `tests/unit/api/patch-resource-update.test.ts`         | 资源更新前校验资源和游戏归属，避免错误派生属性和缓存刷新。                            |
| `tests/unit/admin-resource-container-layout.test.tsx`  | 后台资源表资源列宽、分页脱离表格横向滚动区并居中显示。                                |
| `tests/unit/admin-resource-render-cell.test.tsx`       | 后台资源列表资源名 / 游戏名两行展示。                                                 |
| `tests/unit/resource-links-input.test.tsx`             | 对象存储资源大小输入禁用，普通外链大小仍可编辑。                                      |
| `tests/unit/resource-details-form.test.tsx`            | 资源详情表单 label 不可选中，同时保留输入内容可选中。                                 |
| `tests/unit/resource-dialog-helper-text.test.tsx`      | 发布资源和更改资源链接弹窗说明小字不可选中。                                          |
| `tests/unit/api/*`                                     | API service 业务规则。                                                                |

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

## Codex Skill 设计

项目 skills 位于 `.codex/skills`。原则：

- Skill 保持精简，不复制长文档。
- Skill frontmatter 描述触发条件，不描述完整流程。
- 详细知识放在 `docs/project/*` 和 `docs/modules/*`。
- 新模块如果只是现有模块的子功能，优先更新现有 skill，不新增 skill。
- Skill body 应只保留必须读的路径、规则和验证命令；具体业务知识回链到文档。
- 通用入口 skill 可以稍长，领域 skill 目标控制在 100-250 words。

代码提交后的同步规则：

- Codex 创建的所有提交都必须使用约定式提交，格式为 `<type>(<scope>): <subject>`；用户给出非约定式提交信息时，应转换成最接近的约定式格式，意图不明确时再询问。
- 每个代码提交后都要检查并更新对应 docs 和 skill；重大行为、API、数据、缓存、部署、测试或工作流变更必须同步。
- 文档 / skill 同步必须单独提交，不能和业务代码、测试或迁移混在同一个 commit 中。
- 若某次代码提交确实不需要文档或 skill 内容变化，需要在最终说明或 PR 说明中写明已检查且无需更新。

当前 skill 分工：

| Skill                | 触发场景                                                             |
| -------------------- | -------------------------------------------------------------------- |
| `otoame-development` | 仓库通用开发入口和项目规则总览。                                     |
| `otoame-api`         | API routes、service、validation、业务权限和管理接口。                |
| `otoame-data-cache`  | Prisma、Redis、缓存失效、上传、S3、资源属性和迁移。                  |
| `otoame-frontend`    | App Router、React components、stores、主题、MDX、编辑器和 NSFW UI。  |
| `otoame-operations`  | scripts、migrations、cron、postbuild、release packaging 和维护命令。 |
| `otoame-deployment`  | PM2、Next standalone、CI/CD release、env vars 和生产部署。           |
| `otoame-testing`     | Vitest 测试、mock、目标测试选择。                                    |
| `otoame-review`      | 代码审阅、发布风险和未验证风险报告。                                 |

更新 docs 后必须检查对应 skill 的 Required References 是否仍指向正确文档；更新 skill 后必须检查 docs 中的 skill 列表和触发说明。

## 完成前证据

最低证据：

```bash
pnpm test
pnpm typecheck
```

文档/skill 变更还要做：

```bash
rg -n "T[B]D|TO[D]O|f[i]ll in|implement late[r]" docs .codex/skills README.md
```

建议再做：

```bash
find docs .codex/skills -type f -name '*.md' -print0 | xargs -0 sed -n '1,5p'
find .codex/skills -maxdepth 2 -type f -name 'SKILL.md' -print -exec wc -w {} \;
```

如果只改文档和 skills，`pnpm test` / `pnpm typecheck` 仍是有价值的回归信号，但失败时要区分是既有代码问题、环境问题还是文档改动引入的问题。
