# 会社身份解析与跨来源去重实施计划

**Goal:** 消除「同一家会社因来源写法不同被重复创建」的问题，同时**不丢失** Bangumi 独有的发行商与制作方。把同一性判定从字符串精确匹配升级为「外部身份 → 规范化主名 → 规范化别名 → 同批候选」的分级解析，并让 `/edit` 与投稿两条路径共用同一套规则。

**Architecture:** **候选 + 解析两段式。** 页面抓取阶段把每个来源的会社信息冻结成结构化 `CompanyCandidate`（保留外部 ID、别名、角色、实体类型、证据 URL）；写入阶段由唯一的共享 resolver 把候选解析成 canonical 会社。resolver 拆成 `plan`（只读，可在预览调用）与 `apply`（批准事务内重新解析并落库）两层，**两层共用同一套判定规则**，预览只是提前展示。

**批准仍然不联网。** 审核批准只消费**服务端持有的候选快照**（`patch_submission.company_candidates`，不在 payload 里，见「可信状态边界」），不访问 VNDB / Bangumi / Steam，也不发布无歧义子集——批准是全有或全无。

**Tech Stack:** Next.js 15.5.18 App Router、TypeScript、Prisma 7.8 / PostgreSQL 18、Redis、Zustand、HeroUI v2、Vitest 4。

## 产品语义（owner 定稿）

> 「会社」是与作品相关的**实体集合**，包含开发商、发行商、制作方与同人社团；**当前不按角色分栏**。不同来源先解析为 canonical 会社，同一实体只关联一次。

具体含义，四条都要成立：

- 开发商 A 与发行商 B 分别关联为**两家**会社；
- 同一家公司同时承担开发与发行时，只关联**一次**；
- role **不参与**同一性判定；
- 正式条目**不展示也不持久化**角色，但从抓取到 resolver 的整条链路上**不得提前丢掉**角色。

UI 沿用现有「所属会社 / 相关会社」措辞即可，**不新增**开发商 / 发行商两套控件。

## 已定方向

以下已由 owner 决策，不再讨论：

1. **VNDB 是身份权威，来源全部保留，不做来源丢弃。** 撤回「VNDB 优先、Bangumi 兜底」——那条是丢数据（记录在 `docs/modules/api-services.md:220`，是本地分叉；上游 `e49550a4 feat(patch): merge company fetch across sources` 明确朝合并方向走）。VNDB producer 决定「是哪家」，其余来源的写法只在**有权威依据**时收敛，没有依据时各自成一家。
2. **只有服务端抓取的快照是权威数据。** 客户端提交的名称字符串是**非权威候选**：可以匹配已有主名 / 别名，可以创建新会社及其主名 identity，**但不得绑定 external ID，也不得给已有会社新增 `authoritative` 别名**。理由见「可信状态边界」。
3. **快照按来源保存并绑定本次抓取用的外部 ID。** 存 `{ vndb: { lookupId, fetchedAt, candidates }, bangumi: …, steam: …, dlsite: … }`，批准时只有 `lookupId` 与投稿当前对应外部 ID 相等的快照才算已验证；不等则忽略并产出管理员诊断。抓到零家也要存**空快照**，用来区分「已验证为空」与「从未抓取」。
4. **推断不参与自动解析。** 撤回「1:1 收敛」与「官网域名匹配」两条开闸规则。推断结果只进维护建议，人工确认后才升为 `authoritative`；**不得写 `patch_company.alias`，不得参与后续 resolver**。理由见「为什么不做推断收敛」。
5. **系统自动消歧，人工介入只留给真矛盾。** 目标是审核批准不因命名问题阻塞。仍需人工的只有：同一个 `(source, externalId)` 指向两家现有会社，以及同一别名挂在两家会社上且没有外部 ID 能破平。
6. **external ID 命中 A、名称命中 B 不阻断批准。** 当前作品关联权威 external ID 对应的 A，不给 A 补 B 的名称或别名；管理员预览显示醒目诊断，批准日志持久记录候选、A/B ID 与冲突类型，后续进入会社身份维护清单。它是非阻断诊断，不属于 `ambiguities`。
7. **批准全有或全无。** 命中阻断型真矛盾时整体中止，不发布无歧义子集。出口是「会社身份维护」，**不是**「要求修改」（投稿人没有会社归并能力）。无法及时解决时只能继续待审，或驳回并返还押金。
8. **预览与批准共用同一套判定规则**，预览不得使用临时弱解析语义。resolver 代码可以提前部署，但预览与写入只能由同一个 feature flag 同时启用。
9. **角色的持久化边界**：角色**只用于来源溯源与解析**，不属于正式关系数据。投稿路径把角色冻结在服务端快照里；`/edit` 直接创建与重写没有快照，角色经过 resolver 后即丢失。既然当前不区分角色，这是可接受的——**但计划与文档不得声称所有路径永久保留角色**。将来若确实要持久化：保留 `@@unique([patch_id, company_id])`，在关系行上加 `roles String[]`，冲突时合并角色集合。
10. **主名按 中文 > 日文 > 其他 选取**（owner 2026-08-30 定稿，原话「中文>日文>其他」），其余写法一律转别名。注意自动判定语言不可靠：有假名可判日文、纯拉丁可判其他，**纯汉字无法区分中日**（`戯画` 是日文，`橘子班` 是中文）。所以实际取名顺序是：人工填过的中文名 → VNDB `original`（用 producer 的 `lang` 字段判语言，比猜字形可靠）→ VNDB `name`（多为罗马字）→ 第一个可用来源名。**「中文」这一档大多为空**，多数会社会落在日文原名上。
11. **所有唯一约束由 Prisma schema 表达**，禁止 partial / 表达式唯一索引。原因：`scripts/checkPrismaProductionSchema.ts` 的漂移守卫只放行 `patch_released_idx` 这一个操作符类假漂移，三个 skill 都写明「never broaden it」。
12. **规范化只做 NFKC、trim、连续空白折叠、大小写折叠**。不删除 `Co., Ltd.` / `Studio` 等后缀，不做罗马字相似度匹配。
13. **数据库上线顺序**：结构（无约束）→ 回填 → 盘点冲突 → 人工解决 → 加唯一约束。应用代码不得先于数据库结构上线，**每一次结构变更都要有自己的 preflight / sync / postflight**。
14. **生产迁移**沿用带日期的 `preflight` / `sync` SQL 对 + 静态契约测试 + 临时 PostgreSQL 演练，禁止 `prisma db push`。
15. **抓来的链接一律称「来源链接 / 未经验证的网站链接」，不得称「官网」。** Steam developer link 与 DLSite circle link 保持现有写入行为（新建会社时写入 `official_website`，已有值不覆盖），同时在候选里留一份作解析证据；但**不做数据库唯一身份**——它可能是发行商聚合页或搜索 URL，多家实体共用同一链接，做成唯一约束会让合法数据插入失败、直接卡住批准。核实链接是否确属官网不在本计划范围内。
16. **合并历史重复时不做 301 重定向**（owner 2026-08-30 定稿，原话「4 不用 301」），接受 `/company/<旧id>` 变 404。缓解是被合并的名字全部保留为别名，用户拿旧名搜索仍能找到该会社——死掉的只是 URL，内容没有消失。
17. **标签 / 会社计数一致性不在本计划范围内。** 它影响标签、会社、删除流程、维护脚本与生产迁移，独立成批，且**必须在 resolver 正式接管写入前落地**。见 `docs/superpowers/plans/2026-08-30-tag-company-count-consistency.md`。

