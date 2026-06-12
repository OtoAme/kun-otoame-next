# 性能优化策略和压测结果

## 当前架构分析

### 缓存层次

1. **Next.js ISR 缓存**：静态页面和部分详情页预渲染，revalidate 后按需更新
2. **Redis 缓存**：数据查询结果缓存，支持 stale-while-revalidate
3. **React cache()**：同一渲染周期内的请求去重（primitive 参数）
4. **PM2 Cluster**：生产配置为 3 个 Next standalone 实例
5. **数据库连接池**：`pg.Pool({ max: 30 })`
6. **匿名 API 边缘缓存**：tag/company 游戏列表 API 对匿名请求输出 `Cache-Control`
7. **匿名 API 响应热缓存**：Redis 30s + 单进程内存 30s，覆盖高频重复筛选请求

### 页面 revalidate 时间

- 主页: 120s (force-static)
- /otomegame: 180s (force-static)
- /tag: 300s (force-static)
- /company: 300s (force-static)
- /tag/[id]: 300s (force-static, 默认 Top 50 预生成，可用 `KUN_STATIC_TAG_PREGEN_LIMIT` 调整)
- /company/[id]: 600s (force-static, 默认 Top 50 预生成，可用 `KUN_STATIC_COMPANY_PREGEN_LIMIT` 调整)

## 已实施优化措施

### 1. React cache() 去重优化 ✅

- 使用 primitive 参数（`tagId: number`, `companyId: number`）
- 分离到 `data.ts` 文件，避免 `'use server'` 限制
- `generateMetadata` 和 `page` 共享同一缓存

### 2. 静态生成优化 ✅

- 所有列表页启用 `force-static`
- 首页首屏数据控制为 12 个游戏卡片 + 4 个资源卡片，避免静态 HTML/RSC payload 过大拖低吞吐
- Tag/Company 详情页添加 `generateStaticParams`，默认预生成 Top 50
- Company 详情页服务端预取默认游戏列表，并在客户端默认筛选状态下复用首屏数据
- Tag 详情页只预生成标签资料，不在构建期预取游戏列表，避免登录态/屏蔽标签/NSFW 个性化数据污染静态产物
- Next 静态生成并发限制为 `staticGenerationMaxConcurrency: 2`，避免构建期打爆数据库连接

### 3. Redis 缓存 TTL 优化 ✅

- TAG_LIST_CACHE: 300s -> 600s
- TAG_DETAIL_CACHE: 新增 600s
- COMPANY_LIST_CACHE: 300s -> 600s
- 静态数据延长缓存时间，降低数据库压力

### 4. ISR 失效机制 ✅

在写入操作后同时失效 Redis、Next.js 和 Cloudflare 缓存：

- `invalidateTagCaches(tagId?)`: 调用 `revalidatePath('/tag')`，已知 `tagId` 时额外刷新 `/tag/[id]`
- `invalidateCompanyCaches()`: 调用 `revalidatePath('/company')` 和 `/company/[id]`
- `invalidatePatchListCaches()`: 调用 `revalidatePath('/')` 和 `/otomegame`
- `invalidatePatchContentCache()`: 调用 `revalidatePath('/[id]')`
- ISR 失效通过 `safeRevalidatePath` 封装，维护脚本环境缺少 Next static generation store 时不会中断 Redis 失效流程
- Cloudflare purge 通过 `purgePublicPageCache()` 和 `purgePublicApiCache()` 接入同一失效链路；缺少 `KUN_CF_CACHE_ZONE_ID` 或 `KUN_CF_CACHE_PURGE_API_TOKEN` 时安全 no-op

### 5. 匿名 API 缓存头 ✅

- `/api/tag/otomegame` 和 `/api/company/otomegame` 成功响应输出 `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`
- 带登录 token、NSFW 设置、屏蔽标签设置等个性化 cookie 的请求输出 `Cache-Control: private, no-store`
- 这让 CDN/反向代理可以承载匿名筛选请求，同时避免缓存个性化结果

### 6. 匿名 API 响应热缓存 ✅

