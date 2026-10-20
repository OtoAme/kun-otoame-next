# OtoAme 维护文档导航

这些文档帮助项目负责人理解业务边界，也帮助开发与运维完成具体工作。业务页说明条件、参与者与结果；操作指南集中维护命令、配置、迁移、备份和恢复。源码入口用于追溯实现，不能代替正文解释，也不能证明生产已上线。

## 按当前任务阅读

| 你要完成的任务 | 主要文档 |
| --- | --- |
| 了解项目、参与者与各系统职责 | [架构与职责](project/overview.md) |
| 判断谁能发布、审核、下载、付费或处理问题 | [权限与业务规则](modules/api-services.md) |
| 理解本人编辑、补链、回应与暂缓 | [用户工作台与链接维护](modules/workspace.md) |
| 查页面入口、公开范围与管理权限 | [页面与访问边界](modules/app-router.md) |
| 理解保存冲突、文件、下载资格与缓存 | [数据与上传一致性](modules/data-cache-upload.md) |
| 理解编辑、消息、截图和前端验收要求 | [前端与内容](modules/frontend-content.md) |
| 维护私聊贴纸目录和历史消息 | [私聊贴纸](modules/private-chat-stickers.md) |
| 理解主题、深浅色和颜色含义 | [主题系统](theme-color-system.md) |
| 准备本地开发环境或修改站点内容 | [开发操作指南](project/development.md) |
| 发布应用、配置运行环境或回退版本 | [部署与应用恢复指南](project/deployment.md) |
| 执行数据库迁移、清理、回填或缓存验收 | [运维操作指南](modules/operations.md) |
| 构建与验证固定版本的独立链接检测服务 | [检测服务操作指南](../deployment/link-checker/README.md) |
| 选择测试并准备隔离验收 | [测试操作指南](project/testing.md) |
| 审阅变更与发布风险 | [审阅指南](project/review.md) |
| 判断测试、文档同步是否足够 | [质量与交付边界](modules/quality.md) |
| 判断缓存、并发或索引方案的适用范围 | [性能策略](project/performance-optimization.md)、[索引职责](project/database-indexes.md) |
| 编写或更新维护文档 | [文档标准](project/documentation.md) |
| 选择项目技能 | [技能分工](../skills/README.md) |

先理解协作关系，再进入源码的读者可以使用[模块阅读路线](modules/index.md)。项目介绍与授权归属见[项目首页](../README.md)，协作约束见[项目指引](../AGENTS.md)。

## 哪些内容不是当前操作依据

[历史决策与计划](../decision-making/)保存讨论和验收背景，不证明当前生产状态，也不代替现行操作指南。[线上文章源](../posts/)用于网站帮助、公告等发布内容；[上游说明](../README_touchgal.md)记录原项目，不能直接用于本项目的数据库或部署操作。维护者应先读本导航中的现行说明，再核对实际运行版本。
