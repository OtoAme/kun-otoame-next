# Data, Cache, Upload

本模块覆盖 Prisma、Redis 缓存、上传元数据、S3 和资源一致性。

## Prisma

生产库缺少 `patch_resource_access` 时，必须先运行
`migration/production-resource-access-bootstrap-preflight-2026-07-12.sql` 和对应 sync
精确创建 Phase 2 基础表，再运行现有 grant migration；不得用生产
`prisma:push` 代替。空表路径使用实际 `MAX(id)=0`，已有 Phase 2 或中断恢复路径
使用停机后的实际非负 max ID 和带时区 cutover。

入口：

- `prisma.config.ts`
- `prisma/index.ts`
- `prisma/schema/*`

`prisma.config.ts` 指向 schema 文件夹：

```ts
schema: 'prisma/schema'
```

`prisma/schema/schema.prisma` 只放 generator 和 datasource，模型按域拆分：

- `user.prisma`
- `patch.prisma`
- `patch-resource.prisma`
- `patch-comment.prisma`
- `patch-company.prisma`
- `patch-tag.prisma`
- `patch-rating.prisma`
- `patch-report.prisma`
- `conversation.prisma`
- `admin.prisma`
- `sticker.prisma`
- `moemoepoint.prisma`

`prisma/index.ts` 使用 `pg.Pool` 与 `PrismaPg` adapter：

- pool max：30。
- idle timeout：30000ms。
- connection timeout：5000ms。
- prepared statement name cache：1000。

Schema 修改后至少运行 `pnpm prisma:generate`。会影响数据库结构时运行 `pnpm prisma:push`；生产库如果出现 reset database 提示必须取消，改走 preflight/sync SQL 或 dry-run 脚本。

会社身份的最终 schema 使用 `patch_company.normalized_name NOT NULL UNIQUE` 与 `patch_company_external_id.(source, external_id)` 复合唯一；alias 身份的 `normalized_value` 保持普通索引，因为不同会社共享同一别名是可表示的合法状态。生产必须先完成 Phase A、身份回填与历史清理，再执行 `production-company-identity-constraint-*` 三份 SQL；只有 postflight 与 `prisma:deploy-safe` 通过后才能打开 resolver flag。

萌萌点账务使用 `user.moemoepoint_reserved`、`user_moemoepoint_ledger` 和 `user_moemoepoint_reservation`。总额保留在原 `moemoepoint` 字段；待结算不改变总额，可用余额在读取时计算为 `moemoepoint - moemoepoint_reserved`。明细和暂扣记录随账户保留，用户删除时级联删除；操作人/结算人删除时只把审计外键置空。生产先运行 `production-moemoepoint-ledger-preflight-2026-08-17.sql`，审核后运行对应 sync；sync 会为既有账户建立幂等的迁移初始余额明细，然后再运行 `pnpm prisma:deploy-safe` 校验 schema。

数据库层只对 `moemoepoint_reserved` 施加非负 CHECK，总额 `moemoepoint` **没有下限**：取消点赞、删除资源等回退必须真实扣回，账本才是完整审计链。不要在没有产品决策的情况下补一条 `moemoepoint >= 0` 约束，也不要在 service 里 clamp 回退金额；上线用的 dated preflight 会统计既有负余额账户，负数是预期结果而不是待修数据。投稿押金实际使用 `reserveMoemoepoint` / `releaseMoemoepoint` / `forfeitMoemoepoint` 与 `user_moemoepoint_reservation`，接入点见 [投稿域](api-services.md)，不要当成未启用的预留基础设施删改。

明细当前不设置 TTL，按账户生命周期完整保留。原因、关联链接和幂等键均使用有界短字段，日常记录通常远小于字段上限；上线后用 PostgreSQL 的 `pg_total_relation_size('user_moemoepoint_ledger')` 同时监控表和索引实际占用。若未来增长超出容量预算，应先把冷数据归档到只读存储并保留可查询入口，不直接截断审计明细。

私聊会话表 `user_conversation` 使用 `user_a_hidden` / `user_b_hidden` 保存每个参与方自己的列表隐藏状态。隐藏会话不是删除历史消息；发送新消息会把双方 hidden flag 恢复为 `false`。生产同步可先运行 `migration/production-conversation-hidden-preflight-2026-07-01.sql` 检查列状态，再运行 `migration/production-conversation-hidden-sync-2026-07-01.sql` 添加缺失列并补齐默认值。

Sticker 目录使用 `sticker_pack`、`sticker` 和 `user_sticker_pack`。后台新导入的资源把对象存储 key 写入 `storage_key` / `thumbnail_storage_key`，不把 CDN URL 当作唯一来源；`lib/s3.ts` 在读取时根据 CDN 配置派生公开 URL。动态 WebM 的 poster 必须先上传成功，Pack 启用和 Sticker 状态变更通过事务校验有效资源与同 Pack 封面。S3 上传后 DB 事务失败时必须删除本次对象，生产 schema 按 `production-private-chat-stickers-*` 再按 `production-sticker-admin-*` preflight/sync 执行；已经执行旧版 sync 的数据库再执行 `production-stickers-prisma-alignment-2026-08-15.sql`，然后运行 `pnpm prisma:deploy-safe`。

`patch.steam_id` 是普通可空字段，不是唯一字段；它保留普通索引用于软查重和 Steam 输入提示，因为合集或二合一商店页可能让多部游戏共用同一个 Steam App ID。生产库若仍有旧唯一约束或唯一索引，先运行 `migration/production-steam-id-soft-duplicate-preflight-2026-07-09.sql` 查看当前约束/索引和重复预览，再运行 `migration/production-steam-id-soft-duplicate-sync-2026-07-09.sql` 移除唯一约束并创建普通索引。

