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

### 9. 创建发布 P2028/504 修复 ✅

- 生产发布条目时出现 504、`P2028` 或请求长时间无响应，应优先检查 `app/api/edit/create.ts` 的分段日志：`[EditCreate] create failed at <step>`。PM2 部署下用 `pm2 logs <process>` 查看服务端日志；浏览器 console 只能看到最终 HTTP 失败。
- create 发布已改为 staged flow：先短事务创建 `status = PATCH_STATUS_PUBLISHING` 的隐藏 patch，再在事务外处理 sharp/S3 banner 和 VNDB 公司准备，最后短事务写 rating、alias、tag/company、用户奖励，并把 patch 改为 `PATCH_STATUS_VISIBLE`。
- banner 上传返回已上传 S3 keys；后续步骤失败会 best-effort 删除隐藏 patch 和本次已上传 banner object。
- IndexNow 是 bounded best-effort，响应后链路失败不阻断发布。
- 公开列表和详情查询统一过滤 `status = PATCH_STATUS_VISIBLE`，避免发布中或失败清理前的半成品 patch 被读到。

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

第一阶段只让匿名公开 GET 流量进入 Cloudflare 共享缓存，不缓存游戏详情页 HTML，不缓存登录态和个性化请求。

前置条件：

- 1Panel/OpenResty 不再追加 `Cache-Control: no-cache`。
- 生产环境已部署 `POST /api/patch/views` 和 `GET /api/patch/stats` 的 no-store 改造。
- 生产环境已配置 `KUN_CF_CACHE_ZONE_ID` 和 `KUN_CF_CACHE_PURGE_API_TOKEN`，公开写入路径可以触发 Cloudflare purge。
- 不开启 1Panel OpenResty 的服务器缓存、浏览器缓存、反代缓存来缓存应用 HTML；第一阶段只使用 Cloudflare，避免多层缓存失效链路不一致。

#### Cloudflare Cache Rules 推荐配置

Cloudflare Cache Rules 会叠加执行，多个规则冲突时后命中的规则覆盖前面的规则。因此缓存规则本身必须排除个性化 cookie，同时把 bypass 兜底规则放在缓存规则之后。不要创建全站 `Cache Everything`。

**规则 1：公开 HTML 页面缓存**

规则名：

```txt
英文 / English: Cache anonymous public HTML
中文 / Chinese: 缓存匿名公开 HTML 页面
```

表达式：

```txt
http.host eq "www.otoame.top"
and http.request.method eq "GET"
and (
  http.request.uri.path eq "/"
  or http.request.uri.path eq "/otomegame"
  or http.request.uri.path eq "/tag"
  or starts_with(http.request.uri.path, "/tag/")
  or http.request.uri.path eq "/company"
  or starts_with(http.request.uri.path, "/company/")
)
and not http.cookie contains "kun-galgame-patch-moe-token"
and not http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
and not http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
and not has_key(http.request.headers, "rsc")
and not has_key(http.request.headers, "next-router-prefetch")
and not has_key(http.request.headers, "next-router-state-tree")
and not has_key(http.request.headers, "next-router-segment-prefetch")
```

动作：

```txt
缓存资格 / Cache eligibility: 符合缓存条件 / Eligible for cache
缓存级别 / Cache level: 缓存所有内容 / Cache Everything
边缘 TTL / Edge TTL: 使用缓存控制标头（如果存在），否则绕过缓存 / Use cache-control header if present, bypass cache if not (bypass_by_default)
浏览器 TTL / Browser TTL: 接受源服务器 TTL / Respect origin
缓存欺骗盔甲 / Cache Deception Armor: 关闭 / Off
按设备类型缓存 / Cache by device type: 关闭 / Off
忽略查询字符串 / Ignore query string: 关闭 / Off
对查询字符串排序 / Sort query string: 非 Enterprise 保持关闭；Enterprise 可选开启 / Off on non-Enterprise; optional on Enterprise
缓存密钥 / Cache key: 保持默认 / Keep default
```

边缘 TTL 选择 `bypass_by_default` 后，Cloudflare 只会在源站返回缓存控制头时缓存；本项目公开 HTML 会输出 `s-maxage`，因此可以进入边缘缓存：

- `/`: 120s
- `/otomegame`: 180s
- `/tag`: 300s
- `/tag/*`: 300s
- `/company`: 300s
- `/company/*`: 600s

