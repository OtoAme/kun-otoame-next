# 项目 Skills

本目录是 OtoAme 项目 skills 的唯一来源，属于项目资产，不属于某个 agent 工具。

## 目录布局

```
skills/                   # 唯一来源，git 跟踪真实文件
.codex/skills -> ../skills   # 软链接，供 Codex 自动发现
.claude/skills -> ../skills  # 软链接，供 Claude Code 自动发现
```

新增或修改 skill 时只改 `skills/` 下的文件。不要在 `.codex/` 或 `.claude/` 里放工具专用副本，否则内容会分叉。要接入新的 agent 工具时，按同样方式加一条指向 `../skills` 的软链接即可。

## Skill 分工

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
| `otoame-changelog`   | 用户侧中文更新日志。                                                 |

## 写作约定

Skill 只保留触发条件、必读文档、关键规则和验证命令；详细业务知识放在 `docs/project/*` 和 `docs/modules/*`，由 skill 回链。质量门槛与同步规则见 [../docs/modules/quality.md](../docs/modules/quality.md)。