## Redis

入口：

- `lib/redis.ts`
- `config/cache.ts`
- `app/api/patch/cache.ts`

统一 key 前缀：

```text
kun:touchgal
```

基础 API：

- `setKv`
- `getKv`
- `getKvs`
- `delKv`
- `delKvs`
- `delKvPattern`
- `acquireKvLock`
- `releaseKvLock`
- `getOrSet`

`getOrSet` 支持 envelope、fresh/stale、single-flight、refresh lock、TTL jitter。新增缓存时优先复用，不要手写裸 Redis key。

约定：

- 传给 `setKv` / `getKv` / `delKv` / `delKvPattern` 的 key 不带 `kun:touchgal` 前缀，helper 会自动补。
- 只有需要 Redis hash、Lua、multi 或跨 key 原子操作时才直接用 `redis` + `runRedisCommand`，这类 key 要像 `app/api/patch/views/buffer.ts` 一样显式写完整前缀。
- 分布式锁必须用 token release，不要直接 `del` lock key。
- `delKvPattern` 使用 `SCAN` + 批量删除，适合明确业务前缀；不要传过宽 pattern。
- `getOrSet` 的 `shouldCacheValue` / `isCachedValueValid` 只用于拒绝明显异常的缓存值，例如首页 `home_data:*` 的空游戏列表；正常列表分页为空不能套用这个策略。

## Patch 缓存

入口：

- `app/api/patch/cache.ts`
- `app/api/patch/_content.ts`
- `app/api/patch/pageData.ts`

主要 key：

- `patch:<uniqueId>`
- `patch:introduction:<uniqueId>`
- `patch:favorite:<uid>:<uniqueId>`
- `patch:favorite:version:<uid>`
- `home_data:*`
- `galgame_list:*`
- `ranking_list:*`
- `resource_list:*`
- `company_list:*`
- `company_detail:*`
- `tag_galgame_list:*`
- `company_galgame_list:*`

写入游戏、资源、标签、公司后必须明确失效对应缓存。常用函数：

- `invalidatePatchContentCache(uniqueId)`
- `invalidatePatchListCaches()`
- `invalidateCompanyCaches(companyId?)`
- `invalidateTagCaches()`
- `deletePatchResourceCache(uniqueId)`
- `bumpPatchFavoriteCacheVersion(uid)`

这些失效函数会同时清理 Redis、触发 `safeRevalidatePath`，并通过 `app/api/utils/purgeCloudflareCache.ts` 清理公开页面或公开 API 的 Cloudflare 缓存。Cloudflare 环境变量缺失时 purge helper 会安全 no-op；业务写入不能因为边缘缓存清理失败而失败。

创建 / 重写主体提交后再执行的缓存失效必须逐项 best-effort：缓存或 IndexNow 故障只记日志，不能让已经提交的游戏、奖励或重写被 API 报成失败。公司 enrichment 抛错时仍额外失效公司缓存，避免部分外部写入已经落库却继续展示旧关系。

Cloudflare purge 约定：

- 公开 HTML 用 `purgePublicPageCache(paths)`，按完整 URL files 清理。
- 匿名公开 API 用 `purgePublicApiCache(paths)`，按 URL prefix 清理。prefix 不带 query string，`/api/tag/otomegame` 会覆盖 `/api/tag/otomegame?...` 的 query 变体。
- `/api/home`、`/api/tag/otomegame` 和 `/api/company/otomegame` 的匿名响应缓存也要配合 `invalidateAnonymousApiResponseCaches()` 清理 Redis/进程热缓存。

首页缓存约定：

- `home_data:*` 是首页静态 payload 的 Redis 缓存，正常匿名首页仍由 `app/page.tsx` 的 `force-static` payload 承载，不应每次客户端拉取。
- 部署或 ISR 期间如果查询到空 `galgames`，不能把这个空 payload 写入 `home_data:*`；已有空缓存也应视为无效并重新走 producer。
- `/api/home` 只作为空静态首页的客户端自愈接口。匿名响应可短缓存，但同样不能缓存空 `galgames` 响应；个性化 cookie 请求保持 `private, no-store`。

浏览量不是普通 patch cache：详情页由 `components/patch/view/PatchViewBeacon.tsx` 在客户端调用 `POST /api/patch/views`，该接口返回 `Cache-Control: private, no-store`，底层 `app/api/patch/views/buffer.ts` 使用 Redis hash 记录 `views:buffer`、`patch:stats:view` 和 `patch:stats:download`，`server/tasks/flushPatchViewsTask.ts` 每 2 分钟把 pending buffer 批量写入 PostgreSQL。静态首页卡片通过 `GET /api/patch/stats` no-store 接口拉取实时 view/download 并做客户端合并。改列表、详情、首页或排行统计时要同时检查实时叠加和落库任务。

评论、评分、下载、收藏、详情页 tag/company 关系会影响公开卡片统计、详情内容或 tag/company 页面。对应写入成功后必须清理内容缓存和列表缓存；仅更新评论正文/简评这类不改变列表计数的操作至少要清理内容缓存。后台更新/删除、举报处理和维护接口也要遵守同一规则。

patch-company 关系的创建、删除和外部数据拉取必须同时调用 `invalidateCompanyCaches` 和受影响 patch 的 `invalidatePatchContentCache(uniqueId)`。只失效公司/列表缓存会让公司页和游戏详情页给出互相矛盾的公司信息。

