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

| 文件 | 覆盖 |
| --- | --- |
| `tests/unit/theme.test.ts` | 主题 token 和语义色。 |
| `tests/unit/redis.test.ts` | Redis getOrSet、错误处理和缓存逻辑。 |
| `tests/unit/jwt-session.test.ts` | Redis-backed JWT session、多设备、会话删除、legacy token 迁移。 |
| `tests/unit/resource-link.test.ts` | 资源链接和提取码解析。 |
| `tests/unit/resource-classification.test.ts` | 资源类型/语言/平台分类。 |
| `tests/unit/search-store.test.ts` | 搜索 store。 |
| `tests/unit/captcha.test.ts` | CAPTCHA。 |
| `tests/unit/api/*` | API service 业务规则。 |

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

当前 skill 分工：

| Skill | 触发场景 |
| --- | --- |
| `otoame-development` | 仓库通用开发入口和项目规则总览。 |
| `otoame-api` | API routes、service、validation、业务权限和管理接口。 |
| `otoame-data-cache` | Prisma、Redis、缓存失效、上传、S3、资源属性和迁移。 |
| `otoame-frontend` | App Router、React components、stores、主题、MDX、编辑器和 NSFW UI。 |
| `otoame-operations` | scripts、migrations、cron、postbuild、release packaging 和维护命令。 |
| `otoame-deployment` | PM2、Next standalone、CI/CD release、env vars 和生产部署。 |
| `otoame-testing` | Vitest 测试、mock、目标测试选择。 |
| `otoame-review` | 代码审阅、发布风险和未验证风险报告。 |

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
