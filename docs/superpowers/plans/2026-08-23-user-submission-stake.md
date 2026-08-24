# 用户投稿条目与云端草稿实施计划

**Goal:** 让 `role = 1` 普通用户与创作者提交新游戏条目。草稿存于云端可跨设备续编，**创建草稿时**冻结萌萌点押金，通过后转为正式条目并返还押金加奖励，驳回返还，违规罚没。

**Architecture:** **独立投稿域。** 草稿与待审投稿存入新的 `patch_submission`，审核通过前**绝不写入 `patch`**。只复用现有表单字段、图片处理与只读展示组件；投稿 API、所有权校验与审核权限独立实现。

**素材不搬动。** 草稿素材用服务端生成的不可猜 key 写到发布后继续使用的最终位置，批准时不复制任何对象，**整个批准是一个纯数据库短事务**。它不是私有存储：知道链接的人仍可访问，产品文案必须如实说明（见 Stage 0.1）。

**审核并发守卫**：最终事务内一次条件式 `updateMany … where: { status: 'pending' }`。这是唯一的并发保护，不得省略。

**Tech Stack:** Next.js 15.5.18 App Router、TypeScript、Prisma 7.8 / PostgreSQL 18、Redis、AWS SDK v3（S3 兼容自定义 endpoint）、Zustand、HeroUI v2、Vitest 4。

## 已定方向

以下已由 owner 决策，不再讨论：

- **独立 `patch_submission` 域**，不使用 `patch.status` 承载投稿状态。
- **押金与名额**：普通用户每条活动草稿暂扣 10 点、最多 5 条；创作者暂扣 1 点、最多 10 条。发布奖励 3 点。
- **金额按创建时角色固定**，升降角色不重新结算。降级后可继续处理既有草稿，但超过新上限不能再新建。
- **保持 `/edit/create` 与 `/api/edit` 权限不变**：`POST /api/edit` 创建为 role ≥ 4（`app/api/edit/route.ts:46`），`PUT /api/edit` 编辑为 role ≥ 3（`app/api/edit/route.ts:86`）。两者数值不同，不要笼统写成同一个门槛。普通用户不得借投稿获得管理员编辑权限。
- **外部数据用提交快照冻结**，批准时不访问外网。
- **未审素材不做真正私有**（2026-08-23 决定）：用服务端生成的不可猜 key、不可索引，批准时不搬动对象；文案如实说明知道链接的人仍可访问，**不得宣称「私有」**。连带确定：不引入 `publishing` 状态、fencing token、`CopyObject` 与复制恢复。
- **审核权限**：role ≥ 3 可审，禁止自审；超级管理员可显式 override 并写醒目 `admin_log`（避免晋升前遗留投稿无人可处理）。
- **首版不自动过期**，不自动释放长期待审押金。
- **首版不额外增加自动封禁规则**。余额允许为负 + `reserveMoemoepoint` 的 `requiredAvailable` 原子校验，使反复被罚没的用户自动失去投稿能力。

## 状态机

| 状态 | 可编辑 | 占名额/持押金 | 可执行操作 | 结算 |
| --- | --- | --- | --- | --- |
| `draft` 编辑中 | 是 | 是 | 预览、提交、删除 | 删除 → release |
| `pending` 审核中 | 否 | 是 | 查看、撤回 | 撤回不结算（押金随草稿继续持有） |
| `changes_requested` 需修改 | 是 | 是 | 查看原因、修改重投、删除 | 删除 → release |
| `rejected` 已驳回 | 否 | 否 | 查看原因、**从个人列表隐藏** | **转入时一次性 release（返还，不罚没）** |
| `published` 已发布 | 否 | 否 | 跳转正式条目、从个人列表隐藏 | 转入时一次性 release + 奖励 3 点 |
| `violation` 违规关闭 | 否 | 否 | 查看原因、**从个人列表隐藏** | **转入时一次性 forfeit（确认扣除）** |
| `deleted` 用户删除 | 否 | 否 | 无 | release（**仅从活动状态删除时**） |

- 活动草稿 = `draft` + `pending` + `changes_requested`，只有这些占名额并持有押金。
- `rejected` 是本轮新增的终态，用于**重复条目、超出收录范围、诚实但无法发布**。它不等同于 `changes_requested`，也不罚没。缺这个状态会让管理员只剩「无限期挂着」或「不公平罚没」两个选择。
- **`rejected` 必须有人工入口。** 「超出收录范围」是人工判断，不能只由 Stage 7.6 的唯一性冲突自动到达。缺人工 `reject` 会让审核流程回到「挂着或罚没」二选一，正是本状态要解决的问题。见 Stage 7.7、8.2、8.6。
- **批准时若发现另一用户已抢先发布同一条目，自动转入 `rejected` 并返还**，不得继续留在 `pending`。
- `changes_requested` 与 `violation` 必须填写不超过 1007 字原因。`violation` 后清除正文与素材，仅保留最小审计记录（投稿 ID、用户、标题、暂扣金额、原因、审核人、时间）。

### 结算边界（每笔 reservation 只结算一次，且只在状态转入时）

`releaseMoemoepoint` / `forfeitMoemoepoint` **只在进入终态的那一次转换里调用**，之后任何用户操作都不再触碰结算原语：