## 上传与 S3

入口：

- `app/api/upload/resource/route.ts`
- `app/api/upload/resourceUtils.ts`
- `app/api/patch/resource/_helper.ts`
- `app/api/edit/gallery/route.ts`
- `app/api/edit/galleryUpload.ts`
- `lib/s3.ts`

上传分两阶段：

1. `/api/upload/resource` 接收文件，验证登录、CSRF、扩展名、大小、角色、每日配额、待审核资源限制。
2. 文件写入本地 `uploads/<uploadId>`，计算 BLAKE3 hash，把 metadata 写入 Redis，TTL 24 小时。
3. 发布资源时调用 `consumeUpload(uploadId, userId)`，通过 Redis Lua 原子校验 owner 并加 consume lock。
4. 上传到 S3 key：`patch/<patchId>/resource/<hash>/<filename>`。
5. DB 写入完成后 `finalizeUpload` 删除 metadata 和 lock。
6. 失败时释放 lock 或删除已上传 S3 object。

资源上传限制来自源码：

- 文件大小：非空文件到 100 MB。
- 每日上传：5GB。
- `role < 2` 不可上传。
- `role < 3` 且可用萌萌点（总额减待结算）小于 20 不可上传。
- 创作者 `role === 2` 需要 CAPTCHA。
- 创作者或管理员才能上传对象存储资源。
- 普通创作者如果有待审核资源，不能继续发布新资源。
- 上传 handler 会先用 `updateMany` 增加 `daily_upload_size`，避免并发绕过配额。若后续流程失败，目前不会自动回退每日配额；改这里前要先设计补偿策略。

Gallery 图片上传走 `app/api/edit/gallery/route.ts` 和 `app/api/edit/galleryUpload.ts`，不使用资源上传的 Redis metadata/consume lock。规则：

- `patch_game_image.url` 保存原图 URL，旧路径保持 `patch/<patchId>/gallery/<imageId>.<ext>`；`patch_game_image.thumbnail_url` 是 nullable，只在真实生成缩略图时保存，路径为 `patch/<patchId>/gallery/thumbnail/thumb-<imageId>.<thumbExt>`，文件名显式带 `thumb-` 前缀，便于在浏览器 Network 中区分缩略图和原图。
- 创建页和重写页的 gallery 上传使用共享批处理队列：单张失败不能吞掉已成功图片，也不能让创建页在截图失败时清空 localforage 草稿或跳转详情页。创建页在主体已创建后保留整组 gallery 草稿和已创建 patch 目标，成功项标记 `uploaded`，失败项标记 `failed`，重试只上传失败项；重写页只把成功上传的新图写入已有图片列表，并把失败新图留在前端状态供重试。
- 浏览器网页图片拖拽不一定产生 `File`，尤其 Windows 从网页拖图时常只带 URL/HTML。远程拖拽导入走 `app/api/edit/gallery/remote/route.ts` 和 `app/api/edit/galleryRemoteImport.ts`：必须要求登录且 `role >= 3`，只允许 HTTP/HTTPS，DNS 解析结果和每次 redirect 目标都必须是公网地址，最大重定向 3 次，远程图片体积上限 8MB，并通过响应头或 magic bytes 限定为 JPG/PNG/WebP/AVIF。
- 静态 JPG/PNG/WebP/AVIF 会 resize 到 1920x1080 内，按水印开关 composite OtoAme 水印，再输出为 AVIF，单张输出上限 1.5MB；同时生成小尺寸 AVIF 缩略图。
- 动态 WebP 和动态 AVIF 优先保留动画，原样上传到 S3，不 resize、不重新编码、不添加水印，URL 后缀分别保持 `.webp` / `.avif`；动态 WebP 会尝试生成 animated WebP 缩略图。缩略图处理参考 PicList / picgo-plugin-compress 的保守策略使用 WebP quality 75、高 effort；但 gallery 的目标是降低预览解码尺寸，不能仅因缩略图字节数不小于原图就取消缩略图。Sharp 处理 animated WebP 时，`resize` 参数必须按单帧目标尺寸传入；帧数只用于限制单帧高度，避免内部纵向堆叠总高度超过 WebP 单边维度上限。缩略图生成或上传失败时不阻断原图，`thumbnail_url` 写 `null`。
- 动态原图上限 8MB；超过限制返回用户可见错误，不创建可见 gallery URL。
- 动态 AVIF 通过 ISO BMFF `avis` brand 在调用 Sharp 前短路处理，因为 Sharp AVIF 输出不支持 image sequence，不能把动态 AVIF 送入静态 AVIF 转码路径；V2 使用独立 `ffmpeg` adapter 尝试生成真实 animated AVIF 缩略图，动态缩略图失败时再尝试真实首帧 AVIF 缩略图。adapter 依次尝试 `KUN_GALLERY_FFMPEG_PATH`、standalone `.ffmpeg/ffmpeg`、根目录 `node_modules/.ffmpeg/ffmpeg`、`ffmpeg-static` 和系统 `ffmpeg`。没有可用 encoder、编码超时、生成体积超过 512KB 或上传失败时不阻断原图，`thumbnail_url` 写 `null`，不生成占位图。
- gallery 写入成功后要更新 `patch_game_image.url` 和 nullable `thumbnail_url` 并调用 `invalidatePatchContentCache(uniqueId)`；S3 上传或 DB 更新失败后删除已创建的 `patch_game_image` 记录，并补偿删除已真实上传的原图和缩略图 object。
- gallery 图片删除必须在删除 DB 记录的同时清理 S3 对象：
  - rewrite、整条目删除和 `DELETE /api/edit/gallery?imageId=xxx` 都要先从库中 URL 反解 key，再删除 DB 记录。
  - canonical `patch/<patchId>/...` 对象仍在事务提交后 best-effort 删除；`patch-submission/...` 对象必须在同一数据库事务写入 `patch_submission_orphan_cleanup`，事务外才允许尝试 S3 删除与 CDN purge。失败保留 job，由维护命令重试。
  - `extractS3Key` 同时接受 `KUN_VISUAL_NOVEL_IMAGE_BED_URL` 与 `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` 的精确 base；外部 URL 和相似 hostname 必须拒绝。
