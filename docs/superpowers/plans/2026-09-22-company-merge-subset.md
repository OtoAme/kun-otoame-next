# 会社合并：勾选实际要并的几家（VNDB 别名也算候选证据）

日期：2026-09-22（第五次修订：可空结果用 Json、统一锁顺序、用 candidate_key 更新同一条建议）  
分支：`fix/company-ingestion`

身份政策第 11 条仍有效：唯一约束必须写在 Prisma schema 里，禁止 SQL-only partial unique（生产 schema guard 只放行 `patch_released_idx`）。

## 例子

`#407 Kotama Yuri`、`#408 WINGALD`、`#409 小珠ゆり`。VNDB `p5101` 的 name / original / aliases 都是权威候选。检测默认三家一组。人取消勾选 408，只并 407 和 409。

落地前风险：`applyCompanyMergeSuggestion` 仍把建议行整组 id 交给 writer。必须同时改 validation、route、service、`beforeApply`、前端。

---

## 1. 后台操作

合并框每家勾选，默认全选，至少两家。只并勾上的；主会社 = 勾中最小 id。介绍、官网、父品牌、缺行拦截、成功 toast **只看勾上的**。未勾选且已删的不挡提交；勾上的缺行才挡。

驳回 = 这一组 id 整组不对。驳回三家后 **不会** 自动出现 407+409。

跳过建议只认 `member_key`（id 组合），不用 `folded_key` / `vndb:p5101`。`folded_key` 只展示。同步改 schema 注释、`service.ts` 双 key fallback、`docs/modules/operations.md`、`types/api/companyMerges.ts`、`validations/companyMerges.ts`、GET 历史响应、reopen 说明。

部分合并后自动排除「留下的主会社 + 每个未勾选 id」。人可在已驳回里重新打开。

---

## 2. 检测怎么找到「同一条建议」

不能只靠当前 `member_key`：成员从 407+408+409 变成另一组时，新 key 对不上旧 pending 行，会再插一行，apply 也不知道这是刷新过的同一候选。

增加列 `candidate_key`（`String @db.VarChar(512)`，可空以兼容旧行，回填后对 source-pair 非空）。

生成规则（纯函数 `toCandidateKey`，检测/测试共用）：

- source-pair：`source-pair|` + 排序后的 `upstreamIds` + `|patch:` + patchId。例：`source-pair|vndb:p5101|patch:814`。成员变了，这条 key **不变**，用来找到并更新原 pending 行，再把 `company_merge_pending_key` 从旧 `member_key` 换成新的。
- 非 source-pair（后缀/标点）：`kind|` + `toMemberKey(ids)`。成员变了就是另一条建议，不改旧行。

同一 `candidate_key` 至多一行 pending。无论是更新旧行还是新插入，**先看目标 `member_key` 是否已有 dismissed 或 accepted**。有则本次不改成员、不建 pending，计 skip。例：pending 是 407+408+409，这次检测要改成 407+408，而 407+408 已被驳回 → 保留三家那一行，不改成被驳回的两家。

目标 `member_key` 没被挡住、且已有 **另一条** pending 占用该 key：保留本行和它的旧 pending-key，本次成员更新跳过，写入 `notes`。不要删掉本行的 key 再去抢别人的 key（会留下没有 key 的行，或让整轮检测失败）。本期不把两行合成一行。

目标 key 空闲、且本行就是这条 `candidate_key` 的 pending：同一事务里删旧 pending-key、改 `member_key`、插入新 key。`candidate_key` **不改**。同时更新 `names`、`evidence`、`detected_at` 和成员列。旧 `member_key` 只在目标 key 空闲时替换。没有 pending 且目标 key 未被驳回/已合并：插入新行和新 key。

apply 锁住的是 **建议行 id**。检测若已把该行成员改掉，apply 的 `beforeApply` 重读整组 id，与开头快照不同则失败「该建议涉及的会社已经变化」并回滚。检测若按 `candidate_key` 更新的就是这一行，apply 能看见变化。

---

## 3. Schema

### 结果数组不用 `Int[]?`

Prisma 的 scalar list 不能用 `?` 表示 SQL NULL，和「null = 旧记录没保存」冲突。

采用 **`Json?`**，应用层用共享 Zod 解析成 `number[]`：

| 列 | 类型 | 含义 |
| --- | --- | --- |
| `selected_company_ids` | `Json?` | null = 旧记录未保存；数组 = 勾选的 id（≥2） |
| `applied_source_company_ids` | `Json?` | null = 旧记录未保存；数组 = 实际删除的 id（成功合并至少 1 个） |
| `applied_target_company_id` | `Int?` | null = 旧记录未保存；否则为实际留下的会社 |
| `member_key` | `String @db.VarChar(512)` | 检测整组 id，`toMemberKey` |
| `candidate_key` | `String? @db.VarChar(512)` | 见 §2。旧行可 null |
| `resolution_source` | `String? @db.VarChar(32)` | null 旧记录；`operator-dismiss` / `operator-merge` / `partial-merge-exclusion` |