## 根因

| #   | 位置                                              | 问题                                                                                                                                                                                                           |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `app/api/edit/companyEnsureHelper.ts:12`          | 查找条件只有 `{ name }` 或 `{ alias: { has: name } }`，全字符串精确匹配，唯一规范化是 `trim()`                                                                                                                 |
| 2   | `app/api/edit/companyEnsureHelper.ts:64-70`       | `toCreate` 只与**数据库已有**的 name/alias 比对，同一批待创建候选之间不比较，`createMany({ skipDuplicates: true })` 只能拦完全相同的 name                                                                      |
| 3   | `app/api/patch-submission/publishPreview.ts:58`   | VNDB / Bangumi / Steam / DLSite 四源字符串拼接，只做 `trim` + 精确去重                                                                                                                                         |
| 4   | `app/api/patch-submission/publishCore.ts:131-146` | 批准时只有名称字符串，一律写 `alias: []`；VNDB producer ID 与权威别名全部丢失                                                                                                                                  |
| 5   | `app/api/edit/bangumi/route.ts:30-38`             | `DEVELOPER_KEYS` 含 `开发/开发商/发行/发行商/制作/製作`，压成一个无角色字符串数组。因此 `processExternalData.ts:210-216` 的「VNDB 关联成功就清空 primaryDevelopers」会**静默丢掉只有 Bangumi 知道的发行商**    |
| 6   | `app/api/edit/fetchCompanies.ts:12-38`            | 请求里已经拿到 `developers{id,...}`，但 `toCompanyCreate` 丢弃 producer ID 与 `type`；`:30` 还把 alias 逗号串写进 `introduction`                                                                               |
| 7   | `components/edit/components/SteamInput.tsx:140`   | 只保存 `developer.name`，丢弃 `developer.link`                                                                                                                                                                 |
| 8   | `prisma/schema/patch-company.prisma:4`            | 只有原始 `name @unique`，`alias` 是普通数组；大小写 / 全半角 / 别名写法数据库无法阻止                                                                                                                          |
| 9   | `app/api/edit/dlsite.ts:58`                       | `findFirst({ where: { name } })` 完全不查 alias。当前 UI 未接入（`components/edit/create/DLSiteInput.tsx` 无人 import，`RewritePatch.tsx:26` 的 import 被注释，且它不回填 `dlsiteCircleName`），只影响历史数据 |
| 10  | `prisma/schema/patch-submission.prisma:16`        | `payload_version` 有默认值但**全仓库没有任何写入方**；`review.ts:176` 与 `submit.ts:237` 是裸 `as unknown as PatchSubmissionPayload`                                                                           |

## 可信状态边界

**问题**：`payload` 由浏览器经 `PUT /api/patch-submission` 写入，服务端只做 zod 形状校验（`app/api/patch-submission/service.ts:277`）。如果候选放在 payload 里，普通用户改一个 autosave 请求就能把任意 VNDB producer ID 绑到任意会社、或往身份表注入别名——而这些别名会参与**后续所有条目**的匹配。这是权限提升，不是脏数据。

**因此候选不进 payload。** 新增由服务端持有的列 `patch_submission.company_candidates Json?`，只由投稿域专用 API 写入。这同时消掉了 payload 版本兼容问题：`payload` 形状不变，`payload_version` 不需要升，「该列有值」本身就是新格式信号，而且是**逐行**判断，不是全局版本位——原先「v2 上线漏了 v1 decoder，队列里的 pending 投稿静默发布成零会社」这个 Critical 随之消失。

**写入入口必须是投稿域专用 API**，不是给通用抓取路由加副作用：

```
POST /api/patch-submission/[id]/external-data   { source: 'vndb' | 'bangumi' | 'steam' | 'dlsite', … }
```

`app/api/edit/vndb/details/route.ts`、`bangumi/route.ts`、`steam/route.ts` 这三个通用路由**完全没有登录校验**（handler 里没有 `verifyHeaderCookie`），它们只是抓取器。给它们加「传了 submissionId 就写库」会造出一条**未鉴权的写路径**，而且它们连用户身份都拿不到，做不了归属校验。新 API 调用同一批共享抓取函数，把归属、可编辑状态、限频与写入语义全部留在投稿域。

**`/edit` 直接创建与重写不适用快照**（没有投稿行）。它的规则是：能按外部 ID 在服务端重新抓取的就重新抓（现状 VNDB 已经这样做，`create.ts:186`）；Bangumi / Steam / DLSite 名称仍来自客户端，按**非权威候选**处理。该路径仅 role ≥ 4 可用，所以不是普通用户的权限问题，但客户端字符串照样**不得绑定 external ID、不得给已有会社新增 `authoritative` 别名**。

## 数据契约

### 快照容器

`patch_submission.company_candidates` 的形状：按来源分槽，每槽绑定本次抓取使用的外部 ID。

```ts
export interface CompanyCandidateSnapshot {
  /** 本次抓取使用的外部 ID，批准时与投稿当前对应字段比对。 */
  lookupId: string
  fetchedAt: string
  candidates: CompanyCandidate[]
}

export type CompanyCandidateSnapshots = {
  [S in CompanyCandidateSource]: CompanyCandidateSnapshot | null
}
```

两条硬规则：

- **`lookupId` 不匹配即整槽作废。** 用户抓取 VNDB `v123` 后把表单改成 `v456` 却没重新抓取，旧槽必须被忽略并产出管理员诊断——否则会把 `v123` 的会社发布到 `v456` 的条目上。作废的后果是「这个来源没有会社」，不是「关联了错误的会社」。
- **抓到零家也要写空快照**（`candidates: []`）。`null` 表示「从未抓取」，空数组表示「已验证为空」，两者不能混。

### 快照写入必须按来源串行合并

三个来源可以并行抓完。若各自读旧 JSON、改自己那一槽、再整体写回，后完成的会覆盖先完成的。所以：

1. 网络请求在**事务外**完成；
2. 保存用一个**短事务**：锁投稿行 → 重读最新快照 → 只替换本来源那一槽 → 条件式更新；
3. 事务内重新校验：登录用户、投稿归属、状态仍可编辑、**投稿未在抓取期间被提交审核**。

不要跨网络持有事务。快照列**不复用 autosave 的 `revision`**——那个是给 payload 跨设备冲突用的，绑上去会让一次无关的正文编辑打断抓取保存。

### `CompanyCandidate`

新增 `app/api/company/identity/types.ts`：

