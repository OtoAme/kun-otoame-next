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

贴纸包禁用后不会从数据库删除：禁用包不再出现在发送面板，服务端也拒绝新发送；已有历史消息仍通过 `sticker_id` 读取资源。Sticker 记录或资源 URL 缺失时，消息 API 保留 `type: 2` 和 ID，前端显示 `贴纸不可用`。

## 管理后台

`/admin/stickers` 仅允许 `role >= 3` 的管理员访问，管理接口也会在 API 层重复校验角色和 CSRF。当前阶段只管理项目内置 Pack，不开放用户上传、购买或支付。

- Pack 创建后默认禁用；`slug` 必须是小写 snake_case，创建后不可修改，名称和描述可以编辑。
- 管理页使用 Pack 主从布局：桌面端通过 HeroUI Listbox 切换 Pack，移动端使用 HeroUI Select，右侧/下方直接编辑设置和 Sticker，不再把整个管理流程塞进大弹窗。桌面侧栏压缩为可滚动的粘性区域，只显示大尺寸静态封面和无文字的红绿状态点，并隐藏 Listbox 默认选中对钩，仅以清晰的背景色表示当前 Pack，把主要宽度留给右侧管理区；移动端 Select 的当前值和选项也显示相同状态点。HeroUI Badge 同时使用 `content=""` 和 `isDot`，确保状态点真实渲染。未保存设置会固定显示保存/撤销操作，切换 Pack 前必须确认放弃。服务端渲染的 HeroUI Select 使用页面内唯一的稳定 `id`，避免 React Aria 合并自动 ID 时产生 hydration 差异。
- 启用前必须存在至少一张有效 Sticker，并且显式设置的封面必须来自同一 Pack 的有效 Sticker；条件不满足时管理页直接禁用启用开关并通过 Tooltip 说明原因。动态 Sticker 的封面使用其 WebP poster；导入第一张有效 Sticker 时会自动设为默认封面。
- 禁用 Pack 不会删除 Sticker、对象或历史消息，但不会再出现在私聊发送面板，也不能用于新消息。禁用 Sticker 同样不影响历史消息展示。
- Sticker 支持 Pack 内全选、批量启用、批量禁用和批量删除。物理删除只用于误导入清理：Pack 必须先禁用；任何被历史消息或回复引用的 Sticker 都只能禁用，不能删除；存在用户所有权记录的 Pack 也不能删除。
- 物理删除先在数据库事务中删除记录，再 best-effort 删除对象存储中的 asset、poster 和独立 Pack 封面。对象清理失败不会恢复已提交的数据库事务，接口会返回失败数量并在服务端记录具体 key，便于后续补偿；管理页以警告提示“数据库删除已完成但资源清理不完整”，不把已成功的删除显示为操作失败。
- `POST /api/admin/stickers/import` 支持单张、多文件和 ZIP。单个 ZIP 上限为 32 MiB，单次导入及 ZIP 解压后总量上限仍为 64 MiB。ZIP 可以创建新 Pack 或导入已有 Pack；校验失败会返回逐文件原因，数据库事务失败会 best-effort 删除本次已上传的对象。该大体积上传路由不经过 middleware 的请求体缓冲，避免超过 Next 默认 10 MB 后 multipart 被截断；路由 handler 内仍先校验 CSRF、登录态和管理员角色，损坏或不完整的 multipart 返回 `400`。
- 管理页导入弹窗会列出本次选择的文件并保留服务端逐文件失败原因，同一失败不再额外弹出重复 Toast；导入成功后继续停留在目标 Pack 的 Sticker 标签。Pack 或 Sticker 仍处于启用状态时，永久删除按钮在前端直接禁用，API 保留最终校验。Sticker 批量操作栏在滚动网格时保持可达。