- `/api/tag/otomegame` 和 `/api/company/otomegame` 对匿名请求缓存完整 JSON 响应
- Redis 缓存 TTL 为 30s，PM2 worker 内存热缓存 TTL 为 30s，最多 512 条
- 查询参数会规范化排序，等价筛选条件可以共享 Redis、进程内存和 pending single-flight 缓存
- 个性化 cookie 请求完全绕过响应缓存
- 响应头 `X-Kun-Cache` 标记命中来源：`memory`、`redis`、`miss`、`pending` 或 `private`
- patch/tag/company 写入失效时同步清理 `anonymous_api:*`
- 两个只读热点 API 从 middleware matcher 中排除，避免每次 GET 进入 CSRF middleware 固定开销

### 7. 构建验证 ✅

- `pnpm build` 已通过
- 当前构建静态页面数：222
- 之前的 Prisma `P2037 Too many database connections opened` 未复现

### 8. 边缘缓存安全前置改造 ✅

- OpenResty 反代层额外追加的 `Cache-Control: no-cache` 已定位为 1Panel/OpenResty 配置问题，并已从公开站点配置中移除
- 详情页浏览量写入已从 SSR 移到 `POST /api/patch/views`，响应固定 `Cache-Control: private, no-store`
- 详情页客户端通过 `PatchViewBeacon` 使用带 CSRF header 的 `fetch(..., { keepalive: true })` 发送浏览量写入请求
- 首页保持 `force-static`，但游戏卡片挂载后通过 `GET /api/patch/stats` 拉取 no-store 实时统计，只更新 view/download 数字，避免静态 HTML/RSC 快照压制实时展示
- create/rewrite/download/favorite/resource/tag/company/comment/rating、详情页 tag/company 关系调整，以及相关后台更新/删除等会影响公开列表或详情的写入会进入 Redis/ISR/Cloudflare purge 链路
- 匿名公开 API purge 使用 Cloudflare prefix purge，prefix 不带 query string，覆盖同一路径下所有 query 变体
- 第一阶段仍不建议缓存 `/{uniqueId}` 详情页 HTML；原因是详情页仍包含登录 cookie 推导出的收藏状态，并受 NSFW 设置影响，需要先通过 Cloudflare bypass 规则和匿名 HTML 验证

## 待实施优化措施

### 1. 数据库连接池配置

当前使用 `pg.Pool({ max: 30 })`，在 PM2 多进程模式下需要注意：

- 总连接数 = 进程数 × 30
- 建议使用 PgBouncer 或将 pool max 改为环境变量
- 高 QPS 应靠 CDN/Redis 命中，数据库连接池仅兜底

### 2. Redis 连接优化

- ioredis 默认不是连接池模型，单连接
- 高 QPS 下可考虑 Redis Cluster 或读写分离；当前匿名热点 API 已通过进程内短 TTL 热缓存减少 Redis 单连接压力
- 监控 Redis 连接数和命令延迟

### 3. CDN 和边缘缓存配置

使用 Cloudflare 缓存匿名页面时，第一阶段只缓存公开列表页和短 TTL 匿名 API：

- 缓存路径: `/`, `/otomegame`, `/tag`, `/tag/*`, `/company`, `/company/*`
- 匿名 API 缓存路径: `/api/tag/otomegame`, `/api/company/otomegame`
- 缓存规则: 只允许匿名 GET 进入共享缓存，API Cache key 必须包含全部 query string
- 排除: 其它 API 路由、带鉴权 cookie、带 NSFW/屏蔽标签设置 cookie、用户相关页面
- 暂不缓存: `/{uniqueId}` 游戏详情页 HTML，直到收藏状态和 NSFW 个性化边界完成验证

### 4. 应用服务器扩展

当前生产配置已经使用 PM2 3 实例。压测时必须按部署形态启动 standalone，不要只测单个 `node .next/standalone/server.js` 进程。

### 5. 监控和限流

#### 监控指标

- Redis 命中率
- 数据库连接池使用率
- 响应时间 P50/P95/P99
- 错误率
- ISR 缓存命中率

#### 限流策略

- IP 限流：单 IP 100 req/s
- API 限流：基于用户角色
- DDoS 防护

## 本地压测结果

### 环境