这条规则故意排除 RSC 和 prefetch 请求，第一阶段只缓存浏览器文档 HTML，避免 Next.js App Router 的 `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` 变体被混用。后续如果要缓存 RSC payload，需要单独把相关 header 纳入 cache key 或使用 Transform Rule 把 RSC 请求改写为独立 query key。

**规则 2：匿名列表 API 短缓存**

规则名：

```txt
英文 / English: Cache anonymous list APIs
中文 / Chinese: 缓存匿名列表 API
```

表达式：

```txt
http.host eq "www.otoame.top"
and http.request.method eq "GET"
and (
  http.request.uri.path eq "/api/tag/otomegame"
  or http.request.uri.path eq "/api/company/otomegame"
)
and not http.cookie contains "kun-galgame-patch-moe-token"
and not http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
and not http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
```

动作：

```txt
缓存资格 / Cache eligibility: 符合缓存条件 / Eligible for cache
缓存级别 / Cache level: 缓存所有内容 / Cache Everything
边缘 TTL / Edge TTL: 使用缓存控制标头（如果存在），否则绕过缓存 / Use cache-control header if present, bypass cache if not (bypass_by_default)
浏览器 TTL / Browser TTL: 接受源服务器 TTL / Respect origin
缓存欺骗盔甲 / Cache Deception Armor: 关闭 / Off
按设备类型缓存 / Cache by device type: 关闭 / Off
忽略查询字符串 / Ignore query string: 关闭 / Off
对查询字符串排序 / Sort query string: 非 Enterprise 保持关闭；Enterprise 可选开启 / Off on non-Enterprise; optional on Enterprise
缓存密钥 / Cache key: 非 Enterprise 保持默认 / Keep default on non-Enterprise
```

这两个 API 的匿名响应由源站输出 `Cache-Control: public, s-maxage=30, stale-while-revalidate=300`，因此 Cloudflare 边缘 TTL 为 30s。非 Enterprise 套餐不能细调 Cache key 时，保持默认即可；重点是不要开启“忽略查询字符串”。默认缓存键会按 URL 区分 query string，不同 `tagId`、`companyId`、分页、排序和筛选条件不会互相污染；缺点是同一组参数但顺序不同会生成不同缓存项，影响命中率，不影响正确性。

**规则 3：个性化请求和非白名单 API bypass 兜底**

规则名：

```txt
英文 / English: Bypass personalized and non-public API
中文 / Chinese: 绕过个性化请求和非公开 API 缓存
```

表达式：

```txt
http.host eq "www.otoame.top"
and (
  http.request.method ne "GET"
  or http.cookie contains "kun-galgame-patch-moe-token"
  or http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
  or http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
  or (
    starts_with(http.request.uri.path, "/api/")
    and http.request.uri.path ne "/api/tag/otomegame"
    and http.request.uri.path ne "/api/company/otomegame"
  )
)
```

动作：

```txt
缓存资格 / Cache eligibility: 绕过缓存 / Bypass cache
```

作用：登录态、NSFW 设置、屏蔽标签、写入 API、实时统计 API 和其它业务 API 都不进入共享缓存。由于 Cloudflare Cache Rules 冲突设置以后命中的规则为准，这条规则必须排在两条缓存规则之后。`/api/patch/stats` 和 `/api/patch/views` 仍由源站的 `Cache-Control: private, no-store` 兜底。

#### 实时性边界

- 首页 HTML 可以缓存，但首页游戏卡片挂载后会调用 `GET /api/patch/stats` 拉取实时 `view/download`，该接口固定 `private, no-store`，所以浏览量和下载量不会被 HTML 缓存长期冻结。
- 游戏详情页 HTML 第一阶段不缓存。虽然浏览量写入已移到 `POST /api/patch/views`，但详情页仍包含收藏状态和 NSFW 相关个性化边界，必须等匿名详情页和登录态详情页拆分后再评估。
- `/otomegame`、`/tag*`、`/company*` 的公开列表新增或改写后，会通过 Redis/ISR/Cloudflare purge 主动失效；如果 purge 环境变量缺失或 Cloudflare purge 失败，HTML 最坏按源站 `s-maxage` 陈旧，匿名列表 API 最坏 30s 陈旧。
- 登录态、NSFW 设置、屏蔽标签设置请求始终 bypass。个性化用户看到的列表仍应从源站/API 返回，不共享匿名缓存。

#### 验证命令

配置后连续请求两次，第二次应看到 `cf-cache-status: HIT` 和递增的 `age`。注意不要用 `curl -I` / `curl --head` 验证这些规则；`curl -I` 发送的是 `HEAD` 请求，而缓存规则只允许 `GET`。