`target_company_id` / `source_company_ids` / `names` 仍是检测当时的整组，不改成子集。

API：上述 Json 列为 null 时返回 `null`（不是 `[]`）。前端文案「旧记录未保存勾选结果」。

### pending 占用表（普通唯一，Prisma relation）

```prisma
model company_merge_pending_key {
  member_key    String @id @db.VarChar(512)
  suggestion_id Int    @unique
  suggestion    company_merge_suggestion @relation(fields: [suggestion_id], references: [id], onDelete: Restrict)
  created       DateTime @default(now())
}

model company_merge_suggestion {
  // …现有列 + 新列
  pending_key company_merge_pending_key?
  @@index([member_key, status])
  @@index([candidate_key, status])
}
```

不变量（postflight 逐行检查，不只比数量）：

- pending-key 指向存在的建议行，且该行 `status=pending`、`member_key` 与 key 相同  
- 一个 suggestion 至多一条 pending-key  
- 每个 pending 建议恰好一条 pending-key  
- 非 pending 建议没有 pending-key  

业务代码不删建议行。`onDelete: Restrict` 防止误删留下悬空 key。

### 回填顺序（可重跑，中断点写在 SQL 注释里）

1. **preflight（只读旧表，此时还没有 pending-key 表）**：非法/空的将回填的 member_key、同一组合两行以上 pending → 失败并列出 key，不静默删。超长 member_key 同样失败。  
2. **sync-a**：加可空列。  
3. **sync-b**：回填 `member_key`（与 `toMemberKey` 相同的去重、升序）。同时回填能安全生成的 `candidate_key`：旧 `evidence` 为 `source-pair` 且有 `upstreamIds` 和 `patchId` 时，用与 `toCandidateKey` 相同的字符串。缺字段的旧行 **保持 null**，不要猜。检测遇到 `candidate_key` 仍为 null 的 pending：只按 `member_key` 更新或 skip，**不要**再插一条同 `member_key` 的新 pending。  
4. **preflight-2**：再查重复 pending、空 `member_key`。不过则停止，不建新表，也不把列改成非空。  
5. **sync-c**：`ALTER member_key SET NOT NULL`。建 `company_merge_pending_key` 和外键，插入当前 pending。  
6. **postflight**：§不变量，并检查 `member_key` 列定义为 NOT NULL。  
7. **rollback**：按 sync 逆序，单独文件。

应用代码不得先于 sync-c 上线。

### toMemberKey 失败

抛 `CompanyMergeMemberKeyError`，`code` 为 `too-few` 或 `too-long`。

- 检测：记入本次 `notes`，跳过该组，不写行。  
- apply / reopen：返回这条错误的中文说明，不写库。  
- 迁移 preflight：同一规则下超长则 SQL 失败，不另写一套截断。

### evidence

共享 Zod（`validations/companyMerges.ts`），禁止任意 JSON 直写：

`hits` 必填（可以是空数组，不能缺这个字段）。`companyId` 必须属于该建议整组。`source: 'vndb'` 时 `field` 只能是 `name | original | alias`；`source: 'nextmoe'` 时只能是 `display_name`。其它组合拒绝写入。GET 校验失败则该条 evidence 当空 hits，不 500。

### 自动排除行

`status=dismissed`，`resolution_source=partial-merge-exclusion`，`member_key=407,408`，`candidate_key` 空（它不是检测候选）。`names` 冻结。`evidence` 含 `resolutionSource`、`parentSuggestionId`、父建议 upstream/patch、hits。

**不覆盖人工驳回：** 已有 `operator-dismiss`（或 `resolution_source` 为空的旧驳回）时，保留 `resolved_by_user_id` 和 `resolved_at`。evidence 追加 `laterPartialMergeExclusions` 数组。已是自动排除则只更新 `parentSuggestionId`，保留首次 `resolved_at`。

锁到该 `member_key` 的行之后：

| 状态 | 做法 |
| --- | --- |
| 无行 | 插入 dismissed，不占 pending-key |
| pending | 改为 dismissed 自动排除，**删除 pending-key** |
| dismissed 人工 | 不改操作者/时间；可追加 evidence 事件 |
| dismissed 自动排除 | 更新 parent，保留首次时间 |
| accepted | 不改；`console.error` `[company-merges] skip auto-exclude member_key=… already accepted` |

---

## 4. 锁顺序（检测、apply、自动排除同一套）

避免「检测先锁自动排除行再等父建议，apply 先锁父建议再等自动排除行」。

**同一事务内顺序固定：**

1. `pg_advisory_xact_lock`（键 `'company-merge-queue'`）。检测写入和 apply **都先拿这把锁**。  
2. 收集本事务要动的全部 `member_key`（apply：父建议的 key + 每个自动排除 key），**按 member_key 字符串升序** `SELECT … FOR UPDATE`。  
3. 仅 apply：再 `lockCompanyMaintenanceTables`。检测不锁会社表。

