# 边缘缓存 QPS 优化实施计划

> **给自动化执行 Agent 的要求：** 必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行本计划。步骤使用复选框（`- [ ]`）跟踪进度。

**目标：** 在不破坏实时统计、个性化视图和 create/rewrite 后内容刷新正确性的前提下，通过 Cloudflare 边缘缓存提升公开页面 QPS。

**架构：** 先移除 OpenResty 意外追加的 `Cache-Control: no-cache`，让 Cloudflare 能按正常缓存规则判断响应；然后先完成本地代码改造，确保浏览量、下载量、收藏等实时/个性化数据不会因为边缘缓存失真，并把 Cloudflare purge 接入现有 Redis/ISR 缓存失效层；最后再配置 Cloudflare Cache Rules 并做生产压测。Cloudflare 规则只允许匿名公开 GET 流量进入共享缓存，详情页 HTML 必须在浏览量写入和收藏状态风险处理后再评估是否缓存。

**技术栈：** Next.js App Router、React Server Components、Redis 缓存 helper、Prisma、1Panel Docker OpenResty、Cloudflare Cache Rules 与 Purge Cache API、Vitest、ApacheBench/k6。

---

## 当前结论

- `curl http://127.0.0.1:3000/` 只返回 `Cache-Control: s-maxage=120, stale-while-revalidate=31535880`。
- `curl -k --resolve www.otoame.top:443:127.0.0.1 https://www.otoame.top/` 返回同样的 header，并额外多了 `Cache-Control: no-cache`。
- `curl https://www.otoame.top/` 返回 `cf-cache-status: DYNAMIC`。
- 因此 `no-cache` 是 1Panel/OpenResty HTTPS 反代层加的，不是 Next.js 加的，也不是 Cloudflare 首先加的。该项已通过注释 OpenResty 中的 `add_header Cache-Control no-cache;` 修复，本机 HTTPS 反代已只返回 Next.js 的 `s-maxage`。
- `app/[id]/page.tsx` 已移除服务端渲染期间的浏览量写入。详情页 hydration 后由 `PatchViewBeacon` 调用 `POST /api/patch/views`，响应固定 `Cache-Control: private, no-store`。
- 卡片/列表数据已经使用 `withRealtimePatchViews`，因此只要请求到达源站，列表 API 可以展示 Redis 中的实时浏览量和下载量。
- `invalidatePatchContentCache`、`invalidatePatchListCaches`、`invalidateCompanyCaches`、`invalidateTagCaches` 已接入 Cloudflare purge。create/rewrite/download/favorite/resource/tag/company/comment/rating、详情页 tag/company 关系调整，以及相关后台更新/删除路径会进入这些失效函数。

---

## 缓存策略决策

代码改造前的 Cloudflare 策略：

- 不启用新的 HTML/API 共享缓存规则。
- 只保留已经修复的 OpenResty header，避免生产先进入错误缓存状态。
- 等任务 3、任务 4、任务 5 的本地代码检查完成后，再进入 Cloudflare 规则配置。

代码改造后的第一阶段 Cloudflare HTML 缓存范围：

- 现在可以缓存：`/`、`/otomegame`、`/tag`、`/tag/*`、`/company`、`/company/*`
- 暂不缓存：`/{uniqueId}` 游戏详情页
- 原因：浏览量写入已移出 SSR，但详情页 HTML 仍可能包含从登录 cookie 推导出的用户收藏状态，并受 NSFW 设置影响。第一阶段先缓存公开列表页面，详情页必须等 Cloudflare bypass 规则和匿名 HTML 边界验证后再启用。

代码改造后的第一阶段 Cloudflare API 缓存范围：

- 只缓存匿名请求：`/api/tag/otomegame`、`/api/company/otomegame`
- Edge TTL：15-30 秒
- Cache key：包含全部 query string，并忽略 query string 顺序
- 当请求带登录、NSFW 设置、屏蔽标签 cookie 时必须 bypass。

个性化 bypass cookie：

```txt
kun-galgame-patch-moe-token
kun-patch-setting-store|state|data|kunNsfwEnable
kun-patch-setting-store|state|data|kunBlockedTagIds
```

---

## 执行顺序

本计划必须按以下顺序执行，不按任务编号顺序直接配置 Cloudflare：

