# 模块阅读路线

全套文档按任务的入口见[维护文档导航](../README.md)。本页说明模块之间怎样衔接，避免只看某一层而误判结果。

阅读[页面边界](app-router.md)可先找到用户从哪里进入，再读[业务规则](api-services.md)判断能否操作、收费和时限。涉及保存、下载凭据或文件失败时，继续读[数据与上传一致性](data-cache-upload.md)。页面显示与交互要求归[前端与内容](frontend-content.md)，颜色含义归[主题系统](../theme-color-system.md)。

[工作台与链接维护](workspace.md)贯穿本人权限、资源编辑、用户反馈和健康处理；[私聊贴纸](private-chat-stickers.md)贯穿目录管理、发送资格与媒体展示。它们引用公共业务规则，不另建一套授权或费用规则。

需要执行变更时，环境准备归[开发指南](../project/development.md)，应用发布归[部署指南](../project/deployment.md)，迁移和日常数据维护归[运维指南](operations.md)。[质量边界](quality.md)说明证据能证明什么，测试步骤和审阅要求分别归[测试指南](../project/testing.md)与[审阅指南](../project/review.md)。

进入源码前按[技能分工](../../skills/README.md)读取相应技能及必读文档。模块文档维护业务含义，源码链接提供精确追溯。