- **活动状态**（`draft` / `changes_requested`）删除：release 后进入 `deleted`。
- **终态**（`rejected` / `published` / `violation`）：用户只能**从个人列表隐藏/归档记录**，不调用任何结算原语。表格里终态一律写「从个人列表隐藏」，不写「删除」。
- 原因在 `app/api/moemoepoint/service.ts:370-381`：状态非 `pending` 时，只有 `status` 与 `settlement_idempotency_key` **同时**匹配才返回 `applied: false`，否则抛 `MoemoepointReservationSettledError`。所以「整条投稿共用一个结算幂等键」**解决不了**终态删除——`violation` 已是 `forfeited`，之后用同一个 key 调 release，`status` 不匹配照样抛错。唯一正确的解法是终态不再结算。

## 当前状态（2026-08-24）

- **Phase 1 已完成并提交**：`user_moemoepoint_ledger`、`user_moemoepoint_reservation`、`reserveMoemoepoint` / `releaseMoemoepoint` / `forfeitMoemoepoint`。**零调用方是有意的，不要当死代码清理。**
- **Stage 1 已完成并提交**：马赛克泄露修复、上传链路硬化按主题切分提交、浏览器验证落地、请求体上限实测定位。
- **投稿功能实现零行。** 下一步是 Stage 3 的 schema。

## 排序原则

1. **`components/kun/cropper/KunImageCropper.tsx:52-56` 的马赛克打码泄露是现存 bug，不等投稿功能。** 它今天就让未打码原图成为 `banner-full.avif`。列为 Stage 1 阻塞项。
2. **新投稿端点不得照抄 `app/api/edit/route.ts` 的「先解析后鉴权」顺序。** POST（:38）与 PUT（:78）都在 `verifyHeaderCookie`（:42 / :82）之前调用 `kunParseFormData`。投稿端点面向公开，必须先鉴权后解析。
3. **本功能自身的缺口里，人工 `reject` 排第一。** 它是唯一会阻断完整审核流程的功能缺口：`rejected` 状态已定义但没有人工入口，管理员遇到「重复 / 超出收录范围」时无路可走。其余问题（并发顺序、限频冲突、措辞矛盾）都是可局部修复的实现细节，不改变阶段划分。
4. **批准链路是一个纯数据库短事务，不要重新引入复制架构。** 素材在起草阶段已经传完，批准时没有任何对象存储操作。唯一的并发保护是最终事务内的条件式 `updateMany … where: { status: 'pending' }`，**这道守卫不能省**——两名管理员同时点批准时靠它保证只产生一个 `patch`。
5. **旧计划的 Stage 2/3/4 已废弃**（见文末）。新投稿路径不开放 `/api/edit` 与 `/api/edit/gallery`，所以创建页那批缺陷不再是投稿上线前置——但其中的幂等、鉴权顺序、马赛克与无障碍规则必须重新落到新端点和共享组件上。
6. 文档 / skill 同步始终单独成一笔提交（`docs/modules/quality.md`）。

## Global Constraints

- 不改动 `user_moemoepoint_ledger` / `user_moemoepoint_reservation` 表结构。
- 不放开游戏编辑权限，`POST /api/edit` 保持 role ≥ 4、`PUT /api/edit` 保持 role ≥ 3。
- 不引入通用审核队列框架。
- 不做投稿贡献榜。
- 萌萌点统一调用现有三原语，稳定幂等键，`reference_type: 'patch_submission'`。
- 所有投稿响应 `private, no-store`；状态变更保留 CSRF 校验。
- 所有影响当前用户押金的接口返回完整萌萌点三态并立即更新 `userStore`。
- 生产 schema 变更走 `migration/` 既有 preflight/sync 成对模式，**不在生产跑 `prisma db push`**。
- 约定式提交；文档不与业务代码、测试或迁移混在同一 commit。
- 部署顺序：先上 schema 与后端，再开放入口。

---

## Stage 0：素材存储契约与剩余数值决策

### 0.1 素材存储契约（已定，以下每条都是硬性要求）

素材使用服务端生成的不可猜 key，发布后正式条目继续引用同一对象。**这不是私有存储**，产品文案只能说「未公开、不可索引」，并明确知道链接的人仍可访问。随之必须落实：

- [ ] 投稿 key **偏离现有 `patch/<id>/...` canonical 路径**，明确记录为运维契约（Stage 12）。
- [ ] **已发布素材的所有权转移**：孤儿清理命令必须永久排除已被正式条目引用的对象；隐藏或删除投稿记录**不得**级联删除 `patch` 仍在引用的对象（Stage 10.1）。
- [ ] **封面不是一个对象而是最多三个变体**（`banner.avif` / `banner-mini.avif` / `banner-full.avif`）。`app/api/utils/purgeCache.ts:3-14` 只按 patch id 推导 canonical URL，对投稿 key 是空推。**首次换封面时必须额外清理并 purge 旧投稿 URL**，否则 CDN 上留着旧封面且无人清理。
- [ ] **未审素材下架必须连带 CDN**：素材公开可取，被预览过就可能进 Cloudflare。`violation` / `reject` / 用户删除时删对象不够，必须 purge 封面三变体与每张图主图、缩略图的实际 URL，失败由清理命令重试（Stage 5.4、10.1）。
- [ ] `scripts/galleryThumbnailBackfill.ts:442` 的 `isCanonicalGalleryOriginalKey` 会**显式跳过**非 canonical key。脚本、其测试与 canonical 路径文档都要相应调整。

画廊删除本身安全，无需改动：`app/api/edit/update.ts:170-179` 用 `extractS3Key(img.url)` 从库中存的 URL 反解，不依赖 canonical 路径。

### 0.2 每用户活动草稿总字节上限数值（**唯一未定数值**）

