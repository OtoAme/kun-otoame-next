# 萌萌点暂扣投稿设计（Phase 2）

## 背景

社区反馈普遍希望**普通用户能够添加游戏条目**。目前建条目权限极窄，直接放开会带来低质量投稿和刷条目风险。因此设计目标是：用**萌萌点暂扣（押金）** 约束投稿质量——投稿时冻结一笔萌萌点，审核通过则返还，驳回则罚没。

Phase 1（已完成）已经交付支撑这套机制所需的账务基建：`user_moemoepoint_ledger` 流水、`user_moemoepoint_reservation` 暂扣生命周期，以及 `reserveMoemoepoint` / `releaseMoemoepoint` / `forfeitMoemoepoint` 三个原语。

> **重要**：这三个原语和 `user_moemoepoint_reservation` 表目前**零调用方**。这是**有意为之**，不是死代码，不要清理。它们等待本文档描述的投稿流程接入。

本文档只做设计与风险盘点，**不包含实现**。

## 目标

- 让 `role = 1` 的普通用户可以提交新游戏条目，且提交需要冻结萌萌点。
- 投稿进入审核队列，通过后公开可见并返还押金；驳回则罚没押金并通知用户。
- 复用 Phase 1 的暂扣原语和现有资源审核流的形态，不新造并行机制。

## 非目标

- 不改动 `user_moemoepoint_ledger` / `user_moemoepoint_reservation` 的表结构。
- 不放开游戏**编辑**权限（`PUT /api/edit` 仍为 role ≥ 3）。
- 不引入通用审核队列框架；沿用现有 per-domain `status` 整型列的做法。
- 不做投稿贡献榜（可在本期之后单独评估）。

---

## 三个必须先解决的阻碍

这三点是实施前排查出的硬约束，任何实现方案都必须先处理。

### 阻碍 1：建条目目前是超级管理员专属

`app/api/edit/route.ts:44`：

```ts
if (payload.role < 4) {
  return NextResponse.json('本页面仅超级管理员可访问')
}
```

页面侧同样限制：`app/edit/create/page.tsx:10-13` 对 `role < 4` 直接 `redirect('/')`，`app/edit/page.tsx:11-15` 把非 role 4 用户送回首页。

**含义**：开放投稿**不是「放宽一个阈值」，而是新增一条路径**。现有 role 4 直发路径必须保留（管理员建条目不应被要求押金），因此需要在同一入口内按角色分叉：role ≥ 4 直接发布，role < 4 走暂扣 + 审核。

另外注意 `app/api/edit/create.ts:170-173` 会 `daily_image_count: { increment: 1 }` 但**从不校验它**——因为建条目一直是超管专属，这个自增实际上是残留物。开放投稿后它会成为唯一的天然频率信号，需要明确是启用为限额还是另设限流。

### 阻碍 2：`patch.status` 是休眠字段

`prisma/schema/patch.prisma:15` 有 `status Int @default(0)`，但：

- **从未被写入**：全部 `prisma.patch.update` 调用（`edit/create.ts:149`、`edit/update.ts:89,146`、`patch/views/put.ts:21`、`patch/banner/service.ts:25`）都不涉及 `status`。
- **从未被用于过滤**：`status` 只被 select 进响应（`app/api/patch/_queries.ts:68`、`app/api/patch/get.ts:86`、`app/api/patch/_content.ts:101`）。
- **无注释说明取值**，与 `patch_resource.status` 形成对比——后者在 `prisma/schema/patch-resource.prisma:10-11` 明确写了 `// 0 - normal, 1 - banned, 2 - pending approval`，并有三个配套索引。

**含义**：使用 `patch.status` 等于**激活一个未使用字段**，需要补注释、补索引（至少 `[status, created(sort: Desc)]` 供审核队列查询），并在生产迁移里显式建索引，而不是依赖 `prisma db push`。

### 阻碍 3（最危险）：没有任何 patch 查询过滤 `status`

**这是本设计最关键的风险。** 一旦把待审核投稿写成 `status = 2`，它会**立刻在全站公开可见**，因为没有任何查询排除它。

已确认的 patch 列表/详情查询点（`prisma.patch.findMany` / `count` / `findUnique`，共 48 处），其中**面向公开的**包括：

| 位置 | 用途 |
| --- | --- |
| `app/api/home/service.ts:35` | 首页 |
| `app/api/otomegame/service.ts:92,102` | 游戏列表 |
| `app/api/search/service.ts:132,139` | 搜索 |
| `app/api/ranking/service.ts:56,63` | 排行 |
| `app/api/tag/service.ts:95,110` | 标签下游戏 |
| `app/api/company/service.ts:186,193` | 会社下游戏 |
| `app/api/home/random/service.ts:5` | 随机推荐 |
| `app/api/patch/get.ts:26,65` / `app/api/patch/_queries.ts:130-142` | 详情页 |
| `scripts/dynamic-routes/getKunDynamicPatches.ts:13` | **sitemap**（只过滤 `content_limit: 'sfw'`） |