1. 任务 1：修复并验证 OpenResty 不再追加 `Cache-Control: no-cache`。
2. 任务 3：把 Cloudflare purge 接入本地缓存失效链路，确保 create/rewrite/download/favorite/tag/company 写入后可以清理边缘缓存。
3. 任务 4：把详情页浏览量增加移出服务端渲染，避免详情页未来被缓存后浏览统计失效。
4. 任务 4.5：把评论、评分等会改变公开统计/详情内容的写入接入同一缓存失效链路。
5. 任务 5 的步骤 1-2：检查详情页是否仍有 SSR 写入和用户收藏状态进入共享 HTML 的风险。
6. 任务 2：只在本地代码通过测试后，配置保守的 Cloudflare Cache Rules。
7. 任务 5 的步骤 3-4：仅在收藏状态和详情页统计风险处理完成后，评估是否缓存 `/{uniqueId}` 详情页。
8. 任务 6：Cache HIT 后进行生产压测并记录结果。

---

## 文件结构

运维/配置工作：

- 1Panel OpenResty 站点配置：只移除公开站点上额外追加的 `Cache-Control: no-cache`。
- Cloudflare 后台：在本地代码改造和测试通过后，添加有顺序的 Cache Rules 和 bypass rules。

后续应用代码工作：

- 修改：`app/[id]/page.tsx`  
  在客户端 beacon 可用后，移除 SSR 中的浏览量写入。
- 修改：`app/[id]/actions.ts`  
  如果浏览量写入替换为 route handler，则移除或停用对应 server action。
- 新增：`app/api/patch/views/route.ts`  
  提供客户端/beacon 触发的 POST 浏览量增加接口。
- 新增：`components/patch/view/PatchViewBeacon.tsx`  
  客户端组件，详情页 hydration 后发送一次浏览量增加请求。
- 修改：`components/patch/header/Container.tsx`  
  挂载 `PatchViewBeacon`，必要时对显示的浏览量做乐观更新。
- 修改：`app/api/patch/cache.ts`  
  在 Redis/ISR 缓存失效旁边增加 Cloudflare purge。
- 修改：`app/api/utils/purgeCloudflareCache.ts`  
  让 purge helper 具备安全 no-op、类型明确、缺少 env 时不报错、支持公开页面 URL purge 与公开 API prefix purge。
- 测试：`tests/unit/api/patch-cache.test.ts`  
  断言 Redis、ISR、Cloudflare purge 目标。
- 测试：`tests/unit/api/purge-cloudflare-cache.test.ts`  
  断言 Cloudflare purge payload 格式，尤其是 API prefix purge 不带 query string。
- 测试：`tests/unit/api/patch-view-route.test.ts`  
  断言新的浏览量 route 会校验输入并调用 `updatePatchViews`。
- 测试：`tests/unit/api/patch-social-cache.test.ts`  
  断言评论和评分写入会失效详情、列表和边缘缓存链路。
- 测试：`tests/unit/api/patch-relation-cache.test.ts`  
  断言详情页 tag/company 关系调整和清理空标签会清理对应公开缓存。

---

## 任务 1：修复 OpenResty 响应头

**文件：**
- 修改服务器上的 1Panel OpenResty `www.otoame.top` 站点配置
- 不修改仓库文件

- [ ] **步骤 1：定位 OpenResty 容器**

