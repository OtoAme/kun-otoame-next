#!/usr/bin/env bash
# 萌萌点重构 —— 剩余步骤
#
# 背景：所有代码编辑已完成，但 Bash 安全分类器长时间不可用，
# 导致 git / rm / pnpm 全部无法执行。以下是需要人工执行的部分。
#
# 用法：bash migration/moemoepoint-rework-finish.sh
# 或者逐段复制执行（推荐，这样能在每步之间检查结果）。

set -euo pipefail
cd "$(dirname "$0")/.."

echo '=== 1. 建分支并快照员工的实现 ==============================='
# 员工的实现目前仍是 untracked，必须先提交，否则下一步的删除不可恢复。
git checkout -b feat/moemoepoint-rework
git add -A
git commit -m "chore(moemoepoint): snapshot implementation before rework

Snapshot of the moemoepoint ledger implementation as delivered, plus the
rework edits. Everything under app/api/moemoepoint and the new routes was
untracked; committing first keeps the original recoverable."

echo '=== 2. 删除下线的排行榜与旧流水页 ==========================='
# 已逐一核对：没有任何存活文件引用这六个路径。
# 注意不要删 app/api/user/[id]/moemoepoint/ledger/ —— 新组件仍在调它。
git rm -r --quiet \
  components/ranking/RankingNavigation.tsx \
  components/ranking/MoemoepointRankingContainer.tsx \
  app/ranking/moemoepoint \
  app/api/ranking/moemoepoint \
  'app/user/[id]/moemoepoint' \
  components/user/moemoepoint

echo '=== 3. 静态验证 ============================================='
# 删除之前 typecheck 必然失败（那两个 ranking 文件还 import 已移除的
# getMoemoepointRanking），删完应该干净。
pnpm typecheck
pnpm vitest run

echo '=== 4. 还原三个文件的 CRLF 行尾 ============================='
# HEAD 里这三个文件是 CRLF，被整份改写成了 LF，git diff 全是噪音：
#   CheckIn.tsx           63/59 行  → 实际 7/3
#   Username.tsx         125/122 行 → 实际 11/8
#   FileUploadContainer  145/143 行 → 实际 3/1
# 将来 rebase/cherry-pick upstream 会全是冲突。
for f in \
  components/kun/top-bar/user/CheckIn.tsx \
  components/settings/user/Username.tsx \
  components/patch/resource/upload/FileUploadContainer.tsx
do
  python3 - "$f" <<'PY'
import sys
p = sys.argv[1]
data = open(p, 'rb').read()
data = data.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
open(p, 'wb').write(data)
print(f'  restored CRLF: {p}')
PY
done

echo '--- 确认 diff 恢复成个位数改动 ---'
git diff --stat -- \
  components/kun/top-bar/user/CheckIn.tsx \
  components/settings/user/Username.tsx \
  components/patch/resource/upload/FileUploadContainer.tsx

echo '=== 5. 提交重构 ============================================='
git add -A
git commit -m "refactor(moemoepoint): move ledger to /moemoepoint, fix reason overflow

Move the private ledger out of the public /user/[id] profile segment into a
dedicated /moemoepoint section, add a public rules page, and move admin audit
to /admin/user/[id]/moemoepoint.

Fixes a P0: a game name over ~485 chars pushed the ledger reason past its
VarChar(500) column and the service threw, rolling back the whole publish
transaction after the banner had already been uploaded to S3. The service now
truncates instead of throwing.

Also rate-limits the like routes (every toggle writes a permanent ledger row),
drops idempotency keys that could not be stable across retries, and retires the
moemoepoint ranking so /ranking returns to its upstream state."

echo
echo '=== 6. 手工验证清单（pnpm dev） ============================='
cat <<'CHECKS'
  [ ] /moemoepoint 未登录 → 友好错误；登录 → 三态余额 + 流水
  [ ] 7天/30天切换立即刷新；自定义日期显示「请选择日期范围后点击查询」空态
  [ ] /moemoepoint/rules 未登录也能看
  [ ] /ranking 与 HEAD 一致（无萌萌点 tab）；/ranking/moemoepoint 301 到 /moemoepoint
  [ ] 顶栏与移动端菜单都有「萌萌点」；面包屑正常
  [ ] 后台用户表流水图标 → /admin/user/<id>/moemoepoint；非管理员访问被 redirect
  [ ] P0 回归：400+ 字游戏名建游戏 → 成功，reason 被截断，无 500
  [ ] 快速反复点赞 → 触发限流，不产生无限流水行
  [ ] 负余额账号 → 余额卡和资料页显示负值而不是 0
CHECKS