#### 好消息：已有一个中心化的可见性钩子

仓库已经有 patch 可见性的统一入口，只是它当前只处理 NSFW 与屏蔽标签，**不含 status**：

- `app/api/utils/getPatchVisibilityWhere.ts`（API 侧，接 `NextRequest`）
- `utils/actions/getPatchVisibilityWhere.ts`（server action 侧，`cache()` 包装）

两者都返回 `Prisma.patchWhereInput`，由 `getNSFWHeader` + `buildBlockedTagWhere` 组合而成。**把 `status` 过滤加进这两个函数，可以一次覆盖它们现有的全部消费方**：

```
app/api/home/route.ts、app/api/home/random/route.ts、app/api/search/route.ts、
app/api/resource/route.ts、app/api/user/profile/resource/route.ts、
app/api/patch/resource/download/access/route.ts（+ restore）、
app/otomegame/actions.ts、app/resource/actions.ts、app/tag/[id]/actions.ts、
app/user/[id]/resource/actions.ts
```

#### 坏消息：有 8 处绕过了它，直接用 `getNSFWHeader`

这些位置**必须逐个单独处理**，加中心钩子不会覆盖它们：

```
app/api/otomegame/route.ts          app/api/ranking/route.ts
app/api/tag/otomegame/route.ts      app/api/company/otomegame/route.ts
app/api/user/profile/favorite/route.ts
app/ranking/actions.ts              app/admin/otomegame/actions.ts
app/admin/resource-apply/actions.ts  app/admin/resource/actions.ts
```

（末三个是后台，应当**能**看到待审核条目，属于有意例外，需要在实现中显式标注而不是遗漏。）

#### 另外必须单独处理

- **sitemap**：`scripts/dynamic-routes/getKunDynamicPatches.ts:13` 完全独立于上述钩子，只有 `where: { content_limit: 'sfw' }`。漏掉它会把待审核条目提交给搜索引擎。
- **详情页直达**：即便列表都过滤了，`/{unique_id}` 详情页仍可被直接访问。`app/api/patch/get.ts` 与 `app/api/patch/_queries.ts` 的 `findUnique` 需要按「投稿人本人 + 管理员可见，其他人 404」处理。

#### 建议的实现形态

照 `utils/patchResourceAttributes.ts:15-28` 已有的 `visiblePatchResourceWhere` / `createVisiblePatchResourceWhere` 模式，为 patch 建等价物：

```ts
export const PUBLISHED_PATCH_STATUS = 0
export const visiblePatchWhere = { status: PUBLISHED_PATCH_STATUS } as const
```

然后并进两个 `getPatchVisibilityWhere`，并给上面列出的绕过点逐一补上。**实现时应加一个 source-guard 测试**（参照现有 `tests/unit/moemoepoint-source-guard.test.ts` 的做法），断言所有 patch 列表查询都带 status 过滤，防止将来新增查询时再次漏掉。

---

## 可复用的既有件

### 审核流模板：资源审核

`app/api/admin/resource-apply/service.ts` 是仓库里唯一成熟的审核流，形态可直接照搬：

- **入队**：`app/api/patch/resource/create.ts:53` 按角色决定 `needApproval`，`:108` 写 `status: needApproval ? 2 : 0`。规则是 role 1 永远需审，role 2 仅首个资源需审，role ≥ 3 直发。
- **队列**：`app/api/admin/resource-apply/get.ts:15` 用 `where: { status: 2 }`。
- **通过**（`service.ts:14-86`）：先 guard `if (resource.status !== 2) return '当前资源状态无需审核'`，事务内 `status: { set: 0 }`，重算聚合，`createMessage({ type: 'system', ... }, prisma)` 通知，写 `admin_log`，事务外清缓存。
- **驳回**（`service.ts:88-176`）：**硬删除**记录，带 `reason` 通知用户，写 `admin_log`，清理 S3。

**关键差异**：资源审核流**完全没有**积分暂扣/罚没——积分只在显式删除资源时通过 `reverseMoemoepoint` 回退（`app/api/patch/resource/delete.ts:48`）。押金逻辑是 Phase 2 全新要接的部分。