在 VPS 上运行：

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}' | grep -i openresty
```

预期：输出一个 1Panel/OpenResty 容器名。

- [ ] **步骤 2：定位注入的 header**

在 VPS 上运行，把 `<openresty-container>` 替换成容器名：

```bash
docker exec -it <openresty-container> sh -lc "nginx -T 2>/dev/null | grep -i -C 5 'no-cache\\|cache-control\\|expires\\|add_header'"
```

如果 `nginx -T` 不可用，运行：

```bash
docker exec -it <openresty-container> sh -lc "openresty -T 2>/dev/null | grep -i -C 5 'no-cache\\|cache-control\\|expires\\|add_header'"
```

预期：在站点/server/location 配置里找到 `add_header Cache-Control no-cache` 或等价配置。

- [ ] **步骤 3：移除公开页面的 `no-cache` 注入**

在 1Panel UI 或挂载的 OpenResty 配置中，只移除追加下面 header 的规则：

```nginx
add_header Cache-Control no-cache;
```

或：

```nginx
add_header Cache-Control "no-cache";
```

不要移除安全 header，例如：

```nginx
Strict-Transport-Security
X-Frame-Options
X-Content-Type-Options
```

- [ ] **步骤 4：重载 OpenResty**

使用 1Panel UI 的重载操作，或运行：

```bash
docker exec -it <openresty-container> sh -lc "nginx -t && nginx -s reload"
```

预期：语法检查成功，重载完成。

- [ ] **步骤 5：验证源站 header**

运行：

```bash
curl -sI http://127.0.0.1:3000/ | grep -i 'cache-control\|x-nextjs-cache'
curl -k -sI --resolve www.otoame.top:443:127.0.0.1 https://www.otoame.top/ | grep -i 'cache-control\|x-nextjs-cache\|server'
curl -sI https://www.otoame.top/ | grep -i 'cache-control\|cf-cache-status\|x-nextjs-cache'
```

重载后的预期结果：

```txt
cache-control: s-maxage=120, stale-while-revalidate=31535880
```

不应再出现：

```txt
cache-control: no-cache
```

- [ ] **步骤 6：提交**

本任务不需要仓库提交。

---

## 任务 2：配置保守的 Cloudflare Cache Rules（必须在代码改造后执行）

**文件：**
- 只改 Cloudflare 后台
- 可选后续更新：`docs/project/performance-optimization.md`

**前置条件：**
- 任务 1 已完成，OpenResty 本机 HTTPS 反代不再返回 `Cache-Control: no-cache`。
- 任务 3 已完成，create/rewrite/download/favorite/tag/company 等写入路径已能触发 Cloudflare purge。
- 任务 4 已完成，详情页浏览量写入已移出 SSR。
- 任务 5 的步骤 1-2 已完成，已确认详情页个性化状态不会进入共享缓存范围。

- [ ] **步骤 1：添加最高优先级的个性化请求 bypass 规则**

创建一个排在所有缓存规则之前的 Cache Rule：

```txt
http.host eq "www.otoame.top"
and (
  http.cookie contains "kun-galgame-patch-moe-token"
  or http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
  or http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
)
```

动作：

```txt
Bypass cache
```

预期：登录用户和带 NSFW/屏蔽标签个性化设置的用户永远不会收到共享缓存 HTML/API。

- [ ] **步骤 2：添加公开 HTML 缓存规则，但排除详情页**

在 bypass 规则之后创建 Cache Rule：

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
```

动作：

```txt
Eligible for cache / Cache Everything
Edge TTL: / 和 /otomegame 为 120 秒，/tag* 和 /company* 为 300 秒
Browser TTL: 尊重源站或短 TTL
Cache key: 标准 path + query string
```

不要包含：

```txt
starts_with(http.request.uri.path, "/api/")
```

不要包含：

```txt
匹配 "/[A-Za-z0-9]{8}" 的规则
```

- [ ] **步骤 3：添加匿名列表 API 缓存规则**