```ts
export type CompanyCandidateSource = 'vndb' | 'bangumi' | 'steam' | 'dlsite'

/** 这家会社在这部作品里承担的关系。上游标不清时用 unknown，不猜。 */
export type CompanyRole =
  | 'developer'
  | 'publisher'
  | 'producer'
  | 'circle'
  | 'unknown'

/** 实体自身的性质，与 role 正交。VNDB 的 co/ng/in 属于这一维。 */
export type CompanyEntityType =
  | 'company'
  | 'individual'
  | 'amateur_group'
  | 'unknown'

/** 存储形态里**没有**信任字段，见下方「信任级别必须在读取时派生」。 */
export interface CompanyCandidate {
  source: CompanyCandidateSource
  /** 上游稳定 ID。没有则为空串，**不要**用 URL 顶替。 */
  externalId: string
  name: string
  aliases: string[]
  roles: CompanyRole[]
  /** 上游原始标签，如 Bangumi infobox 的 key。仅供溯源与人工判断。 */
  sourceRoles: string[]
  entityType: CompanyEntityType
  /** 解析证据与来源链接，未经核实，不参与唯一约束。 */
  externalUrls: string[]
  primaryLanguage: string
  /** 未经验证的网站链接，沿用现有写入行为，不得称「官网」。 */
  sourceWebsites: string[]
}
```

### 信任级别必须在读取时派生

信任**不是候选上的一个布尔字段**——那种字段可以被任何代码路径或一份损坏 JSON 置成 `true`。正确形态是读取时派生：

```ts
export type CompanyCandidateTrust = 'verified' | 'unverified'

export interface TrustedCompanyCandidate {
  trust: CompanyCandidateTrust
  candidate: CompanyCandidate
}
```

`readVerifiedCompanyCandidates(submission)` 是唯一能给出 `verified` 的地方，条件是「来自服务端快照 **且** 该槽 `lookupId` 与投稿当前对应外部 ID 相等」。客户端字符串派生出的候选由构造函数固定为 `unverified`，无法被覆盖。

`unverified` 候选只能做两件事：匹配已有主名 / 别名，或创建一家新会社及其**主名** identity。不能绑 external ID，不能给已有会社加 `authoritative` 别名。

### 快照本身也要重新校验

「服务端持有」不等于「永远不会损坏」——旧代码、迁移脚本、手工维护都可能留下坏 JSON。`company_candidates` 必须有**自己的 zod schema**，读取时对数据库内容重新解析，并强制上限：每来源候选数、每候选的别名数、以及所有名称字段的 107 字符上限（与 `patch_company.name` 的 `VarChar(107)` 对齐）。解析失败即视为该槽不可用并产出管理员诊断，不得让损坏数据静默通过批准。

### 各来源映射

| 来源    | externalId                        | roles                                                                                                                         | entityType                                        | 别名来源                                   | 备注                                                                  |
| ------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| VNDB    | producer `id`（强身份，必须保留） | `['developer']`——取自 `developers` 字段，权威                                                                                 | `co→company`、`in→individual`、`ng→amateur_group` | `original` + `aliases`，标 `authoritative` | `sourceWebsites` 取 `extlinks[].url`；`primaryLanguage` 取 `lang`     |
| Bangumi | 无（`''`）                        | 由 infobox key 映射：`开发/开发商/游戏开发商→developer`，`发行/发行商→publisher`，`制作/製作→unknown`（无法确定，不强行归类） | `unknown`                                         | 无                                         | `sourceRoles` 存原始 key；`extractDevelopers` 必须停止丢弃 `item.key` |
| Steam   | 无（`''`）                        | `['developer']`（Steam 的 developers 字段）                                                                                   | `unknown`                                         | 无                                         | `externalUrls` 与 `sourceWebsites` 存 `developer.link`                |
| DLSite  | 无（`''`）                        | `['circle']`                                                                                                                  | `amateur_group`                                   | 无                                         | 重新接入时才产生候选；链接同上                                        |

### 规范化

新增 `app/api/company/identity/normalize.ts`：

```ts
export const normalizeCompanyValue = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
```

仅此一个函数，`plan`、`apply`、回填脚本、清理脚本全部调用它。**不得**在任何调用点追加后缀剥离或模糊匹配。

## 上游对照

上游是 `KUN1007/kun-touchgal-next`，本节依据 `upstream/main @ 8d7f3562`（2026-08-30）。写下来是因为它同时**支持**和**限制**本计划。

|                      | 上游                                                                                                                          | 本仓库                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 四来源               | `app/api/patch/introduction/company/_gatherCompanies.ts`：并行抓取后按 `vndb → bangumi → steam → dlsite` 拼接，**无来源互斥** | 曾加「VNDB 优先、Bangumi 兜底」，本计划删除      |
| 自动路径同一性       | `ensureCompanies`（`processExternalData.ts:88`）只 `where: { name: { in: … } }`，**完全不查 alias**                           | 已按 `name` 或 `alias` 精确匹配                  |
| `patch_company.name` | `@unique`（`e2f160db`）                                                                                                       | 同                                               |
| 手动建会社           | 只校验提交的 `name` 撞 name/alias                                                                                             | 扩为 `[name, ...alias]` 全查                     |
| 计数                 | statement-level + transition table 触发器（`465f5db9`，提交信息误写 row-level），已删掉全部 16 处手工增减                     | 仍是应用层手工 `count + 1`                       |
| 重抓入口             | 游戏详情页任意外部 ID 可重抓                                                                                                  | 仍是旧的单来源 `company/vndb/route.ts`，**落后** |
| 脏数据               | `migration/backup/_createPatchCompanies.mjs`：`TRUNCATE` 两表后从 VNDB 全量重建                                               | 只能走合并计划                                   |

三条结论：

1. **删除来源互斥 = 回归上游**，不是新增本地策略。这是已定方向第一条的依据。
2. **不能照搬上游 `ensureCompanies`。** 上游只解决了「完全同名的四来源合并」，别名、全半角、大小写、外部身份一个都没解决，身份 resolver 仍然必要。
3. **上游的 TRUNCATE + VNDB 重建这个仓库用不了。** 本仓库在会社上叠了上游没有的东西：会社详情页手工编辑的 introduction / parent_brand / official_website（`app/api/company/service.ts` 比上游多约 400 行）、Bangumi / Steam / DLSite / 投稿来源的会社（VNDB 重建不出来）、`user_id` 归属。全量重建会把这些一起抹掉。

### 同步面控制

身份解析是纯本地自研，上游短期不会做，所以它是长期分叉点。为把冲突面压到最小：

- resolver 放在**会社业务域** `app/api/company/identity/`，不放 `app/api/edit/`。它同时服务 `/edit` 写入、投稿预览、审核批准与维护脚本，放在 edit 目录再让其它域反向引用只会扩大冲突面。
- 上游会频繁改动的抓取文件（`processExternalData.ts`、`fetchCompanies.ts`、`_gatherCompanies.ts`）与本地投稿文件（`publishCore.ts`）**各自只保留一个调用点**。
- 每次同步这几个文件必须逐 hunk 对账，不能信任自动合并——已有先例：上游 route 逻辑在合并中被静默丢弃过。