- animated AVIF 缩略图 adapter 使用临时目录处理用户输入，`ffmpeg` 子进程有超时限制，并且输出体积必须在缩略图上限内；animated 输出成功后还会用 `showinfo` 确认输出帧数大于 1，避免把静态首帧误判为 animated AVIF 缩略图。部分 Linux FFmpeg 会把 AVIF 的默认 stream 解析为 1 帧 still item，adapter 会继续探测后续 video stream 并选择多帧 stream 编码缩略图。`ffmpeg-static` 的 install script 必须允许运行，否则 bundled binary 可能不存在。`ffmpeg-static` 下载的是安装机器当前平台的 binary，`deploy:pull` 需要把目标服务器 `node_modules/ffmpeg-static` 注入 standalone，避免 release artifact 构建机和生产机架构不一致。部署环境没有可用 animated AVIF encoder 时会自动回退为无缩略图或静图首帧。引入其他 libavif / Node binding 方案前仍要先评估部署成本、CPU 成本、失败补偿和安全边界。
- 部分 `ffmpeg-static` Linux binary 可以解码 AVIF 但不能稳定输出 animated AVIF。需要强 animated AVIF 缩略图时，在 Linux x64/arm64 服务器显式运行 `pnpm gallery:ffmpeg:install` 下载 BtbN 静态构建到 `node_modules/.ffmpeg/ffmpeg`，或用 `KUN_GALLERY_FFMPEG_PATH` 指向自备 FFmpeg 的绝对路径。`KUN_GALLERY_FFMPEG_PATH` 优先级最高，修改 `.env` 后需要重启服务；`postbuild.ts` 会把 `node_modules/.ffmpeg/ffmpeg` 复制到 standalone 的 `.ffmpeg/ffmpeg`；普通安装不自动下载该大文件，保持默认部署较轻。
- 本地或部署前可用 `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]` 验证 animated AVIF 缩略图 encoder；该脚本只读写本地文件，不连接 S3 或数据库，并会列出各候选 FFmpeg 对输入和输出解析到的帧数及非默认 video stream。生产上线前应在目标服务器执行，成功输出 `Wrote animated AVIF thumbnail: ... frames ...`。
- 历史 gallery 缩略图回填使用 `pnpm maintenance:gallery-thumbnails:dry` 和 `pnpm maintenance:gallery-thumbnails:apply`。dry-run 只扫描 `thumbnail_url IS NULL` 的本站 gallery 原图并统计，不下载原图、不写 S3、不写 DB；apply 只上传真实缩略图并回填 `thumbnail_url`，不会重传或改写原图。生产默认按低负载运行：`--limit=50 --batch=20 --concurrency=1 --delay=1000`，建议分批执行；3c 服务器或正在承载线上流量时保持 `--concurrency=1`，必要时加 `--skip-animated-avif` 跳过 FFmpeg 成本较高的动态 AVIF。常用范围参数：`--patch-id=123`、`--start-id=456`、`--limit=50`、`--max-original-mb=8`、`--verbose`。summary 中 `galleryTotal` 是当前范围 URL 非空的 gallery 图片总数，`alreadyWithThumbnail` 是已有 `thumbnail_url`、无需回填压缩的数量，`missingThumbnail` 是仍缺 `thumbnail_url` 的数量，`scanned` 是本次查出并检查的缺缩略图候选数，`eligible` 是符合回填规则的数量，`updated` 是 apply 实际写入 `thumbnail_url` 的数量，`skipped` 是候选中被规则跳过的数量，`failed` 是未恢复错误数量；`scanned=0` 且 `missingThumbnail=0` 表示当前范围没有缺 `thumbnail_url` 的 gallery 候选项，不代表没有 gallery 图片。

私聊图片上传走 `app/api/message/conversation/[id]/image`，不使用资源上传的 Redis metadata/consume lock，也不写入 gallery 表。它有自己的短期 Redis metadata，用来证明发送请求里的图片 URL 来自同一会话、同一用户的上传流。规则：