- [ ] 草稿条数上限**不能**替代容量上限：20 张 × 8 MB × 5 条 ≈ 单用户 800 MB，且首版不自动过期。

---

## Stage 1：阻塞性现存修复与工作区收尾

**Stage 1 已完成（2026-08-24）。** 1.1 的四项修复、1.2 的工作区切分提交、1.3 的验证与 1.4 的定位均已落地；1.3 的四项手测已改为可重跑的浏览器验证（`tests/e2e/edit-upload-guards.e2e.ts`，5/5 通过）。

### 1.1 马赛克打码泄露（已修复）

- [x] `KunImageCropper.tsx` 的 `handleMosaicComplete` 现在把马赛克结果同时作为原图发出，未打码原图不再成为 `banner-full.avif`。
- [x] 提交处已加原图守卫：`newBanner` 有值而原图为空时拒绝提交并提示重新裁剪。`KunImageCropperModal` 的原图回调改为 await，消除连续换图时「后到覆盖先到」的竞态；`utils/resizeImage.ts` 压缩后仍超 4 MB 时依旧 reject，但现在会被守卫拦住而非静默放过。
- [x] `RewritePatch.tsx` 在 PUT 成功后即清封面，只留失败截图，「重试失败截图」不再重编码封面、重清 CDN 缓存、重跑破坏性画廊对账。
- [x] `patchUpdateSchema` 的 `banner` 与 `bannerOriginal` 从 `z.any()` 改为 `imageFileSchema.optional()`。
- [ ] **遗留（创建页对称缺口，不阻塞投稿）**：创建页同样可能出现「封面有、原图无」，此时 `uploadPatchBanner` 跳过 `banner-full.avif`，详情页灯箱取不到图。新建条目没有旧 `banner-full` 可泄，所以是质量问题而非内容泄露；守卫要加在 `components/edit/create/PublishButton.tsx`。

### 1.2 切分提交现有工作区（已完成）

已按主题提交。「提交异常可见」「离页保护」「封面原图 + 1.1 修复」三组通过 `RewritePatch.tsx` 共享状态互相牵连，而本环境不支持 hunk 级交互暂存（`git add -p`），因此合为一笔提交，提交信息中已说明。

### 1.3 验证（已从手测转为浏览器自动化）

`tests/e2e/edit-upload-guards.e2e.ts`，真实 Chrome 无头运行，5/5 通过：

- [x] 断网点提交 → 错误 toast、按钮恢复可点（创建页与重写页各一次）
- [x] 拖入超过 8 MB 的图 → 拖入瞬间提示，不进队列
- [x] 有未上传截图时点站内链接 → 弹确认框；F5 → 浏览器原生 `beforeunload` 提示
- [ ] 已知不覆盖：浏览器前进/后退（`popstate` 不可取消）、程序化 `router.push`

运行方式与两个环境前提（独立测试库、自签会话绕过人机验证）写在该文件头部注释里。两处踩过的坑值得留下：dev 模式下创建页懒加载 Codemirror chunk，必须等加载完成再断网，否则断的是 hydration 而不是提交；`beforeunload` 需要真实用户手势，合成的 drop 事件不算。

### 1.4 请求体上限所在层（已实测定位，2026-08-24）

**上限在 Route Handler 的 `formData()`，不在 middleware 缓冲。** 计划前一版的假设是错的。

- 实测方法：带合法 CSRF 头与管理员 cookie，向 `/api/edit/gallery`（**在** `middleware.ts:13` 的 matcher 覆盖范围内）POST 递增体积的 multipart。
- 结果：10,000,000 B 通过（进入图片校验后按内容失败），**10,485,760 B（10 MiB）起 `formData()` 抛错**。抛错后返回的是 Stage 1.1 新加的可读文案，说明请求**确实到达了 Route Handler**，middleware 没有拦下它。
- 因此旧结论「Next 15.5.18 的 Route Handler `formData()` 没有上限」也不成立：存在 10 MiB 的实际上限。
- 附带发现：matcher 覆盖的路由在 middleware 用 CSRF 403 拒绝前，客户端仍会把整个 body 传完（18 MB 全传）；而被排除的 `/api/admin/stickers/import` 只传约 1.3 MB 就被 handler 提前拒绝。
- 注意 `validations/file.ts:6` 的 `MAX_IMAGE_SIZE_BYTES` 正好是 10 MiB，与失败阈值重合——贴着 schema 上限的文件会在校验之前就解析失败。真正起作用的是客户端 8 MB 上限（`constants/galgame.ts` 的 `GALLERY_IMAGE_MAX_SIZE_MB`）。

---

## Stage 2：新投稿端点的结构性规范

本阶段产出的是**所有投稿端点必须遵守的规范**，不是单个功能。

- [ ] **2.1 鉴权严格先于解析。** 顺序固定为：严格参数校验 → 登录 → 角色 → 所有权 → CSRF → 上传入口限频 → 可信的网关/流式 body 上限 → **最后**才 `formData()`。`imageFileSchema` 只能校验解析后的文件，**保护不了解析阶段的内存**，不能用它替代前面几步。
- [ ] **2.2 大体积上传端点从 middleware matcher 排除**，并在 handler 内自行完成 CSRF、登录态与角色校验（照 `app/api/admin/stickers/import/route.ts` 的既有做法）。**理由已按 Stage 1.4 的实测修正**：排除不是为了避免 500（上限在 handler 的 `formData()`，排除与否都一样），而是为了让 handler 能在读完整个 body 前就拒绝——matcher 内的路由即使被 middleware 403，客户端仍已把整个 body 传完。这是带宽与滥用成本问题，不是功能问题。
- [ ] **2.3 `formData()` 必须包 try/catch**（**这才是防 500 的功能要求**），超限或截断返回用户可见字符串而非 500（照 `app/api/admin/stickers/import/route.ts:45-50`，以及 Stage 1.1 已落地的 `app/api/edit/gallery/route.ts`）。单个 multipart body 的硬上限是 10 MiB。
- [ ] **2.4 上传字段一律 `imageFileSchema`**，不得出现新的 `z.any()`。
- [ ] **2.5 复用现有图片处理规则**：格式、尺寸、压缩、动态图片、水印，含 Stage 1.2 新增的 8 MB 客户端上限（`utils/resizeImage.ts` 的 `checkImageValid`）。

