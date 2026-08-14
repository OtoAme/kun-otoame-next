# 私聊 Sticker Pack

私聊贴纸使用独立的消息类型，不把普通文本中的占位符解析成贴纸。

## 消息和接口

- `user_private_message.type = 0`：文本。
- `user_private_message.type = 1`：图片。
- `user_private_message.type = 2`：贴纸，必须同时有 `sticker_id`。
- 回复贴纸使用 `reply_sticker_id`，回复预览会固化消息发送时的贴纸摘要。
- `GET /api/message/stickers` 返回当前用户可发送的 active 贴纸包。
- 私聊发送接口使用 `{ type: 2, stickerId: string }`，服务端只接受数据库中存在且当前用户有权使用的 Sticker，不接受客户端资源 URL。
- 普通文本中的 `:sticker_id:`、`[sticker:...]` 等内容始终按普通文本展示。

贴纸包下架后不会从数据库删除：下架包不再出现在发送面板，服务端也拒绝新发送；已有历史消息仍通过 `sticker_id` 读取资源。Sticker 记录或资源 URL 缺失时，消息 API 保留 `type: 2` 和 ID，前端显示 `贴纸不可用`。

## 资源格式

项目采用混合格式：

- 静态贴纸使用 `WebP`，避免把贴纸目录的基础解码能力绑定到 AVIF；同时 WebP 也作为动态贴纸 poster 的统一格式。
- 动态贴纸保留 `WebM/VP9`，不转成动画 WebP。
- 动态 WebM 必须配套 `poster WebP`，贴纸面板只加载 poster，聊天消息进入视口后才加载视频。
- 视频不包含音频；资源同步会按最长 3 秒、最高 30 FPS、最长边 512 px、最大 256 KB 校验。
- 静态 WebP 的宽高均不超过 512 px，文件不超过 512 KB。

动态视频播放失败或用户启用 `prefers-reduced-motion` 时使用 poster/不可用文案降级。对象存储资源使用一年缓存和 immutable URL，数据库目录保存 URL、key、MIME、尺寸、时长和帧率。

## Manifest 和资源目录

建议将用户提供的 ZIP 解压为一个临时资源目录，并使用同目录下的 manifest：

```json
{
  "pack": {
    "slug": "llm-moe",
    "name": "LLM Moe",
    "description": "内置贴纸包",
    "cover": "cover.webp",
    "price": 0,
    "status": 1,
    "isBuiltin": true,
    "sortOrder": 0
  },
  "stickers": [
    {
      "id": "llm-moe-happy",
      "file": "happy.webp",
      "alt": "开心",
      "sortOrder": 0
    },
    { "id": "llm-moe-wave", "file": "wave.webm", "alt": "挥手", "sortOrder": 1 }
  ]
}
```

资源同步命令：

```bash
pnpm stickers:sync -- --manifest=/path/to/stickers/manifest.json
pnpm stickers:sync -- --manifest=/path/to/stickers/manifest.json --apply
```

`pack.slug` 和每个 Sticker 的 `id` 会作为对象存储 key 的路径段，只允许字母、数字、`_` 和 `-`，并且 Sticker ID 在全局应保持稳定且唯一。

不带 `--apply` 时只校验并输出上传计划；`--apply` 才会上传对象存储并 upsert Sticker Pack/Sticker 目录。动态 WebM 的 poster 默认由首帧生成；manifest 中可以为动态 WebM 提供 `thumbnail` 覆盖 poster 来源。同步不会删除旧 Sticker 或对象，避免破坏历史消息。

对象存储 key 规则：

```text
sticker/<pack-slug>/cover.webp
sticker/<pack-slug>/<sticker-id>/asset.webp
sticker/<pack-slug>/<sticker-id>/asset.webm
sticker/<pack-slug>/<sticker-id>/poster.webp
```

## 数据库和部署

Prisma 模型在 `prisma/schema/sticker.prisma`，生产环境先执行只读 preflight，再执行对应 sync：

```text
migration/production-private-chat-stickers-preflight-2026-08-14.sql
migration/production-private-chat-stickers-sync-2026-08-14.sql
```

第一阶段只返回并允许发送 `is_builtin = true` 的 active 贴纸包，所有内置贴纸包免费可用，不实现支付流程。`price`、`status` 和 `user_sticker_pack` 用户所有权表为后续萌萌点购买与下架策略预留；后续接入购买时再放开非内置包的目录和发送权限。