- 只允许会话成员上传，handler 内必须校验登录态和 CSRF。
- handler 在登录态和严格会话 ID 校验后、读取 multipart `formData()` 前先执行 `image-upload-intake` 用户级限频，避免过量上传请求消耗表单解析内存和 CPU。
- 支持 JPG/PNG/WebP/AVIF，单张入站上限 8MB；超出该上限或超过 Next 默认 10MiB 客户端 body 缓冲上限时，route 必须返回 `413` 和“图片大小不能超过 8 MB”的用户可见字符串。静态图片按 create gallery 的尺寸策略 resize 到 1920x1080 内并输出 AVIF，不添加水印。输出 AVIF 仍超过 1.5MB 时返回用户可见错误。
- Sharp 解码/压缩或处理后 metadata 读取失败时，上传服务必须返回“图片处理失败，请重新选择有效图片”，并回滚本次小时额度和已扣萌萌点，不能把坏图片或处理失败冒成 500。
- S3 key 使用 `conversation/<conversationId>/<uid>-<timestamp>-<uuid>.avif`，避免不同会话或用户文件名冲突。
- `uploadImageToS3` 必须传入 `image/avif`，返回 metadata 也以最终 AVIF 的宽高、大小、MIME 和文件名为准。
- 通过会话成员、类型和大小校验后，上传服务必须先重新检查收件人的 `allow_private_message`。如果对方已关闭接收私信，直接返回用户可见错误，不消耗真实 `image-upload` 动作限流、小时 quota、萌萌点、Sharp 转码或 S3 写入。
- 上传接口只返回 URL、MIME、尺寸和大小等发送消息所需 metadata；同时用 `setKv` 写入 `conversation:image-upload:<conversationId>:<uid>:<urlHash>`，TTL 为 1 小时。真正创建消息仍由 `/api/message/conversation/[id]` 完成，发送服务用 Redis Lua 按会话、用户和 URL hash 原子校验每张图片 metadata 并删除登记；登记缺失或不匹配时拒绝发送并提示重新上传，避免客户端伪造任意图片 URL，也避免同一个上传凭证被重复发送成多条图片消息。若发送服务已消费 metadata 但消息 DB 事务失败，必须 best-effort 重新写回这些 metadata，保留原 1 小时 TTL，方便用户重试发送。
- 每个用户每小时有 5 张私聊图片免费上传额度，Redis key 为 `conversation:image-upload-quota:<uid>`，使用 Lua 原子 `INCR` + `EXPIRE`。从第 6 张起每张在 Sharp/S3 之前通过 `spendMoemoepoint` 按可用余额原子扣 5 点并写明细。余额不足时回滚本次 quota 计数并拒绝上传；压缩、metadata 读取、S3 上传或 Redis metadata 登记失败时也回滚 quota，并通过 `refundMoemoepoint` 退回已扣点数和记录退款明细。小时 quota Redis 不可用时上传 fail-closed，返回可重试错误，不继续产生图片处理或对象存储成本。
- S3 上传成功但 Redis metadata 登记失败时，上传服务必须调用 `deleteFileFromS3` best-effort 删除刚上传的 object，再返回“图片上传记录保存失败，请稍后重试”。用户上传后一直未发送、或发送前 metadata 过期时，S3 对象由 `pnpm maintenance:conversation-images:dry` / `apply` 清理。该脚本扫描 `conversation/` 前缀，只处理符合 `conversation/<conversationId>/<uid>-<timestamp>-<uuid>.avif` 规范且默认超过 2 小时的对象，并在删除前检查非删除 `user_private_message` 的 `image_url`、`image_group` 和 `reply_image` 是否仍引用该 key；tombstone 行遗留的旧图片字段不阻止孤儿清理。dry-run 默认 `--limit=200`，不写 S3/DB；apply 默认 `--limit=100 --batch=50 --concurrency=1 --delay=1000`，适合生产低负载分批执行。可用 `--conversation-id=123` 缩小前缀，`--older-than-hours=N` 延长安全窗口。
- 删除已发送的私聊图片消息时，`deleteMessage` 会先设置 `is_deleted = true`，再 best-effort 清理该消息中不再被其他未删除消息引用的 canonical `conversation/` S3 objects；如果消息已经是 tombstone，重复删除直接返回成功，不重复写 DB 或重跑 S3 cleanup。删除前会从 `KUN_VISUAL_NOVEL_IMAGE_BED_URL` 或 `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` 提取 key，并拒绝非本站 URL 或不符合私聊图片 key 规范的对象；引用检查或 S3 删除失败只记录错误，不回滚消息 tombstone，仍由孤儿清理脚本兜底。
- 回复图片时，`user_private_message.reply_image` 保存被引用图片的 metadata 快照；它来自同会话被回复消息的图片组索引校验结果，不直接信任前端传入完整图片对象。

消息动作限频走 `app/api/message/conversation/rateLimit.ts`，使用 Redis Lua 原子 `INCR` + `EXPIRE` 固定窗口。key 使用 `conversation:rate-limit:<action>:<uid>`，通过 `getPrefixedRedisKey` 显式加上 `kun:touchgal` 前缀后传给低层 `redis.eval`。当前 action 和阈值：

- `send`：发送私聊消息 30 次/分钟。
- `image-upload-intake`：私聊图片上传入口 30 次/分钟，在 route 读取 multipart `formData()` 之前执行，用于保护表单解析成本。
- `image-upload`：私聊图片上传 10 次/5 分钟，在会话成员、文件类型/大小和收件人隐私校验之后执行，用于保护小时额度、Sharp 转码和 S3 写入成本。
- `conversation-open`：私聊检查/打开 60 次/分钟，用于保护用户资料页预检、创建和恢复隐藏会话入口；route 在 DB 读取、扣点、创建或恢复可见性之前执行该检查。
- `conversation-manage`：私聊移除/隐藏 30 次/分钟，用于保护 `user_conversation` hidden flag 和未读计数写入；HTTP route 在调用 `deleteConversation` 之前执行该检查，命中限流时不读取会话记录，service 也在会话成员校验之后、隐藏写入之前保留兜底检查。route 预检查通过后调用 service 时要跳过兜底，避免一次请求消耗两次管理额度；重复移除已隐藏且未读为 0 的会话直接 no-op。
- `message-read`：私聊会话列表读取、私聊消息拉取、服务端首屏聊天加载和已读同步共用 180 次/分钟，用于保护会话列表后台刷新、活跃聊天轮询、历史拉取、首屏 RSC 加载和 read-sync 对应的 DB 查询/写入；route 或 server action 在读取会话和消息、或清理未读计数前执行该检查。前端正常会话列表约每 15 秒刷新一次，活跃会话约每 2 秒轮询一次并可能补一次状态查询，180 次/分钟是异常请求熔断，不是普通聊天节流。
- `message-write`：单条私聊消息编辑/删除 60 次/分钟，用于保护编辑 DB 写入、删除 tombstone 写入，以及删除图片消息时的 S3 引用检查和 best-effort cleanup；service 在会话成员校验之后、消息行读取之前执行该检查。
- `notification-read`：普通站内通知列表 `/api/message/all` 和未读同步 `/api/message/unread` 共用 180 次/分钟，用于保护通知列表分页、顶栏/消息导航未读轮询对应的 `user_message` 与 `user_conversation` 读取；route 在通知 DB 读取前执行该检查。
- `notification-write`：普通站内通知标已读和清理已读 `/api/message/read` PUT/DELETE 共用 30 次/分钟，用于保护 `user_message` 状态写入和删除；route 在 `readMessage`、`clearReadMessage`、以及后续未读状态重读前执行该检查。