---

## Stage 3：`patch_submission` schema 与迁移

- [ ] **3.1 主表 `patch_submission`**：版本化表单 payload（含 payload schema version）、可搜索身份字段（标题、VNDB / Bangumi / Steam / Release / DLsite ID）、状态、乐观锁 `revision`、创建时角色、暂扣金额、reservation 关联、审核信息（审核人、原因、时间）、正式 `patch` 关联、各阶段时间戳、终态的用户隐藏标记。
- [ ] **3.2 `patch_submission_gallery`**：含客户端稳定 `client_asset_id`，建 `@@unique([submission_id, client_asset_id])`，以及 Stage 5.1 的 `uploading` / `ready` / `failed` 上传状态、文件指纹、状态时间戳（用于超时接管）与**声明字节数**（`uploading` 阶段就要占用容量预留）。封面保存主图、缩略图与可选原图 key。
- [ ] **3.3 索引与 CHECK**：活动草稿查询、审核队列（按最早提交优先）、标题/用户/外部 ID 搜索、状态取值 CHECK。
- [ ] **3.4 `patch.status` 保留但补注释**，说明它当前**不承载投稿状态**，避免以后再次误启用。
- [ ] **3.5 外部数据只存规范化投稿 payload + schema version + provenance（来源与抓取时间）**。**不存完整原始响应体**——那是体积负担；但 provenance 必须保留，它是管理员判断快照新鲜度的唯一依据（Stage 6.3 批准时不访问外网）。
- [ ] **3.6 补 `patch.vndb_relation_id` 的全局唯一性**（非空时唯一）。当前 `prisma/schema/patch.prisma:48` 只有 `@@unique([vndb_id, vndb_relation_id])`：`vndb_id` 为 NULL 时该组合在 Postgres 下形同不存在，`vndb_id` 不同时也不冲突，**所以 Release ID 今天没有任何数据库级唯一性**，`app/api/edit/create.ts:69-79` 的应用层预检是有竞态的。Stage 6.4 声称「唯一约束是最终防线」必须靠它才成立（`bangumi_id` 与 `dlsite_code` 已有 `@unique`，无需补）。

  **本项留在本计划内，作为投稿 schema 之前的独立前置提交**——它是 6.4 成立的直接前提，且必须同时覆盖共享直发路径，不拆到别的计划。三项验收：

  - **preflight 按 `lower(trim(vndb_relation_id))` 盘点冲突。发现冲突必须停止并人工处理，不得自动合并。**
  - **唯一性必须大小写无关**：用函数唯一索引，或「规范化 CHECK + 普通唯一索引」。**不能只依赖应用层转小写。**
  - **扩展 P2002 错误映射。** `app/api/edit/uniqueExternalIds.ts:75-96` 目前只识别 `bangumi_id`（`:60` 的预检数组同样只有 `bangumiId`），命中新的 Release ID 约束会一路落到 `app/api/edit/create.ts:197` 的 `throw error`，变成 500。直发创建/编辑要返回用户可见的重复提示；投稿批准命中则按 Stage 7.5 第二类转 `rejected` 并返还。`dlsite_code` 虽已有 `@unique` 但同样没映射，所以这里改成表驱动，而不是再加一条 `if` 分支。
- [ ] **3.6a 同时修掉写入端的规范化不一致，否则唯一约束仍会被绕过。** `app/api/edit/create.ts:70` 查重时用 `trim().toLowerCase()`，但 `:124` 与 `app/api/edit/update.ts:94` **存的是未规范化的原值**，于是 `R123` 与 `r123` 既躲过预检、也躲过普通唯一索引。写入端必须统一存规范化值（新投稿链路与两条既有路径同改），存量数据在 3.6 的 preflight 里一并归一。这与 3.6 的数据库级大小写无关唯一性是两半，缺一不可。
- [ ] **3.7 生产 preflight/sync SQL 成对提交**，并锁定迁移契约。

---

## Stage 4：草稿 CRUD 与云端自动保存