在个性化 bypass 规则之后创建 Cache Rule：

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
Eligible for cache / Cache Everything
Edge TTL: 30 秒
Cache key: 包含全部 query string
Ignore query string order: enabled
```

预期：`/api/tag/otomegame?tagId=15&page=1...` 与其他 query 组合会被分别缓存。

- [ ] **步骤 4：验证 Cloudflare HIT**

连续运行两次：

```bash
curl -sI https://www.otoame.top/ | grep -i 'cf-cache-status\|cache-control\|age'
curl -sI https://www.otoame.top/ | grep -i 'cf-cache-status\|cache-control\|age'
```

连续运行两次：

```bash
curl -sI 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|cache-control\|x-kun-cache\|age'
curl -sI 'https://www.otoame.top/api/tag/otomegame?tagId=15&page=1&limit=24&sortField=created&sortOrder=desc' | grep -i 'cf-cache-status\|cache-control\|x-kun-cache\|age'
```

第二次请求预期：

```txt
cf-cache-status: HIT
```

- [ ] **步骤 5：提交**

本任务不需要仓库提交。

---

## 任务 3：把 Cloudflare Purge 接入现有缓存失效（先于 Cloudflare 规则）

**文件：**
- 修改：`app/api/utils/purgeCloudflareCache.ts`
- 修改：`app/api/patch/cache.ts`
- 修改：`tests/unit/api/patch-cache.test.ts`
- 新增：`tests/unit/api/purge-cloudflare-cache.test.ts`

- [ ] **步骤 1：先写 purge 目标的失败测试**

在 `tests/unit/api/patch-cache.test.ts` 中，放到 `~/app/api/patch/cache` import 之前：

```ts
const purgePublicPageCacheMock = vi.hoisted(() => vi.fn())
const purgePublicApiCacheMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/utils/purgeCloudflareCache', () => ({
  purgePublicApiCache: purgePublicApiCacheMock,
  purgePublicPageCache: purgePublicPageCacheMock
}))
```

扩展 `beforeEach`：

```ts
purgePublicApiCacheMock.mockResolvedValue(undefined)
purgePublicPageCacheMock.mockResolvedValue(undefined)
```

添加断言：

```ts
expect(purgePublicPageCacheMock).toHaveBeenCalledWith(['/abc12345'])
expect(purgePublicPageCacheMock).toHaveBeenCalledWith(['/', '/otomegame'])
expect(purgePublicApiCacheMock).toHaveBeenCalledWith([
  '/api/tag/otomegame',
  '/api/company/otomegame'
])
expect(purgePublicPageCacheMock).toHaveBeenCalledWith(['/company', '/company/7'])
expect(purgePublicApiCacheMock).toHaveBeenCalledWith(['/api/company/otomegame'])
expect(purgePublicPageCacheMock).toHaveBeenCalledWith(['/tag', '/tag/15'])
expect(purgePublicApiCacheMock).toHaveBeenCalledWith(['/api/tag/otomegame'])
```

同时新增 `tests/unit/api/purge-cloudflare-cache.test.ts`，断言 `purgePublicApiCache(['/api/tag/otomegame'])` 发送的 payload 是：

```ts
{ prefixes: ['https://www.otoame.top/api/tag/otomegame'] }
```

初始预期：测试失败，因为 `purgePublicPageCache` / `purgePublicApiCache` 还不存在或没有被调用。

- [ ] **步骤 2：运行失败测试**

运行：

```bash
pnpm test tests/unit/api/patch-cache.test.ts tests/unit/api/purge-cloudflare-cache.test.ts
```

预期：因为缺少或未调用 purge helper 而 FAIL。

- [ ] **步骤 3：实现安全的公开页面 purge helper**

把 `app/api/utils/purgeCloudflareCache.ts` 调整为：

```ts
import { kunMoyuMoe } from '~/config/moyu-moe'

type CloudflarePurgePayload = {
  files?: string[]
  prefixes?: string[]
}

const getCloudflarePurgeConfig = () => {
  const zoneId = process.env.KUN_CF_CACHE_ZONE_ID
  const token = process.env.KUN_CF_CACHE_PURGE_API_TOKEN

  if (!zoneId || !token) {
    return null
  }

  return { zoneId, token }
}

const normalizePublicPath = (path: string) =>
  path.startsWith('/') ? path : `/${path}`

const toPublicUrl = (path: string) =>
  `${kunMoyuMoe.domain.main}${normalizePublicPath(path)}`

const unique = (values: string[]) => [...new Set(values)]

export const purgeCloudflareCache = async (
  payload: string[] | CloudflarePurgePayload
) => {
  const config = getCloudflarePurgeConfig()
  const body = Array.isArray(payload) ? { files: payload } : payload
  if (
    !config ||
    ((body.files?.length ?? 0) === 0 && (body.prefixes?.length ?? 0) === 0)
  ) {
    return { status: 0 }
  }

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.token}`
        },
        body: JSON.stringify(body)
      }
    )

    if (!res.ok) {
      console.error('[Cloudflare] Purge cache failed:', res.status)
    }

    return { status: res.status }
  } catch (error) {
    console.error('[Cloudflare] Purge cache request failed:', error)
    return { status: 0 }
  }
}

export const purgePublicPageCache = async (paths: string[]) => {
  await purgeCloudflareCache({ files: unique(paths.map(toPublicUrl)) })
}

export const purgePublicApiCache = async (paths: string[]) => {
  await purgeCloudflareCache({ prefixes: unique(paths.map(toPublicUrl)) })
}
```

注意：Cloudflare prefix purge 不接受 query string。传入 `/api/tag/otomegame` 即可覆盖 `/api/tag/otomegame?...` 的 query 变体。

- [ ] **步骤 4：在缓存失效 helper 中调用 purge**

在 `app/api/patch/cache.ts` 中增加 import：

```ts
import {
  purgePublicApiCache,
  purgePublicPageCache
} from '~/app/api/utils/purgeCloudflareCache'
```

在 `invalidatePatchContentCache` 中：

```ts
  await Promise.all([
    delKv(getPatchCacheKey(uniqueId)),
    delKv(getPatchIntroductionCacheKey(uniqueId))
  ])

  safeRevalidatePath(`/${uniqueId}`, 'page')
  await purgePublicPageCache([`/${uniqueId}`])
```