限频命中时 service 返回结构化限流结果，由 route 转成 `429 Too Many Requests`、`Retry-After` 秒数和 `private, no-store` 响应；响应体保留用户可见字符串。动作限频 Redis 检查失败时 fail-open 并记录错误，避免 Redis 短暂故障阻断文字私聊；图片小时 quota/扣费链路 Redis 不可用时 fail-closed，避免无法计费时继续写 S3。

投稿域（`app/api/patch-submission/rateLimit.ts`）在这个依据上再分三层，**不要当 bug 改回统一 fail-open**：

- **fail-closed**：新建草稿（20/小时）、提交（20/小时）、素材上传（30/10 分钟）。这些碰钱或产生 S3 成本，Redis 不可用时宁可拒绝。
- **fail-open**：草稿读取（240/分钟）、自动保存（120/分钟）。纯技术限频，Redis 抖动不应打断用户编辑。
- **不设限频**：删除返还、管理员驳回/批准/违规结算。这与 fail-open 不是一回事——fail-open 超阈值仍返回 429，而返还押金的路径连 429 都不能有，否则用户的押金会被计数器卡住。这些路径的最终防线是数据库状态机与结算幂等键。

## S3

`lib/s3.ts` 使用 AWS SDK v3：

- endpoint：`KUN_VISUAL_NOVEL_S3_STORAGE_ENDPOINT`
- region：`KUN_VISUAL_NOVEL_S3_STORAGE_REGION`
- bucket：`KUN_VISUAL_NOVEL_S3_STORAGE_BUCKET_NAME`
- credentials：`KUN_VISUAL_NOVEL_S3_STORAGE_ACCESS_KEY_ID`、`KUN_VISUAL_NOVEL_S3_STORAGE_SECRET_ACCESS_KEY`
- maxAttempts：3

操作：

- `uploadImageToS3`
- `uploadVideoToS3`
- `uploadFileToS3`
- `deleteFileFromS3`
- `cleanupLocalUpload`

`uploadImageToS3` 默认 content type 是 `image/avif`。如果上传原样动态 WebP 等非 AVIF 图片，调用方必须显式传入正确 content type，避免对象存储或 CDN 以错误 MIME 返回。

删除资源前必须确认没有其他 `patch_resource_link` 引用同一 content。

`extractS3Key` 定义在 `app/api/patch/resource/_helper.ts`，patch 域四个从库中 URL 反解 S3 key 的删除路径（rewrite 提交、整条目删除、单图删除、资源链接删除）统一复用它，不要在 patch 域另写解析。它只接受以 `KUN_VISUAL_NOVEL_IMAGE_BED_URL` 或 `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` 精确 base 开头的 URL；删除逻辑遇到非本站 URL 或相似 hostname 会拒绝删除并记录错误，这是防止误删外部链接的保护。私聊图片删除使用专门的 `extractConversationImageS3Key`（在同样的 base 校验之外还校验 `conversation/` key 格式），Gallery 缩略图回填脚本使用自己的 `getGalleryBackfillS3Key`；这两处是有意独立的实现，不要把它们合并进 `extractS3Key`，合并会丢掉私聊更严格的 key 校验。

### 投稿素材的 key 布局（不同于正式条目）

通过 `/edit/create` 直接创建的正式条目素材在 `patch/<patchId>/banner/*` 与 `patch/<patchId>/gallery/*`（canonical 布局，`scripts/galleryThumbnailBackfill.ts` 与 `app/api/utils/purgeCache.ts` 依赖它按 patchId 推导 URL）。

投稿素材**不遵循这个布局**：它写在 `patch-submission/<submissionId>-<随机>/...`，key 由服务端生成、不可猜测。批准时素材不搬动, 直接成为正式条目引用的对象, 所以：

投稿画廊是暂存上传：拖入只写浏览器本地 outbox（localforage），点击「上传」才产生服务端行与 S3 对象，因此误拖不再制造需要 orphan cleanup 回收的对象。水印开关按投稿 ID 持久化在同一 store，上传时冻结进每个 item。浏览器侧的三份记录（items、watermark、order）只能由浏览器清理：删除草稿成功后由 `SubmissionList` 统一清除，服务端无法触及。