- [ ] **4.1 创建草稿**：先显示确认说明（金额、名额、规则链接），再在**同一个显式 ReadCommitted 事务**中按 4.6 的固定顺序创建草稿并 `reserveMoemoepoint`。金额与上限取当前角色。
- [ ] **4.2 名额与容量校验**：活动草稿条数上限，加 Stage 0.2 的每用户总字节上限。两项校验都必须在 4.6 的用户行锁之后进行。
- [ ] **4.3 余额不足的空状态**：直接展示签到入口与萌萌点规则链接，不要让用户面对一个看起来坏掉的按钮。
- [ ] **4.4 防抖云端自动保存**：可见的保存状态、`revision` 冲突提示、提交前等待最新保存完成。自动保存失败时必须有明确表现，不得静默。
- [ ] **4.5 `pending` 期间锁定编辑。**
- [ ] **4.6 并发建草稿的固定顺序（显式用户锁 + 创建幂等）**

  在显式 ReadCommitted 事务内，顺序固定为：

  1. **`SELECT … FOR UPDATE` 锁定该用户行。**
  2. **处理创建幂等**：客户端请求 ID 命中已有投稿时**直接返回该投稿**，不再计数、不再 reserve、不再创建。
  3. 确认不是重试后，检查名额与容量上限。
  4. `reserveMoemoepoint`。
  5. 创建投稿行。

  **不能简化成「`reserveMoemoepoint` 在前所以一定拿到用户行锁」。** `app/api/moemoepoint/service.ts:305-348` 的余额守卫本身是原子的（`:173-183` 是条件式 raw `UPDATE "user" … WHERE id = ? AND (moemoepoint - moemoepoint_reserved) >= ?`，会取用户行写锁并在并发事务提交后重新求值），但 `:309-321` 命中已有幂等键时**直接 return，根本不执行后面的用户行 `UPDATE`**——重试路径不取锁。若实现仍选择「reserve 在前」的变体，必须同时规定：**`applied === false` 时立即返回既有投稿，禁止继续 count/create**。

  名额检查与 reserve 放在同一事务里是必要条件但不充分：`count` 在锁之前执行时，两个事务都可能读到 4 条各自创建，越过上限。用户行锁 + ReadCommitted 下的重新计数才能看到并发事务已提交的投稿行。**固定 slot 唯一约束不需要**（对越界 1 条草稿这个后果过重，且该草稿自身也持有押金，不漏钱）。

---

## Stage 5：草稿素材

- [ ] **5.1 幂等上传 + 显式上传状态**：客户端传稳定 `client_asset_id`；重试返回既有成功结果；同一 ID 对应不同文件指纹时**拒绝**，不得再建一行。这解决与 `app/api/edit/gallery/route.ts` 相同的「关页/超时后重复上传」窗口。

  唯一约束**不足以**处理「数据库行已创建、S3 上传失败」：至少需要 `uploading` / `ready` / `failed` 三态。占用规则必须是：

  - **`uploading` 与 `ready` 都占用图片 slot 与预留字节。** 只让 `ready` 计数会被并发上传越过上限——多个请求各自创建 `uploading` 行，全部完成后得到超过 20 张的 `ready`。
  - **`failed` 释放占用**，并允许同一 `client_asset_id` 重传。
  - **超时的 `uploading` 可被同一 `client_asset_id` 接管重试**，否则进程崩溃会永久占位，用户既传不上也删不掉。
  - 只有 `ready` 可被提交与发布。
- [ ] **5.2 存储位置**：素材直接写到发布后继续使用的不可猜 key（服务端生成，不接受客户端指定），批准时不搬动对象。必须落实 Stage 0.1 契约的每一条。
- [ ] **5.3 画廊上限 20 张**，并计入 Stage 0.2 的总字节上限。**张数与容量的校验必须在锁住 submission 行之后原子进行**（与 4.6 同一类竞态：先 count 再 insert 会被并发上传越过上限）。
- [ ] **5.4 删除与违规后清理草稿素材**，但**已被正式条目引用的对象永不清理**（见 Stage 10.1）。**删对象不够，必须同时 purge Cloudflare**：草稿素材是公开可取的，一旦被预览过就可能进 CDN，`violation` / `reject` / 用户删除之后 CDN 仍会继续返回。purge 目标是封面与画廊的**全部实际 URL**（封面三变体 + 每张图的主图与缩略图），失败交给 Stage 10.1 的清理命令重试。

---

## Stage 6：提交、撤回与查重

- [ ] **6.1 提交**：`draft` / `changes_requested` → `pending`，冻结提交快照。
- [ ] **6.2 撤回**：`pending` → `draft`，不结算（押金随草稿继续持有）。用户想取回押金需撤回后删除。UI 文案要讲清这一点，并区分「冻结」与 `app/api/patch/resource/route.ts:90` 那种「余额阈值」语义。
- [ ] **6.3 提交快照冻结外部数据**：用户主动抓取 VNDB / Bangumi / Steam 时即把**规范化结果 + 来源 + 抓取时间**存入草稿（不存完整原始响应体，见 3.5）。提交后冻结，**管理员审到的就是最终发布内容**。批准时只重新检查数据库唯一性与 canonical tag/company 匹配，**不访问外网**。想刷新外部数据就打回用户修改。**所有外网抓取都属于 7.1 的「提交前抓取层」**，批准链路里不得出现网络调用。
- [ ] **6.4 查重分层**：同一用户的活动草稿不得重复 Release ID、Bangumi ID、DLsite Code；VNDB ID、Steam ID 与标题沿用现有软重复确认。提交时预检只是体验优化，**批准事务中的唯一约束才是最终防线**——但这条只在 Stage 3.6 补上 `vndb_relation_id` 全局唯一索引后才成立，`bangumi_id` / `dlsite_code` 已有约束。若最终不加索引，Release ID 必须改用按 Release ID 的事务级锁；**唯一索引更简单可靠，是首选**。
- [ ] **6.5 不引入「任意待审就阻塞提交」规则。** 资源侧 `app/api/patch/resource/route.ts:96-103` 的语义是「该用户只要有一条 `status = 2` 就禁止再发布」，照搬过来会把 5 / 10 条草稿上限变成「一次只能审一条」，与名额设计直接冲突。投稿只依靠三道既有防线：活动草稿上限（4.2 / 4.6）、同一投稿的状态守卫（4.5 / 7.3）、硬 ID 查重（6.4）。