**驳回语义需要决策**：资源驳回是硬删除。投稿驳回如果也硬删除，用户就无法修改后重投，押金也只能罚没。若希望「驳回 → 可修改重投」，需要保留记录并新增一个状态值，这会让 `patch.status` 的取值域超出资源那套 0/1/2。

### 暂扣原语（已就绪，零调用方）

`app/api/moemoepoint/service.ts`：

| 函数 | 语义 |
| --- | --- |
| `reserveMoemoepoint` | 建 reservation + 写 `kind: 'reserve'` 流水；只增 reserved，**不动总额**；用 `requiredAvailable` 原子校验可用余额 |
| `releaseMoemoepoint` | 减 reserved，总额不变（审核通过 → 返还） |
| `forfeitMoemoepoint` | 同时减 reserved 和总额（驳回 → 罚没） |

`user_moemoepoint_reservation` 已含 `amount`、`status pending→released/forfeited`、`idempotency_key`、`settlement_idempotency_key`、`settlement_reason`、`settled_at`、`settled_by_id`、`reference_type`、`reference_id`、`link`。每笔暂扣只能整笔结算一次（`settleMoemoepointReservation` 用 `updateMany … where: { status: 'pending' }` 保证）。

**接入要点**：`reserveMoemoepoint` 必须和 `patch.create` 放在**同一个事务**里，`reference_type: 'patch'` / `reference_id: <patchId>`，`idempotencyKey` 用稳定值（如 `patch-submission:${patchId}`）。注意 `app/api/edit/create.ts` 现有事务内已经在做 banner 的 S3 上传——押金冻结应在 S3 上传**之前**，避免余额不足时白传对象。

### 创作者路径不冲突

`app/api/apply/service.ts:4-58`：`role = 2` 靠「已发布 ≥3 个资源 + 超管审批」，**无任何积分门槛**。且成为创作者**并不解锁建游戏**（仍需 role 4），只解锁对象存储上传和资源免审。

**结论**：投稿暂扣是一条全新路径，不与创作者申请重复，两者可共存。

### 现有唯一的积分门槛是余额阈值，不是押金

`app/api/patch/resource/route.ts:90`：`user.role < 2 && toMoemoepointBalance(user).available < 20` → 拒绝。这是**阈值**语义（要求你有钱），不冻结也不扣除。投稿押金是**冻结**语义，是不同机制，文案上要区分清楚，避免用户混淆。

### 通知

`app/api/utils/message.ts` 的 `createMessage(data, db = prisma)` 接受事务客户端，可在事务内发通知。`type` 取值见 `constants/message.ts` 的 `MESSAGE_NOTIFICATION_TYPE`。投稿审核结果应用 `type: 'system'`（与资源审核一致）；`type: 'apply'` 保留给创作者申请。

注意 `constants/message.ts` 有一个 `pr: '更新请求'` 类型，但只出现在注释掉的代码里（`app/api/message/service.ts:92`、`app/api/message/all/service.ts:17`），无活跃功能使用。若投稿走「更新请求」语义可以考虑启用它，但需要同步打开消息列表侧的过滤。

### 待审核阻塞后续提交

资源侧已有「有待审核就不能再提交」的规则，实现在**两处**（`app/api/patch/resource/route.ts:94-101` 和 `app/api/upload/resource/route.ts:70-75`）。投稿侧同理需要，且应只实现一处并复用。

---

## 待决策项

实现前需要明确：

1. **押金金额**，以及是否随用户历史投稿通过率浮动。
2. **驳回语义**：硬删除（同资源）还是保留可修改重投。这决定 `patch.status` 取值域。
3. **罚没比例**：全额罚没还是部分罚没。恶意刷条目与「诚实但质量不达标」是否区别对待。
4. **超时未审**：长期 pending 的 reservation 是否自动 release。若是，需要一个 cron 任务（`server/tasks/` 有 `withTaskLock.ts` 可复用）。
5. **投稿配额**：启用休眠的 `daily_image_count`，还是新增 Redis 限流（`app/api/message/conversation/rateLimit.ts` 的 `checkConversationActionRateLimit` 已被跨目录复用，可加 action key）。
6. **待审投稿对投稿人自己是否可见**，以及可见时走哪个路由。

## 上线前必须验证

- 每一个公开 patch 查询都排除 `status != 0`，**包含 sitemap 和详情页直达**。建议用 source-guard 测试固化。
- 押金冻结与 `patch.create` 同事务；余额不足时事务回滚且不产生孤儿 S3 对象。
- 审核通过/驳回各自的结算幂等：重复点击不重复 release/forfeit。
- 生产迁移需为 `patch.status` 建审核队列索引；照 `migration/` 现有 preflight/sync 成对模式执行，不在生产跑 `prisma db push`。