## Schema：两阶段发布

### 为什么需要身份表，而不只是一个 `normalized_name` 列

规范化**别名**匹配要求数据库里存在别名的规范化投影：`alias String[]` 里存的是原始写法，`ぱれっと` 与 `パレット` 只有规范化之后才相等，而对数组元素做规范化匹配需要表达式索引——已定方向「唯一约束由 Prisma schema 表达」一条禁止。所以别名必须落成行。这是**正确性**需求，不只是性能需求。

`(source, external_id)` 与 name/alias 行放同一张表会撞唯一约束（name/alias 行没有 external_id）。依赖 Postgres 的 `NULLS DISTINCT` 能绕开，但把正确性押在 NULL 语义上不值得。**拆成两张表**：

### Phase A：只加结构，不加约束

```prisma
model patch_company_external_id {
  id Int @id @default(autoincrement())

  company_id  Int
  company     patch_company @relation(fields: [company_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  source      String        @db.VarChar(32)
  external_id String        @db.VarChar(107)

  created DateTime @default(now())
  updated DateTime @updatedAt

  @@index([company_id])
  @@index([source, external_id]) // Phase B 收紧为 @@unique
}

model patch_company_name_identity {
  id Int @id @default(autoincrement())

  company_id       Int
  company          patch_company @relation(fields: [company_id], references: [id], onDelete: Cascade, onUpdate: NoAction)
  /** 'name' | 'alias' */
  kind             String        @db.VarChar(16)
  /** 'authoritative' | 'legacy'，取值含义见「别名来源必须可审计」 */
  origin           String        @db.VarChar(16)
  value            String        @db.VarChar(107)
  normalized_value String        @db.VarChar(107)
  confirmed_by_user_id Int?
  confirmed_by         user? @relation("patch_company_identity_confirmer", fields: [confirmed_by_user_id], references: [id], onDelete: SetNull, onUpdate: NoAction)

  created DateTime @default(now())
  updated DateTime @updatedAt

  @@index([company_id])
  @@index([confirmed_by_user_id])
  @@index([normalized_value])
  // 默认生成名超过 PostgreSQL 63 字节限制，必须固定这个短名。
  @@unique([company_id, kind, normalized_value], map: "patch_company_name_identity_company_kind_value_key")
}
```

`user` 模型同步增加 `confirmed_company_identities patch_company_name_identity[] @relation("patch_company_identity_confirmer")`。`confirmed_by_user_id` 只记录人工确认维护建议的管理员；普通外部抓取与历史回填保持 `null`。

同时给 `patch_company` 加：

```prisma
  normalized_name String? @db.VarChar(107) // Phase B 转为非空 @unique
```

`normalized_name` 在 Phase A 是 nullable 且只有普通索引，`patch_company_external_id.(source, external_id)` 是普通索引。`patch_company_name_identity` 的 `@@unique([company_id, kind, normalized_value])` 从 Phase A 就可以加——它只防**同一会社内部**重复，不会因历史脏数据失败（回填时按此键去重即可）。所以 Phase A 的契约是「不加**最终全局**唯一约束」（`normalized_name`、`(source, external_id)`），而不是「不含任何唯一约束」。

### Phase B：加最终约束（阶段 7）

- `patch_company.normalized_name` → `String @unique`（非空）
- `patch_company_external_id` → `@@unique([source, external_id])`
- `patch_company_name_identity.normalized_value` **保持普通索引**，别名跨会社重复是合法状态，歧义由 resolver 返回

## Resolver 契约

新增三个文件，全部落在会社业务域（理由见「同步面控制」）：

- `app/api/company/identity/types.ts` —— `CompanyCandidate` 与解析结果类型
- `app/api/company/identity/normalize.ts` —— 唯一的规范化函数
- `app/api/company/identity/resolver.ts` —— `plan` 与 `apply` 两个导出，共用同一个内部判定函数

```ts
export interface ResolvedCompany {
  candidates: CompanyCandidate[] // 收敛到同一 canonical 的全部候选
  companyId: number
  name: string
  matchedBy: 'external-id' | 'normalized-name' | 'normalized-alias' | 'batch'
}

export interface CompanyAmbiguity {
  candidate: CompanyCandidate
  matchedCompanies: { id: number; name: string }[]
  reason: 'multiple-companies' | 'conflicting-external-id'
}

export interface CompanyResolutionDiagnostic {
  candidate: CompanyCandidate
  matchedCompanies: { id: number; name: string }[]
  /** 权威 external ID 命中 A，名称却命中 B。关联 A、不补别名、不阻断批准。 */
  reason: 'external-id-name-conflict'
}

export interface CompanyResolutionPlan {
  resolvedExisting: ResolvedCompany[]
  wouldCreate: CompanyCandidate[][] // 每组是合并后将创建的一家会社
  ambiguities: CompanyAmbiguity[]
  diagnostics: CompanyResolutionDiagnostic[]
}

/** 只读。可在预览、preflight、清理脚本里调用。 */
export const planCompanyResolution: (
  db: Prisma.TransactionClient,
  candidates: CompanyCandidate[]
) => Promise<CompanyResolutionPlan>

/**
 * 批准事务内调用。内部重新跑一次 planCompanyResolution，
 * 因为预览之后数据库可能已经变化。
 * ambiguities 非空时抛 PatchSubmissionError，整体中止。
 */
export const applyCompanyResolution: (
  tx: Prisma.TransactionClient,
  patchId: number,
  candidates: CompanyCandidate[],
  authorId: number
) => Promise<{ companyIds: number[]; created: number }>
```

### 判定顺序

1. **可信 `(source, externalId)`** —— 查 `patch_company_external_id`。只有 `verified` 候选能走这一级；目前只有 VNDB producer ID 有 external ID。**命中即定案。**
2. **规范化主名** —— 查 `patch_company.normalized_name`。
3. **规范化 `authoritative` 别名** —— 查 `patch_company_name_identity`（`kind = 'alias'` 且 `origin = 'authoritative'`）。
4. **`legacy` 别名的精确匹配** —— 用**原始 `value` 做精确比较**（`value === candidate.name` 或候选别名之一），**不得**走 `normalized_value`。这一级只维持现网既有行为，不扩大命中范围，理由见「历史别名的匹配范围」。
5. **同批候选的 name/alias 交集** —— 规范化后有交集的候选合并成同一组，解决「四源三种写法都是新会社」。
6. 仍未匹配 → 创建新会社。

### 破平优先级

多个候选会社时按证据强度定案，不进人工队列：

1. 外部 ID 匹配 > 主名匹配 > 别名匹配；
2. 同强度仍有多家 → 真歧义，记入 `ambiguities`。

**external ID 命中 A、名称却命中 B 时**：本次作品关联到权威 external ID 对应的 **A**，但**绝不把 B 的主名写成 A 的别名**。它进入非阻断 `diagnostics`，管理员预览醒目展示；批准成功时把候选、A/B ID 与冲突类型写入既有管理员审核日志，形成可追溯的会社身份维护线索。它不进入 `ambiguities`，不会继续冻结投稿押金。