---

## Stage 7：审核转换

**批准是一个纯数据库短事务。** 素材在起草阶段已经传完，批准时**没有任何对象存储操作**——这也是本阶段能保持简单的根本原因：现有直发路径 `app/api/edit/create.ts:117-188` 把 S3 上传包在 120 秒数据库事务里，那个模式无法扩展到最多 43 个对象（20 张画廊图 × 主图+缩略图 + 3 个 banner 变体），而投稿批准根本不需要搬动对象。**不要重新引入复制、抢占状态或 fencing。**

### 7.1 共享发布核心的三层拆分

**不得直接把 `app/api/edit/processExternalData.ts:193-243` 塞进批准链路**，两个硬理由：

- `:212` 经 `app/api/edit/fetchCompanies.ts:6` 的 `fetchVndbVn` **会访问 VNDB**，与「批准时不访问外网」直接冲突。
- 错误语义三套并存：`handleBatchPatchTags`（`:200`）直抛、company 任务（`:227-235`）catch 后重抛、tag/alias 走 `Promise.allSettled`（`:242`）静默吞掉失败。

因此**不继承**直发路径「patch 已公开但关系可能不完整」的现状，按三层重新拆：

| 层 | 时机 | 内容 | 失败后果 |
| --- | --- | --- | --- |
| 抓取层 | **提交前**（用户侧） | 访问 VNDB / Bangumi / Steam，规范化后连 provenance 存入草稿 | 用户可见错误，不影响已有草稿 |
| 发布核心 | **最终事务内，纯 DB** | `patch`、`alias`、tag/company 关系、`patch_rating_stat`、gallery、押金结算、`createMessage({ type: 'system' }, tx)`、`admin_log` | 整个事务回滚：不产生公开条目，不结算押金 |
| 事务后副作用 | 提交成功后 | tag/company 缓存失效、`invalidatePatchListCaches()`（对照 `app/api/edit/create.ts:221`）、SFW `postToIndexNow`（对照 `:223-226`） | 只影响缓存新鲜度，可重试，不影响条目正确性 |

- [ ] **7.2 按上表实现共享发布核心**：从 `app/api/edit/create.ts` 抽出与请求解析、萌萌点无关的纯发布逻辑，供直发路径与投稿批准共用。**这是本阶段最大的漂移风险**——若批准路径复制一份逻辑，两条路会逐渐分叉。tag/company 关系写入必须挪进事务内，不得沿用现有事务外的半成品语义。
- [ ] **7.3 最终事务**：一次条件式 `updateMany … where: { status: 'pending' }` 作为**审核并发守卫**；随后调用发布核心；`releaseMoemoepoint` + 奖励 3 点。全部成功才标记 `published`。**这是唯一的并发保护，不能省**——两名管理员同时点批准时靠它保证只产生一个 `patch`。
- [ ] **7.4 事务后副作用**：缓存失效与 SFW IndexNow 按上表第三层执行，失败只记日志并可重试，不回滚已发布条目。
- [ ] **7.5 失败分类固定为三条，不得含糊**：
  - **技术失败**（事务回滚、超时）→ 留在 `pending`，**不结算**，可重试。
  - **重复条目 / 超出收录范围 / 无法发布** → `rejected`，**release 返还**。
  - **违规** → `violation`，**forfeit 罚没**。

  批准失败**绝不允许**产生公开可见的 `patch` 或错误结算押金。
- [ ] **7.6 唯一性冲突**：另一用户已抢先发布同一条目时自动转 `rejected` 并返还（属于 7.5 第二类）。
- [ ] **7.7 三个管理员动作齐备**：
  - **`reject`（本轮补齐的功能缺口）**：人工判定重复 / 超出收录范围 / 无法发布 → `rejected`，release 返还，填原因（≤ 1007 字）、发通知、写 `admin_log`、清理草稿素材（不动已发布对象）。
  - **`request-changes`**：不结算，草稿回到可编辑，填原因、通知、`admin_log`。
  - **`violate`**：`forfeitMoemoepoint`，清除正文与素材仅留最小审计记录，填原因、通知、`admin_log`。
- [ ] **7.8 结算幂等与边界**：
  - 重复点击同一动作不得重复 release/forfeit。`settleMoemoepointReservation` 已用 `updateMany … where: { status: 'pending' }`（`app/api/moemoepoint/service.ts:384-396`）保证整笔只结算一次，需覆盖测试。
  - **跨动作边界**：结算只发生在进入终态的那一次转换。终态之后的任何用户操作（隐藏、归档）都不再调用结算原语——`service.ts:370-381` 要求 `status` 与 `settlement_idempotency_key` 同时匹配，否则抛 `MoemoepointReservationSettledError`，所以「共用一个结算幂等键」不是可选方案。见状态机的「结算边界」一节。
- [ ] **7.9 禁止自审**，超级管理员 override 需显式操作并写醒目 `admin_log`。

---

## Stage 8：接口与页面