- `draft` / `pending` / `changes_requested` 行上的 key 是活动引用；`published` 行上的 key 只作原始投稿溯源，线上保护只看 `patch` / `patch_game_image`；`rejected` / `violation` / `deleted` 行上的非空 key 是待完成的投稿行 outbox。只有后三种状态可进入 `takeDownSubmissionAssets`。
- 投稿行 outbox 用于已知投稿的结算：先删 S3，再 purge 所有已配置公开 base，全部确认后才清空 banner key 并删除 gallery 行。部分 S3 删除失败仍要 purge 已删对象；Cloudflare 只有 HTTP 成功且响应 `success: true` 才算确认。
- 真正无所属行的 orphan、上传补偿、正式条目换图或删图不能靠投稿行保存重试凭据。删除这些对象前必须在同一个短数据库事务 upsert `patch_submission_orphan_cleanup`，保存 object key 与当时所有 purge URL；事务外执行 S3 和 HTTP，二者都成功才删 job。配置 hostname 后续变化时，旧 purge URL 仍须保留并与新 URL 合并。
- 每次执行 durable orphan job 都要重新计算 serving references。被活动投稿或正式 `patch` / `patch_game_image` 引用的对象要取消 job，绝不能删除；历史 CDN hostname 下但路径仍为 `/patch-submission/` 的正式 URL要 fail-safe 视为引用。
- 清理命令（`scripts/cleanupSubmissionAssets.ts`）按“终态投稿行 outbox → 已持久 orphan jobs → 过宽限期的新 S3 orphan”处理。dry-run 不写 job；apply 发现新 orphan 时先落 job，再允许删除。
- `patch_submission_gallery.id` 与批准后新建的 `patch_game_image.id` 没有对应关系。投稿来源 gallery key 只能从库中 URL 反解，不能按正式行 ID 推导；`scripts/galleryThumbnailBackfill.ts` 的 canonical 路径检查必须继续跳过这些对象。
- 已发布条目在 rewrite 页继续添加截图时，`POST /api/edit/gallery` 先按 `patch_id` 查关联的 `patch_submission`：有关联就为每次上传生成新的 `patch-submission/<submissionId>-<随机>/gallery` 前缀，无关联才使用 canonical `patch/<patchId>/gallery`。`uploadPatchGalleryImage` 必须返回实际写入的原图/缩略图 key，route 用返回 key 组装数据库 URL，不能再按行 ID 重新推导。这样投稿来源条目的后续截图保持同一种可识别、可持久清理的路径；历史混合路径仍须按库中 URL 正确删除。
- `purgeCache.ts` 按 patchId 推导的三个封面 URL 对投稿 key 是空推。换封面时旧投稿 key 由 durable orphan outbox 清理。
- 未审素材是公开可取的，被预览后可能进 CDN，因此 `reject` / `violation` / 用户删除必须隐藏 DTO，并连带 purge 封面三变体与每张图的主图、缩略图 URL。
- 投稿 gallery 上传把 `watermark` 传给共享 `preparePatchGalleryImage`；静态图按开关处理，动态 WebP/AVIF 沿用共享规则跳过水印。批量 NSFW 更新必须锁投稿并验证所有 gallery ID 归属，不能改写其他投稿的行。
- 投稿 gallery 的浏览器重试凭据存于 localforage：Blob + 文件元数据 + 服务端幂等使用的稳定 `clientAssetId`。失败和刷新中断都保留；服务端 ready 后才移除。上传 API 对已经 ready 的同 ID 必须返回完整公开 gallery DTO，不能要求客户端重新生成 ID，否则会产生重复行。

## 资源派生属性

`utils/patchResourceAttributes.ts` 定义资源可见口径：只有 `patch_resource.status = 0` 的已发布资源能参与游戏卡片和详情页的资源派生信息。`app/api/patch/resource/_helper.ts` 的 `updatePatchAttributes`、`scripts/rebuildPatchResourceAttributes.ts`、`migration/reclassify-resource-types.ts` 和卡片 / 详情页 `_count.resource` 查询都应复用这个口径。

`updatePatchAttributes` 会根据审核通过的资源重新汇总 patch 的：

- `type`
- `language`
- `platform`
- `resource_update_time`

新增资源类型、语言或平台时要同步检查：

- `constants/resource.ts`
- `validations/patch.ts`
- 资源发布/编辑组件
- `tests/unit/resource-classification.test.ts`

游戏资源的 `pc` / `emulator` / `mobile` 类型无论是否同时选择 `material` / `tool`，都必须与 `official-zh` / `chinese` / `machine` / `row` 中至少一个中文支持类型同时出现；仅选择 `material` 或 `tool` 时不需要且不允许中文支持类型。该约束由 `constants/resource.ts` 的共享 helper 和 `validations/patch.ts` 的 create/edit/update schema 共同维护。

资源增删改审核通过后要调用 `deletePatchResourceCache(uniqueId)` 或等价的内容缓存 + 列表缓存失效，避免详情页、资源列表、排行和标签/公司游戏列表读到旧属性。

资源更新前必须确认资源当前 `patch_id` 等于提交的 `patchId`。这个校验要发生在 S3 上传消费、链接重建、`updatePatchAttributes` 和 `deletePatchResourceCache` 之前，避免过期后台列表或篡改请求把派生属性和缓存失效打到错误游戏上。

历史脏数据修复使用 `pnpm maintenance:resource-attributes:dry` 预览、`pnpm maintenance:resource-attributes:apply` 应用；脚本同样只按已发布资源重算 `type`、`language` 和 `platform`。`pnpm migration:patch-counters` 安装的 `resource_count` 触发器也只计入已发布资源，并在资源审核状态变化时同步增减。

## 下载授权与事件

下载访问状态分成资源级 grant 和镜像级 event：