导入安全边界包括真实文件类型检查、WebM VP9/透明通道/无音轨检查、ZIP 路径穿越/符号链接/加密条目/ZIP Bomb 检查、重复内容 hash 检查和批量大小限制。部分导出工具会给全部条目添加一个 `/数字目录/` 根路径；导入器只会把单个前导 `/` 归一化为相对目录，仍拒绝 `..`、Windows 盘符和 UNC 绝对路径。服务端不信任客户端 MIME 或 CDN URL。

## 资源格式

项目采用混合格式：

- 静态贴纸使用 `WebP`，避免把贴纸目录的基础解码能力绑定到 AVIF；同时 WebP 也作为动态贴纸 poster 的统一格式。
- 动态贴纸保留带透明通道的 `WebM/VP9`，不转成动画 WebP。
- 动态 WebM 必须配套 `poster WebP`。Pack 封面始终只显示静态 poster；管理网格、私聊选择面板和回复预览等非封面缩略图会在接近可视区域时首次加载并循环播放 WebM。首次加载后保留同一个视频节点持续播放，滚动离开再返回时不会重新加载或重置播放进度。
- 视频不包含音频；资源同步和后台导入会按最长 3 秒、估算总帧数不超过 100 帧、最长边 512 px、最大 300 KB 校验，超限直接拒绝，不自动压缩。Telegram 的新素材制作规范仍建议最高 30 FPS；导入器不把 FFmpeg 从既有导出文件时间戳推算出的 `fps/tbr` 当成严格合规结论，因此可直接保留短时、名义帧率略高的 Telegram 导出 WebM，无需重编码。
- 静态 WebP 的宽高均不超过 512 px，文件不超过 512 KB。

动态视频播放失败或用户启用 `prefers-reduced-motion` 时使用 poster/不可用文案降级。播放开始前显示 poster，首个视频帧可用后移除 poster 层，避免透明视频与不同时间点的静态帧重叠。FFmpeg 生成 poster 时强制使用 `libvpx-vp9` 解码器保留 alpha。

对象存储资源使用一年缓存和 immutable URL；动态 poster 的 key 包含 poster 内容 hash，修复生成逻辑或更换自定义 poster 后会得到新 URL，不复用 CDN 中的旧内容。新导入资源只在数据库保存 `storage_key` / `thumbnail_storage_key`，运行时根据 CDN 配置派生 URL，旧的 URL 字段和旧版 `poster.webp` key 仅作为兼容回退。数据库目录同时保存 MIME、尺寸、时长、帧率和内容 hash。

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
sticker/<pack-slug>/<sticker-id>/poster-<content-hash>.webp
```

后台导入使用与同步脚本一致的 key 规则，其中 `<sticker-id>` 由 Pack、文件名和 SHA-256 内容 hash 派生。静态资源的 `thumbnail_storage_key` 可以为空，前端直接使用静态资源作为预览；动态资源必须有 poster。

## 数据库和部署

Prisma 模型在 `prisma/schema/sticker.prisma`。生产环境先执行原有私聊 Sticker schema 的只读 preflight/sync，再执行管理后台扩展的只读 preflight/sync：

```text
migration/production-private-chat-stickers-preflight-2026-08-14.sql
migration/production-private-chat-stickers-sync-2026-08-14.sql
migration/production-sticker-admin-preflight-2026-08-14.sql
migration/production-sticker-admin-sync-2026-08-14.sql
```

管理扩展迁移新增 Pack 封面资源 key、Pack 内封面 Sticker 外键、Sticker `status`、SHA-256 `content_hash`，并允许 `asset_url` 为空。执行 sync 前应检查 preflight 输出中的重复 hash 和无效封面引用；不要在生产库直接运行 `prisma db push`。

第一阶段只返回并允许发送 `is_builtin = true` 的 active 贴纸包，所有内置贴纸包免费可用，不实现支付流程。`price`、`status` 和 `user_sticker_pack` 用户所有权表为后续萌萌点购买与禁用策略预留；后续接入购买时再放开非内置包的目录和发送权限。