- 日期：2026-06-12
- 构建：`pnpm build`
- 服务：`.next/standalone/server.js`
- 进程：PM2 cluster 3 instances
- 压测工具：`ab`
- 命令格式：`ab -l -n 5000 -c 100 <url>`

### 静态/SSG 页面结果

#### 当前最新构建复核

| 路径         |     QPS | 失败请求 |  P95 | 结论           |
| ------------ | ------: | -------: | ---: | -------------- |
| `/`          | 3157.23 |        0 | 42ms | 达到 3000+ QPS |
| `/otomegame` | 3582.18 |        0 | 40ms | 达到 3000+ QPS |
| `/tag`       | 3613.70 |        0 | 41ms | 达到 3000+ QPS |
| `/company`   | 3067.42 |        0 | 47ms | 达到 3000+ QPS |
| `/tag/15`    | 3094.23 |        0 | 48ms | 达到 3000+ QPS |
| `/company/4` | 5662.96 |        0 | 22ms | 达到 3000+ QPS |

当前首页 HTML 响应体为 195,280 bytes；早期 20 个游戏卡片 + 6 个资源卡片时为 209,818 bytes，压测只有 1935.32 QPS。首页现在将首屏数据收敛到 12 个游戏卡片 + 4 个资源卡片，并通过 `home_data:v2:g12:r4:*` 缓存 key 避免构建期复用旧 Redis payload。

#### 历史复测数据

| 路径         |     QPS | 失败请求 |  P95 | 结论           |
| ------------ | ------: | -------: | ---: | -------------- |
| `/otomegame` | 3457.89 |        0 | 50ms | 达到 3000+ QPS |
| `/tag`       | 3757.41 |        0 | 46ms | 达到 3000+ QPS |
| `/company`   | 3383.27 |        0 | 45ms | 达到 3000+ QPS |
| `/tag/15`    | 3390.73 |        0 | 62ms | 达到 3000+ QPS |
| `/company/4` | 3114.96 |        0 | 55ms | 达到 3000+ QPS |

这些结果证明：在当前本机生产构建 + PM2 3 实例下，匿名静态页面和预生成详情页可以承载 3000+ QPS。

2026-06-12 复测 `/otomegame`：3699.51 QPS，0 失败，P95 46ms。

当前构建复核 `/otomegame`：3358.01 QPS，0 失败，P95 50ms。

### API 热缓存结果

#### Redis 热缓存基线

| 路径                         |     QPS | 失败请求 |   P95 | 结论             |
| ---------------------------- | ------: | -------: | ----: | ---------------- |
| `/api/tag/otomegame?...`     | 1575.81 |        0 | 133ms | 未达到 3000+ QPS |
| `/api/company/otomegame?...` | 1558.53 |        0 |  62ms | 未达到 3000+ QPS |

2026-06-12 复测 `/api/tag/otomegame?...` Node 直连：1636.12 QPS，0 失败，P95 92ms。

API 层即使 Redis 热缓存命中，也仍有 Next route handler、JSON 序列化、Redis 读取和实时统计叠加开销。单纯 Redis 数据缓存不足以支撑匿名热点 API 3000+ QPS。

#### 匿名响应热缓存结果

| 路径                         | QPS 范围             | 失败请求 | P95 范围 | 结论                 |
| ---------------------------- | -------------------- | -------: | -------: | -------------------- |
| `/api/tag/otomegame?...`     | 1744.35 - 3614.63    |        0 | 49-97ms  | 本机 Node 直连不稳定 |
| `/api/company/otomegame?...` | 2316.85 - 3440.99    |        0 | 50-84ms  | 本机 Node 直连不稳定 |

匿名响应热缓存明显降低数据库、Redis 和实时统计读取压力。适用范围是匿名高频重复筛选请求；登录态、NSFW 设置、屏蔽标签等个性化请求不共享缓存，不能套用此 QPS。

当前最新构建在确认 `X-Kun-Cache: redis` 后顺序复核：

| 路径                         |     QPS | 失败请求 |  P95 | 结论                         |
| ---------------------------- | ------: | -------: | ---: | ---------------------------- |
| `/api/tag/otomegame?...`     | 8815.53 |        0 | 18ms | 单路热缓存复核达到 3000+ QPS |
| `/api/company/otomegame?...` | 5878.95 |        0 | 27ms | 单路热缓存复核达到 3000+ QPS |