- `patch_resource_access_grant` 只包含 `actor_key`、`resource_id` 和 `expires`，复合主键保证同一 actor/resource 只有一条 grant。新授权从首次获取起固定有效 24 小时；同一授权期内点开其它镜像、重复查看或自动恢复都不延长 `expires`。
- `patch_resource_access` 保留 actor、资源、镜像、section、storage、cost、expires 和 created 等审计信息；`access_kind` 是唯一新增的事件分类字段。新资源授权写 `resource_grant`，有效授权内首次点开另一镜像写 `link_reveal`，重复查看不新增 event。
- Grant 写事务使用 PostgreSQL Serializable，最多尝试 3 次。Prisma `P2002` / `P2034` 和 adapter 直接暴露的 `DriverAdapterError` `TransactionWriteConflict` / SQLSTATE `40001` 都从完整事务起点重试；前两次冲突后分别在事务外等待 50 ms、100 ms。不要把等待放进事务 callback，也不要把其他 driver/连接错误误判成序列化冲突。
- 游客游戏资源的日/周产品额度只统计 `access_kind = 'resource_grant'`。登录用户和补丁资源不进入该产品额度；共享 IP 不承担产品额度。
- 刷新后的恢复同时只读 grant 和 event，只返回当前 actor 已点过且授权仍有效的镜像。不要为恢复写 event，也不要新增持久化的 `revealed` 字段或 ID 数组；资源列表里的 `revealed` 是从 event 查询派生的 preview 状态。
- Grant/event 读写不改变资源派生属性和公开列表统计，因此不触发 `deletePatchResourceCache`。包含 `obtained` / `revealed` 的 `/api/patch/resource` 和含真实凭据的 access/restore 响应必须 `private, no-store`。
- Redis 只做每 actor 每分钟 30 次的短时技术限频，不承载日/周产品额度。清除 visitor cookie 会创建新的游客身份；只有首次无有效 cookie 的游客按 IP hash 做技术限频，不能据此给共享 IP 分配或封禁产品额度。

## 上线观察与回滚

下面的只读查询只聚合资源级 event 和 grant 数量，不输出真实下载凭据、visitor token、IP、IP hash、actorKey、Redis key 或资源/镜像 ID：

```sql
WITH rollout AS (
  SELECT MIN(created) AS started_at
  FROM patch_resource_access
  WHERE access_kind = 'resource_grant'
)
SELECT
  DATE_TRUNC(
    'day',
    (pra.created AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Shanghai'
  ) AS shanghai_day,
  pra.actor_type,
  pra.section,
  pra.access_kind,
  COUNT(*) AS event_count
FROM patch_resource_access pra
CROSS JOIN rollout
WHERE rollout.started_at IS NOT NULL
  AND pra.access_kind IN ('resource_grant', 'link_reveal')
  AND pra.created >= rollout.started_at
  AND pra.created >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '14 days'
GROUP BY 1, 2, 3, 4
ORDER BY 1 DESC, 2, 3, 4;

SELECT
  COUNT(*) FILTER (WHERE expires > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS active_grants,
  COUNT(*) FILTER (WHERE expires <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS expired_grants
FROM patch_resource_access_grant;
```

`resource_grant` 与 `link_reveal` 由上面的 DB event 聚合；首条 `resource_grant` 的 `created` 作为新应用开始写事件的保守下界，避免迁移时统一标记为 `link_reveal` 的旧行污染 14 天指标。运维若记录了更准确的应用切换时间，应以该时间替换 rollout CTE。

`daily_limited`、`weekly_limited`、`manual_reused`、`rate_limited` 和 `manual_failed` 由 `observability.ts` 的 `resource-access-outcome` 结构化日志聚合。自动 restore 不写 event，也不混入 `manual_reused`：restore route 对每个完成的只读请求记录 `restore_succeeded`，对映射为 503 的异常记录 `restore_failed`；日志聚合按 `operation = restore` 计算成功率 = `restore_succeeded / (restore_succeeded + restore_failed)`，技术 429 另看 `rate_limited`。这样自动恢复成功率和错误率有明确采集路径，不依赖 access event 猜测。

安全日志只允许 `operation`、`outcome`、`actorType` 和可选 `section`，不得记录 `content`、`code`、`password`、`hash`、`visitorToken`、IP/IP hash、`actorKey`、Redis key、资源/镜像 ID 或完整资源名称。若部署平台已有 HTTP route status 指标，可用 restore route 的 200/429/503 交叉校验上述聚合，但 DB 中仍不得为了 restore 指标新增事件。

Rollout 时要用固定 cutoff/cutover 完成 preflight、sync 和 postflight，并在切换新应用前排空旧 access writer。上线时仍有效的旧授权最长可能继续 72 小时；这是迁移兼容行为，不是新的产品规则。所有新授权统一为 24 小时。回滚旧应用后如果旧 writer 再次写入旧事件，下次上线必须建立新的固定 snapshot，不能沿用上一次 cutoff/cutover。

## 测试

重点测试：

- `tests/unit/redis.test.ts`
- `tests/unit/patch-resource-attributes.test.ts`
- `tests/unit/resource-link.test.ts`
- `tests/unit/resource-classification.test.ts`
- `tests/unit/gallery-upload.test.ts`
- `tests/unit/gallery-upload-batch.test.ts`
- `tests/unit/gallery-drop.test.ts`
- `tests/unit/gallery-remote-import.test.ts`
- `tests/unit/gallery-remote-route.test.ts`

上传/S3 的真实集成测试当前没有统一 harness。修改上传流程时，必须补单元测试或记录手动验证步骤。