### 为什么不做推断收敛

曾经计划过两条自动开闸规则——「角色兼容 + VNDB/对方各只有一家 developer 就收为别名」和「官网域名匹配就收为别名」。**两条都已撤回。**

反例是**移植版**：这个领域里 Steam 版由本地化 / 移植商开发是常态，VNDB 一个 developer、Steam 一个 developer，两者根本不是同一家。1:1 规则会把移植商写成原开发商的别名。域名匹配同样有反例——发行商站点承载多个品牌（`dmm.co.jp` 之类），VNDB `extlinks` 与 Steam link 都指向它时域名相同，但不是同一实体；靠聚合域名黑名单来救，那本身就会腐烂。

而**错别名会自我繁殖**：一旦 `DMM GAMES` 成了 `ぱれっと` 的别名，之后每部 DMM GAMES 发行的作品都会解析到 ぱれっと，界面上看不出异常。相比之下多建一条重复会社是可见、可被合并工具修复的错误。**重复是便宜的错，错别名是贵的错。**

关键在于：**自动化收益不来自推断。** VNDB producer 自带 `name` + `original` + `aliases`，`ぱれっと` / `Palette` / `パレット` 通常本来就都在这份权威表里——三种写法收敛成一家靠的是权威数据。推断只覆盖 VNDB 都不认识的尾巴，而那正是最不确定的部分。

所以：匹配不上就**单独建一家会社**，不猜、不阻塞。推断只产出**维护建议**，人工确认后才升为 `authoritative`；**不写 `patch_company.alias`，不参与后续 resolver**。

### 角色的用途

角色**不参与同一性判定**：角色不同不能证明是不同会社，角色相同也不能证明是同一会社。撤掉推断收敛之后，角色只剩两个用途——维护建议里的排序依据（同角色的候选对更可能是同一家），以及溯源展示。它不再决定任何自动写入。

### 别名来源必须可审计

`patch_company_name_identity.origin` 只有两个取值：

- `authoritative` —— 来自 VNDB producer 的 `name` / `original` / `aliases`，人工填写，或**人工确认过的维护建议**；
- `legacy` —— Phase A 回填的历史 `alias` 数组，**无法证明**来自人工还是抓取。

**没有 `inferred` 状态。** 未确认的推断只存在于维护建议里，不进身份表；确认之后直接写 `authoritative`。为了保留「这条是从建议来的」这份审计信息，另加一列 `confirmed_by_user_id Int?`——非空即表示由人工确认的建议产生，可按批次回查。用 `origin` 表达它会让「是否可信」和「从哪来」两件事纠缠在一起。

### 历史别名的匹配范围

`legacy` 别名默认**只保持现有精确匹配行为**，不参与新增的规范化匹配。原因：NFKC + 大小写折叠会**扩大**历史脏别名的命中范围——一条挂错的别名原先只误匹配一个字符串，折叠之后可能误匹配一批。是否放开 `legacy` 参与规范化匹配，必须先在阶段 4 盘点过再单独决定。`legacy` **不得自动升级为 `authoritative`**。

### 双份事实来源的裁决

`patch_company.alias` 数组**保持为展示与搜索的真相源**（会社详情页、`app/api/company/service.ts:72` 的搜索、GIN 索引、上游代码都读它）。`patch_company_name_identity` 是**同事务维护的规范化派生投影**。任何写别名的地方（服务端抓取、人工编辑、合并）必须在同一事务里同时写两边，并有一条一致性校验（同计数 postflight 的思路）。

### 硬性规则

- 破平之后仍有多家：不取第一个、不新建、记入 `ambiguities`。
- 同一 `(source, externalId)` 在候选里指向不同现有会社：`conflicting-external-id`，记入 `ambiguities`。
- `apply` 创建会社时必须同时写 `normalized_name`、`patch_company_name_identity`（name + 每个 alias，带 `origin`）与 `patch_company_external_id`；命中已有会社时按需**补齐**缺失身份行，但**不覆盖**已有主名，且只有 `verified` 候选能补 external ID 与 `authoritative` 别名。
- 关系写入仍走 `addPatchCompanyRelations`（`companyRelationHelper.ts:9`）；计数由触发器负责（见计数一致性计划），`apply` 不改 `count`。

## 发布拓扑：为什么 resolver 最后才接管写入

三条约束叠起来只有一个可行顺序：

- **唯一约束不能早于历史清理。** 库里现存规范化同名的会社，先加约束会直接失败。
- **清理不能早于身份数据。** 没有 `normalized_name` 与身份表就盘点不出碰撞。
- **resolver 接管写入不能早于唯一约束。** Phase A 阶段 `normalized_name` 只是普通索引，两个并发批准可以同时查不到、同时创建两家规范化同名会社——正好重新制造本计划要消灭的重复。

所以：**结构 → 回填 → 清理 → 计数触发器 → 约束 → resolver 接管**。这个顺序是被正确性逼出来的，不是偏好。计数触发器批次与身份约束互相独立，唯一的硬约束是它必须早于 resolver 接管写入，所以放在约束之前、**不占用停写窗口**。

**代价要说清楚**：在阶段 1–7 期间旧写入路径仍然在跑，仍然会产生跨来源重复。因此阶段 7 加约束前必须重跑一次碰撞盘点——清理和加约束之间新落的重复会让 `CREATE UNIQUE INDEX` 失败。新增的量很小且很新，现场能处理。

**停写窗口的边界**：从**约束前最后一次碰撞盘点与清理**开始，一直覆盖到

1. 两个唯一约束安装完成并通过 postflight；
2. resolver flag 打开；
3. 创建、编辑、投稿批准三条路径的最小烟雾测试通过。

之后才恢复会社关系写入。**不能只覆盖 `CREATE UNIQUE INDEX`**——最后一次清理与建约束之间若仍可写入，新的规范化重名数据会让建约束失败，前面的清理白做。但**计数触发器批次（阶段 6）不包进这个窗口**：它自带 preflight / sync / postflight / rollback、自己的部署与演练，把会社关系写入冻结横跨整批意味着发布与编辑游戏停用数小时到跨天，而且阶段 6 一旦出问题就被困在一个持有中的冻结里。

**阶段 8 启用失败不必无限延长窗口**：约束已在、flag 关闭这种流量由阶段 4 部署的兼容层承接，可以先恢复写入再排查。只有兼容层本身也失败时才需要重新停写。

**另一条硬规则**：公司身份唯一冲突必须在**拥有事务的最外层业务入口**重试。PostgreSQL 命中唯一约束后，当前事务已经 aborted，不能在 `applyCompanyResolution` 内 catch 后继续查询。投稿批准要让本次审核事务完整回滚，再从 `claimPending`、发布、关系、结算与日志的事务起点整体重跑；`/edit` 也从拥有公司写入的事务起点重跑。只识别 `normalized_name` 与 `(source, external_id)` 两个目标约束，最多重试 3 次；`patch.unique_id`、游戏外部 ID 等其它 P2002 继续走各自业务错误，绝不能一概吞掉。重试后 resolver 读到并发胜者并关联。