```bash
curl -s -D - -o /dev/null https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control\|vary'
curl -s -D - -o /dev/null https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control\|vary'

curl -s -D - -o /dev/null https://www.otoame.top/otomegame | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null https://www.otoame.top/tag | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null https://www.otoame.top/company | grep -i 'cf-cache-status\|age\|cache-control'
```

匿名列表 API 连续请求两次，第二次应命中 Cloudflare；同时确认 `x-kun-cache` 仍能说明源站热缓存命中情况：

```bash
curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
```

非 Enterprise 套餐不能启用 query string 排序时，再验证一次不同 query 不会共用缓存：

```bash
curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=16&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
```

第一次请求 `tagId=16` 不应直接复用 `tagId=15` 的 `age`。

验证个性化和实时接口不会被缓存：

```bash
curl -s -D - -o /dev/null -H 'Cookie: kun-galgame-patch-moe-token=test' https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null 'https://www.otoame.top/api/patch/stats?uniqueIds=ABCDEFGH' | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null \
  -X POST https://www.otoame.top/api/patch/views \
  -H 'content-type: application/json' \
  -H 'x-requested-with: kun-fetch' \
  -H 'origin: https://www.otoame.top' \
  --data '{"uniqueId":"ABCDEFGH","currentView":0}' \
  | grep -i 'cf-cache-status\|age\|cache-control'
```

预期：

- 公开 HTML 和匿名列表 API：第二次请求为 `cf-cache-status: HIT`。
- 带个性化 cookie：`cf-cache-status: BYPASS`、`DYNAMIC` 或非 HIT。
- `/api/patch/stats` 和 `/api/patch/views`：`Cache-Control: private, no-store`，不能出现 HIT。
- 如果 `POST /api/patch/views` 没有带 `x-requested-with: kun-fetch` 和合法 `Origin` / `Referer`，请求会被 middleware CSRF 校验拦截；此时也必须是非 HIT。

#### 配置依据

- Cloudflare 共享缓存只应该接收匿名 GET；官方默认行为不会缓存 `private`、`no-store`、`no-cache`、`max-age=0`、带 `Set-Cookie` 或非 GET 响应，Cache Rule 的 Edge TTL 覆盖能力必须谨慎使用。
- 本项目匿名列表 API 已在 `app/api/utils/cacheHeaders.ts` 中区分匿名和个性化 cookie：匿名为 `public, s-maxage=30, stale-while-revalidate=300`，个性化为 `private, no-store`。
- `app/api/patch/stats/route.ts` 和 `app/api/patch/views/route.ts` 固定输出 `private, no-store`，分别保障首页实时统计读取和详情页浏览量写入不进入共享缓存。
- `app/api/patch/cache.ts` 已把公开页面和匿名公开 API 接入 Cloudflare purge；API 使用 prefix purge 覆盖同一路径下的所有 query 变体。

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

| 路径                         | QPS 范围          | 失败请求 | P95 范围 | 结论                 |
| ---------------------------- | ----------------- | -------: | -------: | -------------------- |
| `/api/tag/otomegame?...`     | 1744.35 - 3614.63 |        0 |  49-97ms | 本机 Node 直连不稳定 |
| `/api/company/otomegame?...` | 2316.85 - 3440.99 |        0 |  50-84ms | 本机 Node 直连不稳定 |

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

### 生产环境 Cloudflare 压测流程

生产环境压测要分清两个指标：

- **边缘 HIT QPS**：用户请求打到 Cloudflare，`cf-cache-status: HIT`，主要测 CF 边缘和公网链路，源站压力应很低。
- **源站回源 QPS**：请求没有命中 CF，或带登录态/个性化 cookie，主要测 VPS + OpenResty + Next.js + Redis/DB。

当前第一阶段目标是验证匿名公开页面和匿名列表 API 的边缘 HIT QPS。不要用带 cookie 的请求压测公开缓存，也不要用游戏详情页 HTML 作为第一阶段边缘缓存压测对象。

#### 1. 压测前预热缓存

先确认目标路径已经从 `MISS` 变成 `HIT`：

```bash
curl -s -D - -o /dev/null https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'

curl -s -D - -o /dev/null https://www.otoame.top/otomegame | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null https://www.otoame.top/tag | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null https://www.otoame.top/company | grep -i 'cf-cache-status\|age\|cache-control'

curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
```

压测前目标路径必须看到第二次请求为：

```txt
cf-cache-status: HIT
age: <递增秒数>
```

