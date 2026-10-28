# OtoAme 维护文档

本目录说明 OtoAme 网站程序怎样运转、业务规则以什么为准，以及怎样开发、发布和维护。文档描述仓库中的实现；某项能力是否已在线上启用，还取决于实际版本、数据库迁移和服务配置。

## 文档分类

文档按读者的目的分为三类，每个事实只在一个主要页面维护，其他页面给摘要和链接。

| 目录 | 回答的问题 | 文体 |
| --- | --- | --- |
| [concepts](#原理说明) | 系统由哪些部分组成，数据和请求怎样流转，为什么这样设计 | 原理说明，帮助建立整体认识 |
| [reference](#业务规则与参考) | 谁在什么条件下可以做什么，金额、额度、时限和冲突怎样处理 | 业务规则与参考，供查证 |
| [guides](#操作指南) | 怎样在本地运行、测试、发布、迁移和审阅 | 操作指南，有前提、步骤和失败处理 |

## 新开发者的阅读路线

适用于熟悉 Web 开发、但第一次接触本项目的开发者。前四步建立整体认识，之后按任务查阅。

1. **项目是什么**：读[项目首页](../README.md)，了解站点定位、功能和技术栈。
2. **系统怎样运转**：读[架构与职责](concepts/architecture.md)，掌握使用者、组成部分、一次请求的流转和可信边界。
3. **数据怎样保持一致**：读[数据、缓存与上传一致性](concepts/data-consistency.md)，理解事务、缓存刷新和文件补偿的分工；再读[性能策略](concepts/performance.md)，了解缓存层级与容量边界。
4. **跑起来**：按[本地开发指南](guides/development.md)在空库启动站点，并建立测试管理员。
5. **理解业务规则**：先读[参考索引](reference/README.md)了解各规则页的衔接，再按要改的功能阅读[页面与访问边界](reference/pages.md)和[权限与业务规则](reference/permissions.md)。
6. **开始修改**：读[项目协作指引](../AGENTS.md)和[技能分工](../skills/README.md)，按[测试指南](guides/testing.md)选择检查，按[质量与交付边界](concepts/quality.md)判断证据是否充分。修改前先查[已知代码问题](reference/known-issues.md)，避免把已知偏差当成规则。

## 原理说明

- [架构与职责](concepts/architecture.md)：使用者与入口、系统组成、请求流转、可信边界、运行与维护边界。
- [数据、缓存与上传一致性](concepts/data-consistency.md)：保存冲突、下载资格、缓存刷新范围、上传与清理补偿。
- [性能策略](concepts/performance.md)：静态页面、分层缓存、实时统计、并发与容量边界。
- [质量与交付边界](concepts/quality.md)：各类证据能证明什么，文档与技能怎样同步。

## 业务规则与参考

- [参考索引](reference/README.md)：各规则页的分工与衔接。
- [权限与业务规则](reference/permissions.md)：登录、投稿、资源、下载、反馈、链接健康、私聊、小喇叭、萌萌点、搜索与限频。
- [页面与访问边界](reference/pages.md)：公开网站、工作台和管理后台的入口与权限。
- [用户工作台与链接维护](reference/workspace.md)：本人编辑、补链、回应与暂缓。
- [前端与内容](reference/frontend.md)：编辑、消息、截图、内容渲染和前端验收要求。
- [私聊贴纸](reference/stickers.md)：贴纸目录、发送资格、导入同步与删除。
- [主题与颜色](reference/theme.md)：配色选择、深浅色模式和颜色含义。
- [数据库索引](reference/database-indexes.md)：索引职责与变更风险。
- [已知代码问题](reference/known-issues.md)：实现与预期不符、尚未修正的问题。

## 操作指南

- [本地开发](guides/development.md)：在空库启动、建立测试管理员、修改站点内容与主题。
- [测试与隔离验收](guides/testing.md)：选择相称的检查，准备一次性数据库与端到端验收。
- [部署与应用恢复](guides/deployment.md)：运行配置、发布已审核版本、确认切换与回退。
- [数据库与日常运维](guides/operations.md)：迁移、备份恢复、清理回填、定时任务与边缘缓存验收。
- [独立链接检测服务](../deployment/link-checker/README.md)：构建与验证固定版本的检测服务。
- [变更审阅](guides/review.md)：按后果核对变更并提交审阅结论。
- [文档标准](guides/documentation.md)：编写和审阅维护文档的要求。

## 哪些内容不是当前依据

[历史决策](../decision-making/)与[历史计划和设计稿](superpowers/)保存讨论与验收背景，不证明当前生产状态，也不代替现行文档。[线上文章源](../posts/)用于网站帮助和公告；[上游说明](../README_touchgal.md)记录原项目，不能用于本项目的数据库或部署操作。