**预览与批准必须同时切换。** resolver、事务重试和两条预览 / 写入分支要在 Phase B 前部署，feature flag 保持关闭；「预览显示 canonical 会社」与 `applyCompanyResolution` 只由这一个服务端运行时 flag 同时启用。Phase B 约束安装到 flag 打开之间必须保持会社关系写入暂停，不能让旧精确匹配路径撞上新约束。

**flag 关闭不等于回到不兼容的旧存储代码。** 约束启用之后，旧产品投影和来源选择可以恢复，但公司持久化必须保留一个常驻的约束兼容层：命中目标唯一约束时同样从外层事务重试，并按 `normalized_name` 重读胜者。否则全角、大小写等规范化同名输入会在旧 helper 中直接失败。这个兼容层不受 feature flag 控制。

## 分阶段实施

### 阶段 1：Phase A bootstrap 结构（只有迁移，没有代码）

生产不跑 `prisma db push`，所以结构必须先于任何读它的代码上线。

**顺序（不可颠倒）**

1. `migration/production-company-identity-bootstrap-preflight-<日期>.sql`：断言目标列 / 表 / 索引尚不存在**或已正确存在**（已正确存在不算失败，要可重跑）。
2. `migration/production-company-identity-bootstrap-sync-<日期>.sql`：
   - `patch_company.normalized_name` nullable + 普通索引；
   - `patch_company_external_id`、`patch_company_name_identity` 两张表（含 `origin`、`confirmed_by_user_id`）；
   - `patch_submission.company_candidates Json?`；
   - **只加普通索引**，以及 `patch_company_name_identity` 的公司内部去重约束 `@@unique([company_id, kind, normalized_value])`。
3. `migration/production-company-identity-bootstrap-postflight-<日期>.sql`：结构存在性与类型校验。
4. `prisma/schema/*.prisma` 同步 + `pnpm prisma:generate`。

**测试**

- `tests/unit/company-identity-bootstrap-migration.test.ts`：三个 SQL 的静态契约断言——幂等、可重跑、无破坏性 DDL、**不含最终全局唯一约束**（`normalized_name` 与 `(source, external_id)` 都还是普通索引），允许公司内部去重约束。

**完成判据**：结构就位，`pnpm prisma:deploy-safe` 零漂移；没有任何应用行为变化。

### 阶段 2：结构化采集与服务端快照

**改动**

- `app/api/edit/bangumi/route.ts`：`extractDevelopers` 改为返回 `{ name, sourceRole }[]`，保留 `item.key`；`developers: string[]` 保留以兼容旧前端。
- `app/api/edit/vndb/details/route.ts` 与 `utils/vndb`：透出 producer `id` / `type` / `lang` / `extlinks` / `aliases` / `original`。三个通用抓取路由**仍然只抓取、不写库**。
- **新增** `app/api/patch-submission/[id]/external-data/route.ts`：按 `source` 区分的 schema，校验登录、归属、可编辑，调用共享抓取函数，按「快照写入必须按来源串行合并」的短事务写 `company_candidates` 那一槽。
- `app/api/patch-submission/rateLimit.ts` 新增 `external-fetch`：每用户 30 次 / 10 分钟，Redis 故障 **fail-open**（不涉及押金或 S3 成本）。顺序固定为鉴权与归属校验 → 限频 → 外部网络 → 短事务保存；不能让未登录请求消耗他人额度，也不能在限频前访问外部服务。
- 客户端三个 Input 组件改为调用新 API；`*Developers` 四组字段保留，降级为非权威名称候选。
- **新增** `app/api/company/identity/types.ts`：候选、快照容器、信任包装与 zod schema（含每来源候选数、别名数、107 字符上限）。
- **新增** `app/api/patch-submission/payloadCodec.ts`：`decodePatchSubmissionPayload(payload)` 对数据库 JSON 重跑当前 payload schema，损坏则拒绝提交与批准。**不做版本分支**（候选已移出 payload），但 `submit.ts:237` 与 `review.ts:176` 的裸断言必须消失。
- **新增** `readVerifiedCompanyCandidates(submission)`：唯一能派生 `verified` 的入口，按槽比对 `lookupId`，失配整槽作废并记录诊断；`null` 与空数组区别对待；快照 JSON 解析失败同样作废并诊断。

**测试**

- `tests/unit/patch-submission-payload-codec.test.ts`：损坏 JSON 拒绝提交与批准。
- `tests/unit/patch-submission-external-data.test.ts`：非本人 / 非可编辑 / 已提交审核 → 拒绝；三来源并行保存互不覆盖；抓到零家写空快照；`lookupId` 随请求写入；鉴权与归属在限频前、限频在外部网络前；Redis 故障 fail-open。
- `tests/unit/company-candidate-trust.test.ts`：`lookupId` 失配整槽作废且产出诊断；`null` 与 `[]` 语义区分；坏 JSON 作废；客户端派生候选恒为 `unverified`；超限（候选数 / 别名数 / 107 字符）被拒。
- `tests/unit/api/bangumi.test.ts` 扩展：`发行` 与 `开发` 映射到不同 role，`制作` 落 `unknown`，`sourceRoles` 保留原始 key。

**完成判据**：候选只能由服务端写入；全仓库不再有 `as unknown as PatchSubmissionPayload`；发布行为不变。

### 阶段 3：身份回填与写入侧双写（语义不变）

**改动**

- **新增** `app/api/company/identity/normalize.ts`。
- **新增** `migration/backfillCompanyIdentities.ts`（`maintenance:companies:identity:dry` / `:apply`），幂等：写 `normalized_name`；`name` 写成 `authoritative` 身份行；历史 `alias` 全部写成 **`legacy`**；**本阶段不回填 external_id**。
- `app/api/edit/companyEnsureHelper.ts`：创建会社时一并写 `normalized_name` 与身份行。**匹配逻辑本阶段不动。**
- `app/api/company/service.ts`：`createCompany` / `rewriteCompany` 在**同一事务**里同步 `alias` 数组与身份行。

**测试**

- `tests/unit/company-normalize.test.ts`：NFKC（全半角）、大小写、连续空白；断言**不**剥离 `Co., Ltd.`。
- `tests/unit/company-identity-backfill.test.ts`：幂等；同会社内重复别名去重；跨会社共享别名不报错；历史 alias 一律 `legacy`。
- 扩展 `tests/unit/api/company-relation-helper.test.ts`：新建会社时身份行同时落库。

**完成判据**：`normalized_name` 无空值、每家会社的 name/alias 都有身份行；此后任何新建 / 改名 / 改别名都同步两边；行为仍不变。

### 阶段 4：resolver、切换分支与约束兼容层（部署但不启用）

**改动**