- [ ] **8.1 用户接口**：`/api/patch-submission`、`/[id]`、`/[id]/submit`、`/[id]/withdraw`、`/[id]/hide`（终态隐藏，不结算），以及封面/画廊接口。按本人鉴权。删除只对活动状态开放。
- [ ] **8.2 管理员接口**：`/api/admin/patch-submission` 及 `approve`、**`reject`**、`request-changes`、`violate`。按 role ≥ 3 鉴权。`reject` 是本轮补齐的缺口，不能省。
- [ ] **8.3 本人主页标签页** `/user/[id]/submission`（仅自己可见）：名额、押金说明、进行中草稿、已发布记录。终态记录提供「隐藏」而非「删除」。
- [ ] **8.4 编辑与预览** `/submission/[id]`。
- [ ] **8.5 投稿预览**复用正式详情页的只读头部、简介、标签与画廊，但**不挂载**浏览量、收藏、评论、评分、资源、缓存与 SEO。**不要叫「私有预览」**：它是「公开但地址不可猜、不可索引」，页面与文案要如实说明这一级别，不得宣称私有。
- [ ] **8.6 后台审核队列**：按最早提交优先，支持标题/用户/外部 ID 搜索（首版队列只显示标题、投稿人与状态）。管理员可通过、**驳回**、要求修改或判定违规，**不能代改**。
- [ ] **8.7 投稿画廊卡片的键盘可达性（唯一从 Stage 11 保留进来的无障碍阻塞项）。** 现状：整卡同时承担 dnd 键盘操作与鼠标选择，`Checkbox` 为 `pointer-events-none` 且无可访问名称，放大控件同为 `div` + `onClick`——纯键盘用户无法选中或放大截图。投稿面向普通用户，这里不能沿用现状。修法：选择态与放大各自使用可聚焦、有可访问名称的原生控件（HeroUI `Checkbox` / `Button`），与拖拽的键盘操作分离到不同的可聚焦目标上。验收见「上线前必须验证」的键盘一项。

---

## Stage 9：限频分层

项目已有的分层依据是 `docs/modules/data-cache-upload.md:223`：动作限频 Redis 故障 fail-open，会产生不可计量 S3 成本的 quota 链路 fail-closed。投稿在此基础上进一步细分：

- [ ] **fail-closed**：新建草稿、提交、素材上传（碰钱或产生存储成本）。
- [ ] **fail-open**：草稿读取、自动保存（纯技术限频，不应因 Redis 抖动打断编辑）。
- [ ] **不设 Redis 限频**：删除返还、管理员驳回返还、批准/违规结算。这些必须以数据库状态机与幂等键为最终防线，**不得返回 429**。注意这与 fail-open 不是一回事：fail-open 只管 Redis 宕机，阈值超了照样 429。
- [ ] 阈值：创建 20 次/小时；提交/撤回 20 次/小时；草稿保存 120 次/分钟；素材上传 30 次/10 分钟。**删除从账务桶里移除**（原「创建/删除共 20 次/小时」与上一条自相矛盾）。

---

## Stage 10：运维

- [ ] **10.1 孤儿投稿素材清理命令**，支持 dry-run / apply。**必须永久排除已被正式条目引用的对象**：发布后素材所有权转移给 `patch`，隐藏或删除投稿记录**不得**级联删除线上条目仍在引用的对象。**还要重试 Stage 5.4 未成功的 Cloudflare purge**（封面三变体 + 每张图主图与缩略图的实际 URL），否则违规/驳回/删除后的素材仍能从 CDN 取到。
- [ ] **10.2 容量监控**：每用户活动草稿总字节（首版只要这一项，全站存储总量后移二期）。
- [ ] **10.3 回滚预案**：先停止创建新草稿，但**必须保留**既有草稿的删除、审核与萌萌点结算能力，直至待结算投稿清零。

---

## Stage 11：已移出本计划的上传 UI 质量项

这批项目属于既有 create/rewrite 页面的质量整改，与投稿功能无依赖关系，**已移出本计划另行排期**。只有两项留在本计划内，因为投稿链路会直接复用相关组件：

- Stage 1.1 的马赛克打码泄露（现存内容泄露）。
- 投稿实际复用组件上的无障碍阻塞项：卡片选择态键盘不可达。**已排进 Stage 8.7，并有对应上线验收项**，不要当成本节的说明性文字。

其余（创建页上传态缺失、失败文案被遮挡、拖拽失败只 `console.error`、`RewriteGalleryInput.tsx:273` 的 O(N²) blob 重建、blob URL 不回收、`galleryOrder` 只比长度、进度 toast 4 秒、「重试失败截图并提交」实为整表重 PUT、`utils/kunCopy.ts:15` 无 clipboard 兜底）移交独立计划跟踪。

---

## Stage 12：文档

- [ ] 更新萌萌点规则常量与用户可见规则页（押金、名额、奖励、驳回/违规差异）。
- [ ] **把 `docs/superpowers/specs/2026-08-19-moemoepoint-submission-stake-design.md` 标记为 superseded**，移除「写入 `patch.status`」与「普通驳回即罚没」等已废弃方向。
- [ ] 更新 `docs/modules/api-services.md`、`docs/modules/frontend-content.md`、`docs/modules/data-cache-upload.md`、`docs/project/deployment.md`。
- [ ] 记录 Stage 9 的限频分层判断依据，避免后人当 bug 改回统一 fail-open。
- [ ] **记录素材路径运维契约**：投稿 key 不遵循 `patch/<id>/...` canonical 布局；已发布素材归 `patch` 所有、清理命令必须排除；封面三变体的 purge 需额外处理旧投稿 URL；未审素材下架必须连带 CDN purge；`scripts/galleryThumbnailBackfill.ts` 的 canonical 假设与其测试同步调整。
- [ ] 单独成笔，`docs(...)` 提交。

---

## 上线前必须验证