#### 2. 单路径边缘 HIT 压测

推荐从一台离用户较近、带宽充足的机器发起，不建议直接在 VPS 本机压测公网域名，因为这样测到的是 VPS 到 Cloudflare 再回来的链路，不代表真实用户访问。

`wrk`：

```bash
wrk -t8 -c200 -d30s --latency https://www.otoame.top/
wrk -t8 -c200 -d30s --latency https://www.otoame.top/otomegame
wrk -t8 -c200 -d30s --latency https://www.otoame.top/tag
wrk -t8 -c200 -d30s --latency https://www.otoame.top/company
wrk -t8 -c200 -d30s --latency 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc'
```

`oha`：

```bash
oha -z 30s -c 200 https://www.otoame.top/
oha -z 30s -c 200 https://www.otoame.top/otomegame
oha -z 30s -c 200 https://www.otoame.top/tag
oha -z 30s -c 200 https://www.otoame.top/company
oha -z 30s -c 200 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc'
```

`ab` 兜底：

```bash
ab -l -n 2000 -c 50 https://www.otoame.top/
ab -l -n 5000 -c 100 https://www.otoame.top/otomegame
ab -l -n 5000 -c 100 https://www.otoame.top/tag
ab -l -n 5000 -c 100 https://www.otoame.top/company
ab -l -n 5000 -c 100 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc'
```

`ab -l` 用于允许动态响应长度差异，避免 Next.js/Cloudflare 压缩或 header 差异造成误报。`ab` 在 macOS 上压测 HTTPS + Cloudflare 时容易受 TLS 握手、连接复用能力和本地公网带宽限制，可能出现 `SSL handshake failed`、长尾很高、QPS 只有几十的情况；这通常说明客户端压测工具或本地链路先成为瓶颈，不能直接代表 Cloudflare 或源站上限。若要测边缘吞吐，优先使用 `oha`、`wrk` 或多地域压测工具。

#### 3. 并发阶梯压测

不要一开始就打高并发。建议按 50 -> 100 -> 200 -> 400 逐级提高，每档 30s：

```bash
for c in 50 100 200 400; do
  echo "=== concurrency ${c} ==="
  wrk -t8 -c "$c" -d30s --latency https://www.otoame.top/
done
```

如果本机没有 `wrk`，用 `oha`：

```bash
for c in 50 100 200 400; do
  echo "=== concurrency ${c} ==="
  oha -z 30s -c "$c" https://www.otoame.top/
done
```

如果只能使用 `ab`，不要一开始就 `-c 200` 压首页大 HTML，先跑低并发并观察是否有 SSL 错误：

```bash
for c in 20 50 100; do
  echo "=== concurrency ${c} ==="
  ab -l -n 2000 -c "$c" https://www.otoame.top/
done
```

如果 `ab` 已出现 `SSL handshake failed` 或 P95/P99 秒级长尾，应停止提高并发，改用 `oha` / `wrk`，或换到带宽更高的压测机。

#### 4. 压测期间监控 VPS

在 VPS 上同时观察源站是否被打穿：

```bash
top
pm2 monit
docker stats
```

如果使用 PostgreSQL 和 Redis，也观察连接和延迟：

```bash
redis-cli info stats | grep -E 'instantaneous_ops_per_sec|total_commands_processed'
redis-cli info clients | grep connected_clients
```

边缘 HIT 压测的预期是：Cloudflare QPS 很高，但 VPS CPU、Next.js 进程、Redis、DB 压力增长不明显。如果 VPS 压力明显升高，说明缓存命中率不足或压测请求没有命中 HIT。

#### 5. 压测后复核缓存状态

压测结束后再次确认目标路径仍是 HIT：

```bash
curl -s -D - -o /dev/null https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'
curl -s -D - -o /dev/null 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|age\|cache-control\|x-kun-cache'
```

同时在 Cloudflare Analytics / Cache 中看：

- Cache hit ratio
- Requests by cache status
- Origin bandwidth / Edge bandwidth
- 5xx 错误率

#### 6. 结果判读

边缘缓存压测通过条件：

- `cf-cache-status: HIT` 占主要比例
- 压测工具错误率接近 0
- P95 延迟稳定，没有明显长尾
- VPS CPU、内存、Redis、DB 没有明显升高

不要把边缘 HIT QPS 等同于源站真实承载 QPS。边缘 HIT QPS 证明 Cloudflare 可以吸收匿名公开流量；源站 QPS 仍以本地生产构建压测和未命中场景压测为准。

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