- **新增** `app/api/company/identity/resolver.ts`：`planCompanyResolution`、`applyCompanyResolution` 与内部判定。
- 提前实现投稿批准的**外层整事务重试**、`/edit` 公司写入事务重试、canonical 预览分支及管理员诊断，但全部由同一个服务端运行时 feature flag `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED` 控制；默认值为 `false`，未配置也必须关闭，不改变当前响应与写入选择。该变量不是 `NEXT_PUBLIC_*`，浏览器不得自行决定预览或写入分支。
- 给 flag 关闭时的旧公司持久化路径加入**不受 flag 控制**的 Phase B 约束兼容层：只处理两个目标唯一约束，外层重试后按 `normalized_name` 重读胜者；不启用跨来源 resolver，也不改变旧预览。

**测试**

- `tests/unit/company-resolver.test.ts`：六级判定各一例；同批三种写法收敛为一家；破平优先级；`legacy` 只走原始值精确匹配、不走规范化；命中多家 → `multiple-companies`；同一 external ID 指向不同会社 → `conflicting-external-id`；external ID 命中 A 而名称命中 B → 非阻断 `external-id-name-conflict` 且**不补别名**；角色不参与同一性判定。
- 事务重试测试：目标公司身份约束冲突会让整笔事务回滚并从入口重跑，第二次解析到胜者；重试上限为 3；其它 P2002 不重试；不得在已 aborted 的事务中查询。
- feature flag 测试：关闭时预览与来源选择保持旧行为，但约束兼容层仍生效；开启时预览与批准同时切到 resolver，不允许只切一边。

**完成判据**：resolver、切换分支和约束兼容层已部署并有测试；flag 默认关闭，用户可见行为不变。

### 阶段 5：生产盘点、历史清理与外部身份回填

**改动**

- 扩展 `scripts/cleanupDirtyCompanies.ts`（`maintenance:companies:dirty:dry` / `:apply`）：
  - 列出规范化主名碰撞、规范化 alias ↔ name 碰撞；
  - 借关联作品的 `patch.vndb_id` 重新抓取 producer ID 与权威别名，**回填 `patch_company_external_id`**，并把拿到权威依据的 `legacy` 别名升级为 `authoritative`（**没有依据的保持 `legacy`**）；
  - 扫描已发布投稿保留的服务端候选快照与正式会社关系，把 `external-id-name-conflict` 汇总进身份维护清单；批准日志负责逐笔审计，维护脚本负责让这类非阻断诊断可批量发现；
  - 只对证据唯一的项目自动生成 merge；多候选、共享别名、仅名称相似 → warning 交人工计划；
  - 复用现有 merge apply 迁移关系、合并 metadata、清缓存。
- 盘点 `legacy` 别名规模，据此单独决定是否放开它参与规范化匹配。

**完成判据**：碰撞清单清零或已人工裁决；`legacy` 匹配范围有明确结论。

### 阶段 6：计数触发器批次（不停写会社关系）

见 `docs/superpowers/plans/2026-08-30-tag-company-count-consistency.md`，整批在此完成，含它自己的 preflight / sync / postflight / rollback、应用代码部署与临时 PostgreSQL 演练。

它必须早于阶段 8——resolver 接管写入时，关系插入的计数语义必须只有一套。它与身份唯一约束**互相独立**，所以放在约束之前，并且**不占用阶段 7–8 的停写窗口**。该批次自己的写阻塞只有 sync 回填时的 `LOCK TABLE … IN SHARE MODE`，是分钟级且自限的。

### 阶段 7：Phase B 唯一约束（停写窗口从这里开始）

**改动**

- `migration/production-company-identity-constraint-preflight-<日期>.sql`，**阻断与告警分清**：
  - **阻断**：规范化主名冲突、`normalized_name` 缺失、`(source, external_id)` 冲突；
  - **仅告警**：跨会社共享别名——已定的合法状态，不要求清零。
- `migration/production-company-identity-constraint-sync-<日期>.sql`：补齐回填 → 加 NOT NULL → 加两个唯一索引，顺序不可颠倒。
- `…-constraint-postflight-<日期>.sql`。
- `prisma/schema/patch-company.prisma`：`normalized_name String @unique`、`patch_company_external_id` 的 `@@unique([source, external_id])`。
- **停写窗口从本阶段开始，跨到阶段 8 结束**：先暂停会社关系写入 → 重跑碰撞盘点（阶段 5 之后旧写入路径又跑了一段时间，会有新的碰撞）→ 现场处理 → 立刻加约束 → postflight。停写必须覆盖「最后一次清理」到「阶段 8 烟雾测试通过」的全程，边界理由见「发布拓扑」。计数触发器批次（阶段 6）**不在**这个窗口内。
- 走 `pnpm prisma:deploy-safe`，禁止 `prisma db push`；漂移守卫仍只允许 `patch_released_idx` 一个例外。

**测试**

- `tests/unit/company-identity-constraint-migration.test.ts`：三个 SQL 的静态契约断言（幂等、无破坏性 DDL、阻断项与告警项区分、约束名与顺序）。

**完成判据**：约束生效；`prisma:deploy-safe` 零漂移；postflight 的阻断项为零（合法共享别名 warning 可以保留）；**继续保持停写**，进入阶段 8。

### 阶段 8：resolver 接管写入 + 预览切换（同一 feature flag）

**改动**

- 将阶段 4 已部署的单一服务端 feature flag `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED` 从 `false` 切到 `true` 并重启运行进程：预览与 `applyCompanyResolution` 同时切换。`apply` 在新事务中重跑 `planCompanyResolution`（预览之后数据库可能已变），阻断型歧义非空则抛 `PatchSubmissionError` 整体中止；目标唯一冲突由外层业务事务完整回滚并重试，不能在 aborted 事务中重读。
- `app/api/patch-submission/publishCore.ts:131-149`：消费 `readVerifiedCompanyCandidates` 的结果并调用 `applyCompanyResolution`，删除「四源拼接 + `alias: []`」写法。
- `app/api/edit/processExternalData.ts`：**删除** `collectPrimaryDeveloperNames` 的来源互斥与 `:210-216` 的清空（**回归上游**，上游 `_gatherCompanies.ts` 四来源并行无互斥）；四来源统一转候选交给 resolver；`ensurePatchCompaniesFromVNDB` 保留服务端回查能力，输出改为候选。
- `app/api/patch-submission/publishPreview.ts`：`buildPatchSubmissionPublishPreview` 调用 `planCompanyResolution`——`companyNames` 改为**解析后的 canonical 名称**；新增仅管理员可见的 `companyDiagnostics`（候选 → 命中的 company ID/名称、`matchedBy`、阻断型 `ambiguities` 与非阻断 `diagnostics`），由 `includeDiagnostics` 控制，只有 `app/api/admin/patch-submission/service.ts:200` 传 true。
- `components/submission/PatchSubmissionPreviewView.tsx:154`：有歧义时对普通用户显示中性提示「会社信息需管理员确认」。
- `components/admin/submission/AdminSubmissionDetail.tsx`：渲染 `companyDiagnostics`，歧义项醒目标出并说明「需先做会社身份维护」。
- 中止文案**仅面向管理员**，列出来源候选、命中的 company ID 与名称。
- **改文档**：`docs/modules/api-services.md:220` 那条「公司来源优先级是 VNDB > Bangumi」必须删除或改写——它描述的是已删逻辑，留着会让下一个人把分叉当规则重新实现。