并行同时压测 tag/company 时，两路合计约 3974 QPS，但单路会分摊到约 2000 QPS，不能把并行场景的单路结果与单路 3000+ 目标直接比较。

匿名 tag/company 游戏列表 API 仍保留 CDN/反向代理缓存条件：

- 匿名请求响应头：`Cache-Control: public, s-maxage=30, stale-while-revalidate=300`
- 带登录 token、NSFW 设置、屏蔽标签设置等 cookie：`Cache-Control: private, no-store`
- CDN/反向代理缓存仍建议启用；它不是本轮本机 3000+ QPS 的前置条件，但能把匿名 API 的峰值压力进一步前移到边缘层

## 压测要求

### 压测场景

1. **静态 HTML 请求**：CDN 缓存命中
2. **RSC payload 请求**：Next.js ISR 缓存
3. **匿名 API 请求**：响应热缓存 + Redis 缓存
4. **登录态 API 请求**：包含 blocked tags/NSFW

### 压测工具

```bash
# wrk 压测
wrk -t12 -c400 -d30s https://yoursite.com/

# k6 压测脚本
k6 run --vus 1000 --duration 30s load-test.js
```

### 目标指标

- 静态/SSG 页面峰值: 3000 QPS
- 静态/SSG 页面 P95 延迟: < 200ms
- 静态/SSG 页面 P99 延迟: < 500ms
- 静态/SSG 页面错误率: < 0.1%
- 匿名热点 API 热缓存 QPS: 3000+
- 个性化 API 热缓存 QPS: 不共享响应缓存，需单独制定目标
- 匿名 API 边缘缓存 QPS: 建议在 CDN/反向代理缓存层继续验证
- CPU 使用率: < 80%
- 内存使用率: < 80%
- Redis 命中率: > 95%
- 数据库 QPS: 静态页面压测时应接近 0，API 热缓存应主要由 Redis 承载

## 数据库索引

参考 `docs/project/database-indexes.md`，关键索引：

- `patch`: created, view, download, resource_update_time, content_limit
- `patch_tag`: count (DESC)
- `patch_company`: count (DESC)
- `patch_tag_relation`: (tag_id, patch_id)
- `patch_company_relation`: (company_id, patch_id)
- `patch_rating_stat`: (count, avg_overall)

## 实施优先级

1. **高优先级**（已完成 ✅）
   - React cache() 去重
   - force-static 静态生成
   - generateStaticParams 预生成
   - 构建期静态生成限流
   - Company 详情默认首屏复用
   - ISR 失效机制
   - 匿名 tag/company 游戏列表响应热缓存
   - 只读热点 API 排除 middleware 固定开销

2. **中优先级**（1周内）
   - CDN/边缘缓存配置
   - 数据库连接池调优
   - 监控和告警
   - 限流策略

3. **低优先级**（压测后优化）
   - 水平扩展部署
   - Redis 集群
   - 图片 CDN 和压缩

## 注意事项

1. **ISR 陈旧性**：tag/company 更新后有 5-10 分钟 TTL 兜底延迟，已通过 `revalidatePath` 主动刷新缓解
2. **匿名 API 陈旧性**：匿名热点 API 存在 30s 进程内热缓存和 30s Redis 响应缓存，写入失效会主动清理；PM2 多进程内存缓存无法跨进程主动清理，最坏短暂陈旧不超过 30s
3. **个性化内容**：blocked tags、NSFW 设置等个性化内容仍需客户端请求，且不共享匿名响应缓存
4. **构建时间**：预生成数量可通过 `KUN_STATIC_TAG_PREGEN_LIMIT` / `KUN_STATIC_COMPANY_PREGEN_LIMIT` 调整，设置为 `0` 可关闭构建期详情页预生成
5. **缓存一致性**：Redis、匿名响应缓存和 Next.js 缓存同时失效，避免数据不一致
6. **Cloudflare 缓存一致性**：Cloudflare Cache Rule 启用前必须保证公开写入路径会触发 purge；Cloudflare purge 失败只记录日志，不阻断业务写入