**金额与名额**
- [ ] 普通用户/创作者的金额与上限各自正确；余额不足被拒；角色变化后既有草稿可继续、超上限不能新建。
- [ ] **并发建草稿不越上限**：同一用户并发请求，以及**带同一请求 ID 的重试**（走 `service.ts:309` 幂等早退分支、不取用户行锁的那条路径）都不得越过名额或重复 reserve。

**结算幂等与边界**
- [ ] 删除返还、撤回不结算、`changes_requested` 不结算、批准返还并奖励 3 点、`rejected` 返还、`violation` 确认扣除；以上所有操作的重复请求均幂等。
- [ ] **终态隐藏不调用任何结算原语**：`rejected` / `published` / `violation` 记录执行隐藏后，`user_moemoepoint_reservation` 与 ledger 无新增行，且接口不抛 `MoemoepointReservationSettledError`。
- [ ] 活动状态删除走 release → `deleted`；终态无删除入口。

**权限与并发**
- [ ] 所有权校验、管理员权限、禁止自审（含超级管理员 override 有日志）、待审只读。
- [ ] 撤回与审核并发时只有一个状态转换成功。
- [ ] **两名管理员同时点批准**：条件式 `updateMany … where: { status: 'pending' }` 只让一个成功，只产生一个 `patch`。
- [ ] **不同用户同时投稿同一游戏**：一方发布成功，另一方自动 `rejected` 并返还。

**审核动作齐备**
- [ ] `approve` / `reject` / `request-changes` / `violate` 四个动作均可用，各自的原因、通知、`admin_log` 与结算行为符合 Stage 7.5 的三分类。

**素材与批准链路**
- [ ] 20 张画廊上限与每用户总字节上限在**并发上传下也不被越过**：`uploading` 与 `ready` 同样占用 slot 与预留字节，多请求并发不产生超过 20 张的 `ready`。
- [ ] `failed` 释放占用后可用同一 `client_asset_id` 重传；**超时的 `uploading` 可被同一 ID 接管**，不会永久占位。
- [ ] 只有 `ready` 进入提交与发布；文件校验与 S3 补偿生效。
- [ ] **批准失败不得产生公开可见的 `patch`，也不得结算押金。**
- [ ] **发布后条目关系完整**：tag/company 关系与 `patch` 同事务落库，事务后只剩缓存失效与 IndexNow；批准链路全程无外网调用。
- [ ] 事务后副作用失败（缓存 / IndexNow）不影响条目正确性，可重试。
- [ ] **Release ID 并发发布被数据库拒绝**（Stage 3.6 生效，不是只靠应用层预检），且**大小写无关**：`R123` 与 `r123` 视为同一个。
- [ ] 命中 Release ID 唯一约束时**不返回 500**：直发创建/编辑给用户可见的重复提示，投稿批准转 `rejected` 并返还。`dlsite_code` 同路径一并覆盖。
- [ ] 清理命令不会删除已发布条目引用的对象；首次换封面时三个变体的旧投稿 URL 被清理并 purge；`violation` / `reject` / 用户删除后，封面与画廊的实际 URL 均已 purge，**CDN 不再返回未审素材**。

**可见性与前端**
- [ ] 待审投稿不出现在首页、列表、搜索、排行、标签、会社、随机推荐、sitemap 与详情页直达。（独立域天然保证，仍需回归确认没有误 join。）
- [ ] 本人标签页显隐、跨设备恢复、自动保存冲突提示、投稿预览无公开副作用、两套主题与移动端布局。
- [ ] **纯键盘走完投稿画廊**（Stage 8.7）：Tab 可依次到达每张卡片的选择与放大控件，两者都有可访问名称，空格/回车可操作，拖拽排序的键盘操作不与选择互相抢焦点。

**部署**
- [ ] **Stage 3.6 / 3.6a 作为独立前置提交先行**：preflight 盘点无冲突（或冲突已人工处理）、存量值已归一、唯一性与错误映射已上线，之后才动投稿 schema。
- [ ] 新 schema 的生产 preflight/sync 已执行且未在生产跑 `prisma db push`；先上 schema 与后端，再开放入口。
- [ ] 以 `role = 1` 账号完整走一遍：建草稿 → 冻结 → 自动保存 → 提交 → 待审不公开 → 通过返还并奖励 / 驳回返还 / 违规罚没 → 收到通知。

---

## 已废弃方向

以下来自 2026-08-19 旧 spec 与本文件前一版，**已被独立投稿域整体取代，不要再实施**：

- **写入 `patch.status = 2` 表示待审。** 连带作废：改两个 `getPatchVisibilityWhere` 中心钩子、逐个补 8 处绕过点、sitemap 过滤、详情页直达 404、status source-guard 测试、激活 `patch.status` 并补审核队列索引。草稿从不写入 `patch`，这些风险不再存在。
- **普通驳回即罚没。** 由 `rejected`（返还）与 `violation`（罚没）取代。
- **在 `/edit/create` 与 `/api/edit` 内按角色分叉。** 投稿走独立端点，现有入口权限不变。
- **把创建页 localforage 草稿机制作为投稿前置。** 云端草稿取代它，连带作废「清除信息后状态残留」「重传丢弃新补图」「逐项持久化换幂等」三项——但**幂等本身没有作废**，改由 Stage 5.1 的 `client_asset_id` 承担。
- **未审素材放私有 bucket，批准时复制到 canonical key。** 2026-08-23 决定不采用：素材改为不可猜 key、不搬动，连带作废 `publishing` 状态、fencing token、`CopyObjectCommand`、三段式批准与复制崩溃恢复。代价是投稿 key 偏离 canonical 布局，运维契约见 Stage 0.1。