**测试**

- `tests/unit/patch-submission-review.test.ts`：候选收敛后只创建一家；阻断型歧义时**整个批准回滚**（patch、gallery、tag、押金结算都不落库）；external-ID/name 冲突关联 A、记录管理员日志且不补别名；目标唯一冲突让整笔审核事务回滚后重跑并解析到既有行。
- `tests/unit/patch-submission-publish-preview.test.ts`：预览显示 canonical 名称；`includeDiagnostics` 为 false 时不泄漏诊断。
- create 路径测试：Bangumi 独有发行商**不再丢失**。

- 打开 flag 后在停写状态下跑**最小烟雾测试**：`/edit/create` 创建一条、`/edit` 重写一条、投稿批准一条，各自确认会社关系正确、预览与实际发布一致、无唯一冲突残留。
- 烟雾测试通过后才**恢复会社关系写入**，停写窗口在此结束。
- 若启用失败：把 flag 切回 `false`、**恢复写入**再排查——约束已在 / flag 关闭这种流量由阶段 4 的兼容层承接，不需要无限延长窗口。只有兼容层本身也失败时才重新停写。

**完成判据**：预览与批准同源；新数据不再产生跨来源重复；烟雾测试通过并已恢复写入，阶段 7–8 的停写窗口结束。

### 阶段 9：低优先级收尾

- `app/api/edit/fetchCompanies.ts:30`：`introduction` 改用 `producer.description ?? ''`（`description` 已在请求字段里，`:53`）。
- `app/api/edit/dlsite.ts:58`：改走共享 resolver，去掉只查 `name` 的写法。
- DLSite 运行时接入（`DLSiteInput` 挂载 + 回填 circle name / link）如产品仍需要。

## 文档同步交付物

不是可选项；在对应阶段完成，但与代码、迁移保持**独立文档提交**：

- `docs/modules/api-services.md` —— 会社可信快照与写入入口、resolver 判定顺序、来源互斥规则的删除（阶段 2 与阶段 8）；
- `docs/modules/operations.md` —— 六个身份迁移 SQL、服务端 feature flag 与维护窗口切换顺序（阶段 1、阶段 4 与阶段 7–8）；
- `.env.example` —— 增加默认关闭的 `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED=false`，只作为服务端运行时开关；
- `skills/otoame-data-cache/SKILL.md` —— 身份表与规范化列的约束语义（阶段 7）。

## 为什么不把 LLM 放进批准路径

跨语言别名（`ぱれっと` = `Palette` = `パレット`）正是 NFKC 解决不了、而 LLM 擅长的一类判断，所以「用 LLM 检测会社/标签同名」方向上是对的。但它只能放在**离线维护工具**里，不能进写入路径：

- 批准**禁止访问外网**（这是已定架构，见「Architecture」），LLM 调用直接违反；
- 结果不可复现：同一份投稿两次批准可能得到不同会社归并，审核结论就不可解释了；
- 多一个网络失败模式挡在批准前面，而批准是全有或全无的事务；
- 候选对空间本来是有界的（只有规范化碰撞或共现的对），批量离线跑代价很低，没必要放到请求路径上换取实时性。

所以定位是：**resolver 用确定性规则处理能证明的部分；LLM 在维护工具里对剩下的部分排序，产出人工复核清单。** 它提高的是人工队列的效率，不改变任何自动写入的判定。

## 未决事项

1. **`legacy` 别名是否放开参与规范化匹配。** 必须先在阶段 5 盘点规模与脏度。放开会扩大历史脏别名的命中范围，不放开则历史数据的收敛能力受限。
2. **是否引入 LLM 辅助合并建议（离线）。** 只放在维护工具的 dry-run 里：把候选对（名称、别名、语言、共现作品、来源链接）交给它排序出「可能是同一实体」的清单供人工复核，**永不参与写入路径**，理由见「为什么不把 LLM 放进批准路径」。这一项对**没有 VNDB ID 的历史条目**价值最大——那批拿不到权威证据，是人工队列的主体。标签别名同构，同一套工具可复用。
3. **歧义期间的押金。** 已定方向「系统自动消歧」把阻塞压到罕见矛盾，所以这不再是常态问题，但逃生通道仍需存在：谁收到通知、多久内处理、超期是否驳回返还。规模明确后再定。

## 验证与风险

- 每个阶段结束跑 `pnpm typecheck` + `pnpm vitest run`；`pnpm lint` 因 Next 兼容问题跳过。
- **用户可见变化集中在两处，不是一处。** 阶段 1–5 基本无用户可见变化（阶段 4 会部署约束兼容层，但在阶段 7 的最终唯一约束安装之前，它的冲突恢复分支通常不会被触发）；**阶段 6 会修正计数展示**——回填一落地，标签与会社的作品数即刻变化，而这两个列表按 `count desc` 排序，热度榜可能明显重排；**阶段 8 正式切换会社身份解析规则**。前五个阶段可以逐个独立上线。
- **阶段 7–8 是一个连续停写窗口**：从约束前最后一次碰撞盘点开始，覆盖到约束安装、postflight、flag 打开与烟雾测试通过为止。计数触发器批次（阶段 6）不在窗口内。唯一的产品行为切换点是阶段 8，预览与批准接管由同一个 feature flag 同时生效。
- 阶段 8 出问题可以关 flag 并**恢复写入**再排查：预览与来源选择退回旧产品行为，公司持久化仍走阶段 4 部署的兼容层，不能回到不认识 `normalized_name` 唯一约束的原始 helper。身份表、约束和计数触发器无需回滚；只有兼容层本身也失败时才需要重新停写。
- **原先最大的风险已由设计消除**：候选移出 payload 之后没有版本切换，不存在「新代码漏读旧格式、pending 投稿静默发布成零会社」这类问题。仍需测试兜住的是快照的三条规则——`lookupId` 失配整槽作废、三来源并行保存互不覆盖、坏 JSON 作废并诊断。
- **阶段 1–7 期间旧写入路径仍在制造重复**，这是排序换来的代价。因此阶段 7 加约束前必须在停写状态下先重跑碰撞盘点，见「发布拓扑」。
- 阶段 8 会同时改变读者看到的会社条数，而且**两个方向相反**：跨来源收敛让条数减少，删除来源互斥让 Bangumi 独有的发行商回归、条数增加。净效果逐条不同，所以「会社总数」不能当成功指标——要分开统计「合并掉的行数」与「新捕获的关系数」。
- 排期前需要先量五个数：规范化后主名碰撞组数、跨会社共享别名组数、没有 VNDB ID 的条目占比（决定阶段 5 人工队列的规模）、`legacy` 别名总量、`count = 0` 的空会社数量。本计划全部基于读码，未查生产库。
