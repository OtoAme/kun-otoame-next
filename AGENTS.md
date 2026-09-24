# OtoAme

项目 skills 的唯一来源是仓库根目录 `skills/`。`.codex/skills`、`.claude/skills`、`.grok/skills` 都指向它。改 skill 只改 `skills/`。

动手改这个仓库的应用代码、测试、schema、缓存、API、前端、运维或部署之前，先完整读完对应 `SKILL.md`，再读其中 Required References 列出的 `docs/project/*` 和 `docs/modules/*`。先读 skill 和文档，再探代码或改文件。

| 场景                      | 先读                                 |
| ------------------------- | ------------------------------------ |
| 任何仓库开发              | `skills/otoame-development/SKILL.md` |
| API、鉴权、业务规则       | `skills/otoame-api/SKILL.md`         |
| Prisma、Redis、上传、迁移 | `skills/otoame-data-cache/SKILL.md`  |
| 页面、组件、主题          | `skills/otoame-frontend/SKILL.md`    |
| scripts、CI、维护命令     | `skills/otoame-operations/SKILL.md`  |
| 部署、PM2、环境变量       | `skills/otoame-deployment/SKILL.md`  |
| 测试                      | `skills/otoame-testing/SKILL.md`     |
| 审阅                      | `skills/otoame-review/SKILL.md`      |
| 中文更新日志              | `skills/otoame-changelog/SKILL.md`   |

仓库开发任务始终先读 `otoame-development`，再读对得上的领域 skill。分工表见 `skills/README.md`。

非 env 代码探索优先用 fast-context。排除 `.env`、`.env.*` 和凭据。