在 `invalidatePatchListCaches` 中：

```ts
  safeRevalidatePath('/', 'page')
  safeRevalidatePath('/otomegame', 'page')
  await Promise.all([
    purgePublicPageCache(['/', '/otomegame']),
    purgePublicApiCache(['/api/tag/otomegame', '/api/company/otomegame'])
  ])
```

在 `invalidateCompanyCaches` 中：

```ts
  safeRevalidatePath('/company', 'page')
  if (companyId) {
    safeRevalidatePath(`/company/${companyId}`, 'page')
  }
  await Promise.all([
    purgePublicPageCache(companyId ? ['/company', `/company/${companyId}`] : ['/company']),
    purgePublicApiCache(['/api/company/otomegame'])
  ])
```

在 `invalidateTagCaches` 中：

```ts
  safeRevalidatePath('/tag', 'page')
  if (tagId) {
    safeRevalidatePath(`/tag/${tagId}`, 'page')
  }
  await Promise.all([
    purgePublicPageCache(tagId ? ['/tag', `/tag/${tagId}`] : ['/tag']),
    purgePublicApiCache(['/api/tag/otomegame'])
  ])
```

- [ ] **步骤 5：运行测试**

运行：

```bash
pnpm test tests/unit/api/patch-cache.test.ts tests/unit/api/purge-cloudflare-cache.test.ts
pnpm typecheck
```

预期：PASS。

- [ ] **步骤 6：提交**

```bash
git add app/api/utils/purgeCloudflareCache.ts app/api/patch/cache.ts tests/unit/api/patch-cache.test.ts tests/unit/api/purge-cloudflare-cache.test.ts
git commit -m "perf: purge cloudflare public page cache"
```

---

## 任务 4：把详情页浏览量增加移出服务端渲染（先于详情页缓存评估）

**文件：**
- 新增：`app/api/patch/views/route.ts`
- 新增：`components/patch/view/PatchViewBeacon.tsx`
- 修改：`app/[id]/page.tsx`
- 修改：`app/[id]/actions.ts`
- 修改：`components/patch/header/Container.tsx`
- 测试：`tests/unit/api/patch-view-route.test.ts`

- [ ] **步骤 1：编写 route 测试**

创建 `tests/unit/api/patch-view-route.test.ts`：

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updatePatchViewsMock = vi.hoisted(() => vi.fn())
vi.mock('~/app/api/patch/views/put', () => ({
  updatePatchViews: updatePatchViewsMock
}))

import { POST } from '~/app/api/patch/views/route'

