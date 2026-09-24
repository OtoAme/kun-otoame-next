# 会社合并：历史、重开、行上链接（一期）

日期：2026-09-22  
分支：`fix/company-ingestion`（dump 工作区）  
范围：只做操作员「事后看得见、误驳能重开、审核能点进会社」。**不做** unmerge、301、检测写权威别名、LLM、检测阶段 SSE、定时检测、驳回理由。

政策保持：源会社删除后 `/company/<id>` 404；检测仍不自动复活 dismissed 键；合并仍走冻结 writer。

---

## 产品

1. **行上会社链接**  
   待处理表每一家会社名可点，新标签打开站内 `/company/<id>`（与现网会社页一致）。`name === null`（已不存在）不可点，并标明已不存在。

2. **已驳回 / 已合并列表**  
   本页三个状态页签：待处理（默认）、已驳回、已合并。role ≥ 3。  
   列：时间（驳回/合并用 `resolvedAt`，待处理用 `detectedAt`）、类型、会社名与 id（冻结 `names[]`）、操作者（`resolvedByUserId`，能查到用户名更好，查不到就 `#id`）。  
   已合并额外标明留下的主会社 id，并可点进 `/company/<survivingId>`。

3. **重新打开**  
   仅已驳回行有「重新打开」确认框。把该行 `dismissed → pending`，清 `resolved_at` / `resolved_by_user_id`。检测逻辑不变：仍 skip **当前仍为 dismissed** 的键；重开后该键是 pending，再检测会刷新而不是 skip。  
   **不要**新建一行 pending。不要自动复活。

4. **合并成功收尾（小改）**  
   toast 带主会社 `#id` 和名称，并给 `/company/<id>` 的提示（可点的话更好）。不改 apply writer。

---

## API

- `GET /api/admin/company-merges?status=pending|dismissed|accepted`  
  缺省 `pending`。`private, no-store`。role ≥ 3。  
  历史行仍返回 `names` / ids；参与会社 live 字段按现逻辑，已删则为 `name: null`。  
  增加 `resolvedAt`、`resolvedByUserId`、可选 `resolvedByName`。

- `POST /api/admin/company-merges/reopen` body `{ id }`  
  仅 `status=pending` 守卫的反面：只更新 `dismissed` 行。成功 `{ id }`。找不到或非 dismissed 返回中文错误。

- 检测 skip 仍用 **当前** dismissed 行；重开后该行不再 dismissed。

校验放 `validations/companyMerges.ts`。前端 `kunFetch`，CSRF 走现有 header。

---

## UI（dashboard shadcn）

- `components/dashboard/ui`：Tabs、Table、Button、AlertDialog。禁止 HeroUI / `components/admin`。
- 页签切换不丢检测秒表状态（检测只在待处理语境下有意义；历史页也可显示同一套检测按钮或仅待处理页显示，选一种并写在实现注释里。推荐：检测按钮始终在，结果刷新当前页签）。
- 破坏性/状态变化：重开要确认；失败释放 loading、展示字符串错误。
- 链接：`target="_blank"` + `rel="noreferrer"`，键盘可及。

---

## 测试

- GET 默认只 pending；`status=dismissed|accepted` 返回对应行。
- reopen：dismissed → pending；pending/accepted 失败；检测随后把该 key 当 pending 刷新而不是 skip。
- 不写 `patch_company`。
- 列表/组件不强制 UI 单测；API/service 单测即可。

---

## 明确不做

301、unmerge、改 `user.prisma` 关系（可单独 `user.findMany`）、SSE、定时、LLM、改 normalize、改 apply 事务语义。

## 验证

```bash
pnpm test tests/unit/company-merge-suggestions.test.ts
pnpm typecheck
```

前端在 dump 的 `/dashboard/company-merges` 点三个页签、驳回后到已驳回再重开、合并后到已合并并能打开主会社页。
