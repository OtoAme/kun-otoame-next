# Data, Cache, Upload

本模块覆盖 Prisma、Redis 缓存、上传元数据、S3 和资源一致性。

## Prisma

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

`prisma/index.ts` 使用 `pg.Pool` 与 `PrismaPg` adapter：

- pool max：30。
- idle timeout：30000ms。
- connection timeout：5000ms。
- prepared statement name cache：1000。

Schema 修改后至少运行 `pnpm prisma:generate`。会影响数据库结构时运行 `pnpm prisma:push`；生产库如果出现 reset database 提示必须取消，改走 preflight/sync SQL 或 dry-run 脚本。

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

- 文件大小：0.001 MB 到 100 MB。
- 每日上传：5GB。
- `role < 2` 不可上传。
- `role < 3` 且 `moemoepoint < 20` 不可上传。
- 创作者 `role === 2` 需要 CAPTCHA。
- 创作者或管理员才能上传对象存储资源。
- 普通创作者如果有待审核资源，不能继续发布新资源。
- 上传 handler 会先用 `updateMany` 增加 `daily_upload_size`，避免并发绕过配额。若后续流程失败，目前不会自动回退每日配额；改这里前要先设计补偿策略。

Gallery 图片上传走 `app/api/edit/gallery/route.ts` 和 `app/api/edit/galleryUpload.ts`，不使用资源上传的 Redis metadata/consume lock。规则：

- `patch_game_image.url` 保存原图 URL，旧路径保持 `patch/<patchId>/gallery/<imageId>.<ext>`；`patch_game_image.thumbnail_url` 是 nullable，只在真实生成缩略图时保存，路径为 `patch/<patchId>/gallery/thumbnail/thumb-<imageId>.<thumbExt>`，文件名显式带 `thumb-` 前缀，便于在浏览器 Network 中区分缩略图和原图。
- 静态 JPG/PNG/WebP/AVIF 会 resize 到 1920x1080 内，按水印开关 composite OtoAme 水印，再输出为 AVIF，单张输出上限 1.5MB；同时生成小尺寸 AVIF 缩略图。
- 动态 WebP 和动态 AVIF 优先保留动画，原样上传到 S3，不 resize、不重新编码、不添加水印，URL 后缀分别保持 `.webp` / `.avif`；动态 WebP 会尝试生成 animated WebP 缩略图。缩略图处理参考 PicList / picgo-plugin-compress 的保守策略使用 WebP quality 75、高 effort；但 gallery 的目标是降低预览解码尺寸，不能仅因缩略图字节数不小于原图就取消缩略图。Sharp 处理 animated WebP 时，`resize` 参数必须按单帧目标尺寸传入；帧数只用于限制单帧高度，避免内部纵向堆叠总高度超过 WebP 单边维度上限。缩略图生成或上传失败时不阻断原图，`thumbnail_url` 写 `null`。
- 动态原图上限 8MB；超过限制返回用户可见错误，不创建可见 gallery URL。
- 动态 AVIF 通过 ISO BMFF `avis` brand 在调用 Sharp 前短路处理，因为 Sharp AVIF 输出不支持 image sequence，不能把动态 AVIF 送入静态 AVIF 转码路径；V2 使用独立 `ffmpeg` adapter 尝试生成真实 animated AVIF 缩略图，动态缩略图失败时再尝试真实首帧 AVIF 缩略图。adapter 优先使用 `ffmpeg-static` bundled binary，失败后回退到系统 `ffmpeg`。没有可用 encoder、编码超时、生成体积超过 512KB 或上传失败时不阻断原图，`thumbnail_url` 写 `null`，不生成占位图。
- gallery 写入成功后要更新 `patch_game_image.url` 和 nullable `thumbnail_url` 并调用 `invalidatePatchContentCache(uniqueId)`；S3 上传或 DB 更新失败后删除已创建的 `patch_game_image` 记录，并补偿删除已真实上传的原图和缩略图 object。
- gallery 图片删除必须在删除 DB 记录的同时清理 S3 对象：
  - rewrite 提交时通过 `galleryMetadata.keep` 对比当前图片列表，被移除的图片在 `patch_game_image.deleteMany` 前收集 URL，DB 删除后用 `extractS3Key` + `deleteFileFromS3` 清理原图和缩略图（若 `thumbnail_url` 非 null），S3 清理失败只记日志不阻断 rewrite。
  - 整条目删除时先查询 `patch_game_image` 列表，在 Prisma cascade 删除 DB 记录后遍历清理 S3 files。
  - 通过 `DELETE /api/edit/gallery?imageId=xxx` 单张删除 gallery 图片时，删除 DB 记录后清理 S3 文件再失效缓存。
  - 所有路径的 S3 清理都为 best-effort：失败记 error 日志但不抛异常。`extractS3Key` 复用 `app/api/patch/resource/_helper.ts` 的实现。
- animated AVIF 缩略图 adapter 使用临时目录处理用户输入，`ffmpeg` 子进程有超时限制，并且输出体积必须在缩略图上限内；`ffmpeg-static` 的 install script 必须允许运行，否则 bundled binary 可能不存在。`ffmpeg-static` 下载的是安装机器当前平台的 binary，`deploy:pull` 需要把目标服务器 `node_modules/ffmpeg-static` 注入 standalone，避免 release artifact 构建机和生产机架构不一致。部署环境的 bundled 和系统 `ffmpeg/libaom-av1` 都不可用时会自动回退为无缩略图。引入其他 libavif / Node binding 方案前仍要先评估部署成本、CPU 成本、失败补偿和安全边界。
- 本地或部署前可用 `pnpm exec esno scripts/verifyGalleryAnimatedAvifThumbnail.ts <animated.avif> [output.avif]` 验证 animated AVIF 缩略图 encoder；该脚本只读写本地文件，不连接 S3 或数据库。生产上线前应在目标服务器执行，成功输出 `Wrote ... bytes`。

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

`extractS3Key` 只接受以 `NEXT_PUBLIC_KUN_VISUAL_NOVEL_S3_STORAGE_URL` 开头的 URL。删除逻辑遇到非本站 URL 会拒绝删除并记录错误，这是防止误删外部链接的保护。

## 资源派生属性

`app/api/patch/resource/_helper.ts` 的 `updatePatchAttributes` 会根据审核通过的资源重新汇总 patch 的：

- `type`
- `language`
- `platform`
- `resource_update_time`

新增资源类型、语言或平台时要同步检查：

- `constants/resource.ts`
- `validations/resource.ts`
- 资源发布/编辑组件
- `tests/unit/resource-classification.test.ts`

资源增删改审核通过后要调用 `deletePatchResourceCache(uniqueId)` 或等价的内容缓存 + 列表缓存失效，避免详情页、资源列表、排行和标签/公司游戏列表读到旧属性。

## 测试

重点测试：

- `tests/unit/redis.test.ts`
- `tests/unit/resource-link.test.ts`
- `tests/unit/resource-classification.test.ts`
- `tests/unit/gallery-upload.test.ts`

上传/S3 的真实集成测试当前没有统一 harness。修改上传流程时，必须补单元测试或记录手动验证步骤。