现有 `applySingleCompanyMerge` 自己开事务，并且 **先** `lockCompanyMaintenanceTables`，然后才 `beforeApply`。只改现在的 `beforeApply`，锁会社表已经发生，排不到计划前面。也不要在 service 再包一层事务（writer 里的事务不会并进去）。

最小改法：在 writer **自己的事务里、锁会社表之前** 增加一个 hook（例如 `beforeCompanyLocks`），在里面拿咨询锁并按上面第 2 步锁建议行。结果落库和自动排除仍放在现有 `afterApply`，同一事务。不必重写整个 writer。

检测与 apply、两个 apply 都先排队在同一把 advisory lock 上，不会交叉锁建议行。

apply 在锁内重读父建议整组 id；与进入事务前读到的不一致 → 失败回滚。两个 apply 抢同一行：后者看到非 pending → 「该建议已处理」。

---

## 5. pending-key 与驳回 / 重开 / 合并

每个 pending 建议 **恰好** 一条 pending-key。同一事务：

| 动作 | pending-key |
| --- | --- |
| 检测插入 pending | 插入 |
| 检测按 candidate_key 改成员 | 删旧 key、插新 key |
| 人工驳回 | 删除 pending-key；`resolution_source=operator-dismiss` |
| 自动排除把 pending 改成 dismissed | 删除 pending-key |
| 合并 accepted | 删除 pending-key |
| 重新打开 dismissed→pending | **插入** pending-key；若该 `member_key` 已有别的 pending-key，失败「已有待处理的同一组会社」，行仍是 dismissed。成功则 **清空** `resolution_source`（不要留着 `partial-merge-exclusion` 或 `operator-dismiss`） |

现有 `reopenCompanyMergeSuggestion` 只改 status，必须改成上述事务。补测试：重开恢复 key；key 被占用则失败且行仍是 dismissed。

---

## 6. apply

Body 必填 `selectedCompanyIds`。服务端：

- 去重、≥2、都属于建议整组  
- target = 所选最小 id；sources = 其余所选  
- 主名、介绍来源属于所选  
- **所有者只从所选会社按主名推导**，不用未勾选行的 `user_id`

事务（锁顺序见 §4）：writer 只收所选 id → 父建议 accepted 并写入 Json 结果列与 `resolution_source=operator-merge` → 处理自动排除。失败整笔回滚。

不传 `selectedCompanyIds` 直接失败，不默认整组。

GET accepted/dismissed 返回 `selectedCompanyIds`、`appliedTargetCompanyId`、`appliedSourceCompanyIds`、`resolutionSource`（Json 列为 null 则 null）。

---

## 7. 检测写入

advisory lock 之后按 `candidate_key` 更新或按 `member_key` skip。

Skip：`member_key` 上存在 **当前** dismissed 或 accepted（必须读这两种，不能只读 pending+dismissed）。查询走 `@@index([member_key, status])`。

插入 pending 与 pending-key 同一事务。更新成员前若目标 key 已被其他建议占用：保留本行与旧 key，记 `notes`，见 §2。不得留下没有 key 的 pending，也不得留下没有建议行的 key。

---

## 8. 测试

- 默认三家；`[407,409]`：408 的行、relation、count 不变；409 删除；407 关系为并集。  
- 407/409 相关 patch 缓存失效；不把 408 当被删源会社。  
- 所有者不来自未勾选会社。  
- 自动排除生命周期：再检测无 407+408；已驳回可见；重开后 pending 且有 pending-key；key 已被占用则重开失败。  
- 已有 pending/dismissed（含人工，不改操作者）/accepted 时不插第二行。  
- 驳回三家后无 407+409 新 pending。  
- Tenky 一对；KONAMI 不进。  
- apply 与检测交错：成员已变则 apply 失败回滚。  
- 按 `candidate_key` 要把三家改成已被驳回的两家时：不改原 pending，计 skip。  
- 目标两家已被另一条 pending 占用时：保留三家那一行和它的旧 key，记 notes，不抢 key。  
- **真实 PostgreSQL**（现有一次性测试库，不连生产）：并发第二次插入同一 `member_key` 的 pending-key 失败后，该事务回滚，没有孤儿行；并且第二次在失败后能读到 **已存在的那条 pending**（不是只断言抛错）。文件放 `tests/integration/`，无测试库则跳过并在说明里写明；逻辑单测不能代替这一条。

---

## 9. 顺序

1. `toMemberKey` / `toCandidateKey` / evidence Zod。  
2. Schema + preflight / sync-a,b / preflight-2 / sync-c / postflight / rollback。  
3. apply 子集 + 统一锁 + 自动排除 + owner 子集。  
4. 勾选 UI。  
5. 检测 candidate_key、member_key skip（含 accepted）、reopen 恢复 key。  
6. 历史页与 operations / schema / types / validations 文案。

dump：检测仍三家；只并 407+409 后 WINGALD 的会社页和作品关系还在；再检测无 407+408。