const request = (body: unknown) =>
  new Request('https://www.otoame.top/api/patch/views', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

describe('patch view route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updatePatchViewsMock.mockResolvedValue(undefined)
  })

  it('increments a valid patch view and prevents shared cache storage', async () => {
    const response = await POST(
      request({ uniqueId: 'abc12345', currentView: 10 })
    )

    expect(response.status).toBe(200)
    expect(updatePatchViewsMock).toHaveBeenCalledWith('abc12345', 10)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('rejects invalid patch ids', async () => {
    const response = await POST(request({ uniqueId: 'bad', currentView: 1 }))

    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(updatePatchViewsMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **步骤 2：运行失败测试**

运行：

```bash
pnpm test tests/unit/api/patch-view-route.test.ts
```

预期：FAIL，因为 route 还不存在。

- [ ] **步骤 3：实现浏览量 route**

创建 `app/api/patch/views/route.ts`：

```ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { updatePatchViews } from './put'

const VIEW_CACHE_CONTROL = 'private, no-store'

const viewSchema = z.object({
  uniqueId: z.string().regex(/^[A-Za-z0-9]{8}$/),
  currentView: z.number().int().min(0).optional()
})

const jsonNoStore = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': VIEW_CACHE_CONTROL
    }
  })

export const POST = async (req: Request) => {
  const body = await req.json().catch(() => null)
  const input = viewSchema.safeParse(body)
  if (!input.success) {
    return jsonNoStore('非法浏览量请求', 400)
  }

  await updatePatchViews(input.data.uniqueId, input.data.currentView)

  return jsonNoStore({})
}
```

- [ ] **步骤 4：添加客户端 beacon**

创建 `components/patch/view/PatchViewBeacon.tsx`：

```tsx
'use client'

import { useEffect, useRef } from 'react'

interface Props {
  uniqueId: string
  currentView: number
  onViewed?: () => void
}

export const PatchViewBeacon = ({ uniqueId, currentView, onViewed }: Props) => {
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) {
      return
    }
    sentRef.current = true

    void fetch('/api/patch/views', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'kun-fetch'
      },
      body: JSON.stringify({ uniqueId, currentView }),
      keepalive: true
    })
      .then((response) => {
        if (response.ok) {
          onViewed?.()
        }
      })
      .catch((error) => {
        console.error('Failed to record patch view:', error)
      })
  }, [currentView, onViewed, uniqueId])

  return null
}
```

说明：`/api/patch/views` 会经过 middleware 的 CSRF 校验，裸 `navigator.sendBeacon` 不能设置 `X-Requested-With`，所以这里使用 `fetch(..., { keepalive: true })`。

- [ ] **步骤 5：移除 SSR 浏览量写入**

在 `app/[id]/page.tsx` 中，移除 `kunUpdatePatchViewsActions` import 和调用逻辑：

```ts
  const patch = pageData.patch
```

不再在服务端渲染时增加浏览量。

- [ ] **步骤 6：在 header container 中挂载 beacon**

在 `components/patch/header/Container.tsx` 中导入并渲染：

```tsx
import { PatchViewBeacon } from '~/components/patch/view/PatchViewBeacon'
```

组件内部添加：

```tsx
<PatchViewBeacon
  uniqueId={displayPatch.uniqueId}
  currentView={displayPatch.view}
  onViewed={handleViewed}
/>
```

预期：详情页不再依赖 SSR 记录浏览量；浏览器 hydration 后仍会记录浏览量，并对页面展示值做一次乐观更新。详情页 HTML 是否进入 Cloudflare 共享缓存仍要等待任务 5 的收藏状态和 NSFW 边界验证。

- [ ] **步骤 7：运行测试**

运行：

```bash
pnpm test tests/unit/api/patch-view-route.test.ts
pnpm typecheck
```

预期：PASS。

- [ ] **步骤 8：提交**

```bash
git add app/api/patch/views/route.ts components/patch/view/PatchViewBeacon.tsx app/[id]/page.tsx app/[id]/actions.ts components/patch/header/Container.tsx tests/unit/api/patch-view-route.test.ts
git commit -m "perf: move patch view tracking off server render"
```

---

## 任务 4.5：补齐公开社交统计的缓存失效

**文件：**
- 修改：`app/api/patch/comment/create.ts`
- 修改：`app/api/patch/comment/update.ts`
- 修改：`app/api/patch/comment/delete.ts`
- 修改：`app/api/patch/rating/create.ts`
- 修改：`app/api/patch/rating/update.ts`
- 修改：`app/api/patch/rating/delete.ts`
- 修改：`app/api/admin/comment/delete.ts`
- 修改：`app/api/admin/comment/update.ts`
- 修改：`app/api/admin/rating/delete.ts`
- 修改：`app/api/admin/rating/update.ts`
- 修改：`app/api/admin/report/service.ts`
- 测试：`tests/unit/api/patch-social-cache.test.ts`

- [ ] **步骤 1：编写失败测试**

`tests/unit/api/patch-social-cache.test.ts` 覆盖：

- 创建评论后调用 `invalidatePatchContentCache(uniqueId)` 和 `invalidatePatchListCaches()`。
- 更新评论后调用 `invalidatePatchContentCache(uniqueId)`。
- 删除评论树后调用 `invalidatePatchContentCache(uniqueId)` 和 `invalidatePatchListCaches()`。
- 创建、更新、删除评分后调用 `invalidatePatchContentCache(uniqueId)` 和 `invalidatePatchListCaches()`。
- 后台更新评论/简评后调用 `invalidatePatchContentCache(uniqueId)`。

初始预期：FAIL，因为评论/评分写入只更新 DB，不会清理公开 HTML/API 边缘缓存。

- [ ] **步骤 2：实现缓存失效**

在评论和评分 service 中查询或返回 `patch.unique_id`，写入成功后调用：

```ts
await Promise.all([
  invalidatePatchContentCache(uniqueId),
  invalidatePatchListCaches()
]).catch((error) => {
  console.error('Failed to invalidate patch social cache:', error)
})
```

评论更新只改变详情内容，不改变列表计数时只需要 `invalidatePatchContentCache(uniqueId)`。

后台批量更新/删除评论、评分，以及举报处理中删除评论/评分时，也要按受影响的 `unique_id` 失效详情缓存；会改变计数或评分统计的删除操作额外清理列表缓存。

- [ ] **步骤 3：运行测试**

```bash
pnpm test tests/unit/api/patch-social-cache.test.ts
pnpm typecheck
```

预期：PASS。

- [ ] **步骤 4：提交**

```bash
git add app/api/patch/comment/create.ts app/api/patch/comment/update.ts app/api/patch/comment/delete.ts app/api/patch/rating/create.ts app/api/patch/rating/update.ts app/api/patch/rating/delete.ts app/api/admin/comment/delete.ts app/api/admin/comment/update.ts app/api/admin/rating/delete.ts app/api/admin/rating/update.ts app/api/admin/report/service.ts tests/unit/api/patch-social-cache.test.ts
git commit -m "perf: invalidate patch social cache"
```

---

## 任务 4.6：补齐详情页关系和维护接口的缓存失效

**文件：**
- 修改：`app/api/patch/introduction/tag/service.ts`
- 修改：`app/api/patch/introduction/company/service.ts`
- 修改：`app/api/tag/clear-empty/route.ts`
- 测试：`tests/unit/api/patch-relation-cache.test.ts`

- [ ] **步骤 1：编写失败测试**

覆盖：

- 详情页添加/移除 tag 后清理当前游戏详情缓存，并清理 tag 列表/详情/API 缓存。
- 详情页添加/移除 company 后清理当前游戏详情缓存，并清理 company 列表/详情/API 缓存。
- 清理空标签后清理 tag 列表/详情/API 缓存。

- [ ] **步骤 2：实现缓存失效**

关系调整服务先按 `patchId` 查询 `patch.unique_id`，再调用：

```ts
await Promise.all([
  invalidatePatchContentCache(uniqueId),
  invalidateTagCaches()
])
```

company 关系调整使用 `invalidateCompanyCaches()`；清理空标签使用 `invalidateTagCaches()`。

- [ ] **步骤 3：运行测试**

```bash
pnpm test tests/unit/api/patch-relation-cache.test.ts
pnpm typecheck
```

预期：PASS。

---

## 任务 5：重新评估是否缓存游戏详情页 HTML（默认不缓存）

**文件：**
- Cloudflare 后台
- 可选修改：`docs/project/performance-optimization.md`

- [ ] **步骤 1：确认详情页 SSR 不再产生写入**

运行：

```bash
rg -n "kunUpdatePatchViewsActions|updatePatchViews" 'app/[id]' components/patch app/api/patch/views
```

预期：

```txt
updatePatchViews 只出现在 app/api/patch/views/route.ts 或底层 views helper。
PatchViewBeacon 出现在 components/patch/view/PatchViewBeacon.tsx 和 components/patch/header/Container.tsx。
```

不应出现在：

```txt
app/[id]/page.tsx
app/[id]/actions.ts
```

- [ ] **步骤 2：确认用户收藏状态不会进入共享详情页 HTML**

检查 `components/patch/header/button/favorite/FavoriteButton.tsx` 和 `components/patch/header/Container.tsx`。

启用详情页 HTML 缓存前必须满足以下条件之一：

- 收藏按钮状态改为客户端获取，或者匿名缓存 HTML 中不包含用户特定收藏状态；
- Cloudflare 对带登录 cookie 的详情页请求始终 bypass，且匿名 HTML 不包含用户特定状态。

- [ ] **步骤 3：只有步骤 2 通过后，才添加详情页缓存规则**

添加单独的 Cache Rule：

```txt
http.host eq "www.otoame.top"
and http.request.method eq "GET"
and http.request.uri.path matches "^/[A-Za-z0-9]{8}$"
and not http.cookie contains "kun-galgame-patch-moe-token"
and not http.cookie contains "kun-patch-setting-store|state|data|kunNsfwEnable"
and not http.cookie contains "kun-patch-setting-store|state|data|kunBlockedTagIds"
```

动作：

```txt
Eligible for cache / Cache Everything
Edge TTL: 60-120 秒
Cache key: path only
```

- [ ] **步骤 4：验证详情页缓存不会压制统计写入**

运行：

```bash
curl -sI https://www.otoame.top/<uniqueId> | grep -i 'cf-cache-status\|cache-control'
curl -sI https://www.otoame.top/<uniqueId> | grep -i 'cf-cache-status\|cache-control'
```

第二次请求预期：

```txt
cf-cache-status: HIT
```

在浏览器 Network 面板确认：

```txt
POST /api/patch/views 200
```

- [ ] **步骤 5：提交**

如果只改 Cloudflare 配置，本任务不需要仓库提交。

---

## 任务 6：Cache HIT 后的生产压测（最后执行）

**文件：**
- 不修改仓库文件

- [ ] **步骤 1：预热并确认缓存**

运行：

```bash
curl -sI https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'
curl -sI https://www.otoame.top/ | grep -i 'cf-cache-status\|age\|cache-control'
curl -sI https://www.otoame.top/otomegame | grep -i 'cf-cache-status\|age\|cache-control'
curl -sI https://www.otoame.top/tag | grep -i 'cf-cache-status\|age\|cache-control'
curl -sI https://www.otoame.top/company | grep -i 'cf-cache-status\|age\|cache-control'
```

预期：

```txt
cf-cache-status: HIT
```

- [ ] **步骤 2：运行保守的 Cloudflare 压测**

运行：

```bash
ab -k -l -n 3000 -c 50 https://www.otoame.top/
ab -k -l -n 3000 -c 50 https://www.otoame.top/otomegame
ab -k -l -n 3000 -c 50 https://www.otoame.top/tag
ab -k -l -n 3000 -c 50 https://www.otoame.top/company
```

预期：

- `Failed requests: 0`
- QPS 明显高于之前 `DYNAMIC` 状态的结果
- VPS CPU、PM2、Redis 压力较低

- [ ] **步骤 3：运行 k6 持续流量测试**

创建 `/tmp/otoame-cache-hit-loadtest.js`：

```js
import http from 'k6/http'
import { check } from 'k6'

export const options = {
  scenarios: {
    public_pages: {
      executor: 'constant-arrival-rate',
      rate: 100,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 200,
      maxVUs: 1000
    }
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800']
  }
}

const urls = [
  'https://www.otoame.top/',
  'https://www.otoame.top/otomegame',
  'https://www.otoame.top/tag',
  'https://www.otoame.top/company'
]

export default function () {
  const res = http.get(urls[Math.floor(Math.random() * urls.length)])
  check(res, { 'status is 200': (r) => r.status === 200 })
}
```

运行：

```bash
docker run --rm -i grafana/k6 run - < /tmp/otoame-cache-hit-loadtest.js
```

预期：

- `http_req_failed` 低于 1%
- P95 满足目标地区的可接受范围
- Cloudflare analytics 显示较高 cache hit ratio
- VPS origin requests 保持较低

- [ ] **步骤 4：记录结果**

更新 `docs/project/performance-optimization.md`，记录：

- 日期
- Cloudflare cache rule 状态
- cache status headers
- origin QPS
- Cloudflare HIT QPS
- 已知限制

- [ ] **步骤 5：提交**

```bash
git add docs/project/performance-optimization.md
git commit -m "docs: record cloudflare edge cache benchmark"
```

---

## 约束与防线

- 绝不把认证页面或认证 API 放进 Cloudflare 共享缓存。
- 除非规则已明确 bypass 个性化流量且响应已确认匿名，否则不要缓存带 `Set-Cookie` 的响应。
- 在浏览量增加移出 SSR 前，不启用游戏详情页 HTML 缓存。
- 匿名列表 API 的 Edge TTL 保持短 TTL：15-30 秒。
- `/api/patch/views`、下载、收藏、评分、评论、登录、设置、管理后台、编辑、申请、消息、用户资料写接口全部 bypass。
- Cloudflare purge 失败不应阻断业务写入，但必须记录日志。
- 缓存行为必须看响应头验证，不靠猜测：`cf-cache-status`、`age`、`cache-control`、`x-nextjs-cache`、`x-kun-cache`。

---

## 自检

- 需求覆盖：
  - OpenResty `no-cache` 修复由任务 1 覆盖。
  - Cloudflare Cache Rule 讨论与配置由任务 2 覆盖。
  - 实时数据风险由任务 4 和任务 5 覆盖。
  - create/rewrite 后 purge 由任务 3 覆盖，因为 create/rewrite 已调用现有缓存失效 helper。
  - 严格缓存范围由“缓存策略决策”和“约束与防线”覆盖。
- 占位内容扫描：
  - 没有 TBD/TODO 类占位内容。
- 类型一致性：
  - `purgePublicPageCache(paths: string[])` 先定义后使用。
  - `PatchViewBeacon` props 与计划中的使用方式一致。
  - `POST /api/patch/views` 调用现有 `updatePatchViews(uniqueId, currentView)`。
