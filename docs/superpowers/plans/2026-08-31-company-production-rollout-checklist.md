# 会社身份解析：生产上线历史执行清单

> 本文归档 2026-08-31 上线窗口的原始分阶段计划，仅供审计，不应作为下一次上线的可执行 runbook。当前部署流程以 `docs/project/deployment.md` 为准。

本文是 `2026-08-31-company-production-readiness.md` 的现场执行清单。设计依据仍以原计划为准；本文记录当时规划的推送、数据库迁移、生产脏数据清理、部署、验证与回滚顺序。

实际执行与原计划存在以下偏差：

- R1、R3、计数触发器、七组会社人工合并和 Phase B 最终约束均已完成，数据库 postflight 通过；
- 冻结 planner/apply 路径未用于最终数据写入，七组会社改由审核过的生产 SQL 在事务中合并；
- GitHub Release artifact 的 `deploy:pull` 候选 Prisma Client 生成路径仍未完成生产验证，当前禁用；
- 最终应用以 `66f42bcfee7fde810420178ee05c90dee560b095` 执行 `pnpm deploy:build`，三个 PM2 实例 online，loopback HTTP 返回 200；
- 清单归档时 resolver 仍关闭、反向代理维护页仍启用；缓存清理、flag-off/flag-on 烟雾测试和最终开放公网仍需按当前部署文档与现场记录完成。

本文不会授权任何未经审核的生产会社合并。人工合并必须写入 decisions；planner 还可能依据 VNDB authoritative identity 生成 `automatic` 提案，但它们同样必须在冻结 plan 中逐条人工复核。最终确认 plan SHA，才表示授权执行其中列出的全部 manual 与 automatic 动作。

## 命令执行规则

每次打开新的本地终端或生产 SSH 会话，先启用 Bash 严格模式：

```bash
set -Eeuo pipefail
```

后文每个代码块都是一个门禁。必须等当前代码块整体以退出码 0 完成并检查输出，才复制下一个代码块。严格模式下任一命令失败会终止当前 shell；重新登录后先查明原因，不得从失败块的下一行继续。preflight、sync、postflight、apply 与 cache 仍拆成独立代码块，避免一次粘贴跨越不可逆边界。

## 固定版本与数据库契约

| 阶段     | Commit                                     | 应用应连接的数据库状态    | Resolver                   |
| -------- | ------------------------------------------ | ------------------------- | -------------------------- |
| 当前远端 | `f077b7ff4181dc0950be60e11dffadd42689ea59` | 现有生产结构              | 不适用                     |
| R1       | `fec99a9594c659055c299c02283dd327e6091ad9` | Phase A、旧计数语义       | 尚未引入                   |
| R3       | `c617a158b7152b1847fbccb7bb06d4172b358b81` | Phase A、数据库计数触发器 | 必须关闭                   |
| R4       | `e0a0d8cada8e5741f64f4534a8b693ea81f908c8` | Phase B、数据库计数触发器 | 部署时关闭，烟雾测试后开启 |

三段提交必须保持以下祖先关系，不得 rebase、squash 或改写这些切点：

```bash
git merge-base --is-ancestor f077b7ff4181dc0950be60e11dffadd42689ea59 fec99a9594c659055c299c02283dd327e6091ad9
git merge-base --is-ancestor fec99a9594c659055c299c02283dd327e6091ad9 c617a158b7152b1847fbccb7bb06d4172b358b81
git merge-base --is-ancestor c617a158b7152b1847fbccb7bb06d4172b358b81 e0a0d8cada8e5741f64f4534a8b693ea81f908c8
```

任何一条命令非零退出都停止，不继续后面的阶段。

## 上线前固定生产 canary

生产烟雾会真实写入游戏、会社关系、投稿状态、通知与萌萌点账务。R3 flag-off、R4 flag-off 与 R4 flag-on 都需要独立验证，前一阶段已经创建的外部 ID 和已经批准的投稿不能复用。进入阶段 1 前，必须在私有上线记录中为 A/B/C 三组分别固定以下对象，本文不记录账号密码或 JWT：

- A 组用于 R3 flag-off，B 组用于 R4 flag-off，C 组用于 R4 flag-on；
- 每组都有一个经批准的创建账号，以及一条确实应收录、且外部 ID 尚未占用的不同真实游戏；
- 每组都有一个经批准的重写账号与不同现有游戏，改动应是真实、可审核的内容，不做无意义写入；
- 每组都有一条不同的、已完成内容审核、可以在对应维护窗口正式批准的真实投稿，以及对应审核员；
- 每项 canary 的外部 ID、预期会社关系、奖励/押金变化、通知接收人和执行后处理方式。

不要创建假游戏后直接删库，也不要用同一个外部 ID 反复试错。任一阶段没有完整的对应 canary 组时，该阶段 smoke 保持未完成并继续维护状态，不能复用前一阶段已经消费的投稿或伪造数据来绕过门禁。

## 先说明：生产只执行 `git pull` 会怎样

普通的 `git pull --ff-only` 只会更新服务器工作树和 Git 引用。它本身不会：

- 构建 Next.js；
- 替换正在运行的 standalone；
- 重启 PM2；
- 执行 Prisma Schema 同步或本文中的 SQL；
- 自动修改生产数据库。

因此，在没有 Git hook、自动部署守护进程、同目录 `next dev` 或其它自定义监听器的前提下，只拉代码不会立即影响在线进程或数据库。

但本次不能提前把生产主仓库直接拉到 R4。工作树中的 Prisma Schema、迁移和部署脚本会变成 R4，而在线应用与数据库可能仍停在 R1 或 R3，破坏本清单要求的版本对应关系。每次只在对应阶段把生产仓库快进到当时的目标 Commit。

## 阶段 0：本地最终门禁

- [ ] 确认本地除本清单外没有其它改动。
- [ ] 确认远端仍停在预期起点。
- [ ] 确认三个 Release Commit 的祖先链。
- [ ] 运行完整代码门禁。

```bash
cd /Users/saya/s1/projects/kun-otoame-next
git status --short
test "$(git status --porcelain)" = "?? docs/superpowers/plans/2026-08-31-company-production-rollout-checklist.md"
git fetch origin main
test "$(git rev-parse origin/main)" = "f077b7ff4181dc0950be60e11dffadd42689ea59"
git merge-base --is-ancestor f077b7ff4181dc0950be60e11dffadd42689ea59 fec99a9594c659055c299c02283dd327e6091ad9
git merge-base --is-ancestor fec99a9594c659055c299c02283dd327e6091ad9 c617a158b7152b1847fbccb7bb06d4172b358b81
git merge-base --is-ancestor c617a158b7152b1847fbccb7bb06d4172b358b81 e0a0d8cada8e5741f64f4534a8b693ea81f908c8
pnpm typecheck
pnpm test
pnpm build
git diff --check
git status --short
test "$(git status --porcelain)" = "?? docs/superpowers/plans/2026-08-31-company-production-rollout-checklist.md"
```

停止条件：远端 Commit 不符、祖先检查失败、测试失败、构建失败或工作区不干净。

## 阶段 1：推送并发布 R1

### 1.1 推送 R1

```bash
cd /Users/saya/s1/projects/kun-otoame-next
git push origin fec99a9594c659055c299c02283dd327e6091ad9:refs/heads/main
git fetch origin main
test "$(git rev-parse origin/main)" = "fec99a9594c659055c299c02283dd327e6091ad9"
```

不要继续推 R3。先等待 R1 的 Release workflow 完整结束，并记录 Release tag：

```bash
R1_RUN_ID="$(gh run list --workflow release.yml --commit fec99a9594c659055c299c02283dd327e6091ad9 --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$R1_RUN_ID"
gh run watch "$R1_RUN_ID" --exit-status
git fetch --tags origin
R1_TAG="$(git tag --sort=-creatordate --points-at fec99a9594c659055c299c02283dd327e6091ad9 | head -n 1)"
test -n "$R1_TAG"
test "$(git rev-list -n 1 "$R1_TAG")" = "fec99a9594c659055c299c02283dd327e6091ad9"
gh release view "$R1_TAG"
```

停止点：把 R1 Commit、workflow run ID 与 tag 记入上线记录。

### 1.2 生产先备份，再安装 Phase A

生产 shell 需要已经设置以下变量，但不要把环境文件内容打印到终端：

- `OTOAME_PG_CONTAINER`
- `OTOAME_PG_USER`
- `OTOAME_PG_DATABASE`

R1/R3 尚无 R4 的双槽部署保护。先从现有部署记录确认当前真正运行的 Release tag，并导出为 `CURRENT_DEPLOYED_TAG`；无法确认时显式写 `unknown`，不得用当前 Git HEAD 冒充。随后确认生产工作区为空，并在拉取 R1 之前保存当前运行时、Prisma Schema、BUILD_ID、安全裁剪后的 PM2 cwd/script、工作树 Commit 与实际部署 tag：

```bash
export CURRENT_DEPLOYED_TAG='请替换为实际 tag，无法确认则写 unknown'
test "$CURRENT_DEPLOYED_TAG" != '请替换为实际 tag，无法确认则写 unknown'
```

```bash
cd /root/kun-otoame-next
git status --short
test -z "$(git status --porcelain)"
umask 077
test ! -e /root/otoame-rollout/r1
install -d -m 700 /root/otoame-rollout/r1
test -d .next/standalone
test -n "${CURRENT_DEPLOYED_TAG:-}"
git rev-parse HEAD > /root/otoame-rollout/r1/worktree-before-r1.commit
git describe --tags --exact-match HEAD > /root/otoame-rollout/r1/worktree-before-r1.tag 2>/dev/null || printf 'untagged\n' > /root/otoame-rollout/r1/worktree-before-r1.tag
printf '%s\n' "$CURRENT_DEPLOYED_TAG" > /root/otoame-rollout/r1/runtime-before-r1.deployed-tag
test -f .next/standalone/.next/BUILD_ID
cp .next/standalone/.next/BUILD_ID /root/otoame-rollout/r1/runtime-before-r1.build-id
pm2 jlist | node -e 'let input = ""; process.stdin.on("data", (chunk) => (input += chunk)); process.stdin.on("end", () => { const safe = JSON.parse(input).map((app) => ({ name: app.name, pid: app.pid, cwd: app.pm2_env?.pm_cwd, script: app.pm2_env?.pm_exec_path, status: app.pm2_env?.status })); process.stdout.write(JSON.stringify(safe, null, 2) + "\n"); });' > /root/otoame-rollout/r1/runtime-before-r1.pm2.json
tar --dereference -czf /root/otoame-rollout/r1/runtime-before-r1.tar.gz .next/standalone prisma ecosystem.config.cjs package.json pnpm-lock.yaml
test -s /root/otoame-rollout/r1/runtime-before-r1.tar.gz
tar -tzf /root/otoame-rollout/r1/runtime-before-r1.tar.gz > /dev/null
sha256sum /root/otoame-rollout/r1/runtime-before-r1.tar.gz > /root/otoame-rollout/r1/runtime-before-r1.tar.gz.sha256
sha256sum -c /root/otoame-rollout/r1/runtime-before-r1.tar.gz.sha256
chmod 600 /root/otoame-rollout/r1/runtime-before-r1.* /root/otoame-rollout/r1/worktree-before-r1.*
```

再把生产工作树精确快进到 R1，并在生产端重新绑定已审核的 R1 tag：

```bash
cd /root/kun-otoame-next
git fetch origin main --tags
git pull --ff-only
test "$(git rev-parse HEAD)" = "fec99a9594c659055c299c02283dd327e6091ad9"
R1_TAG="$(git tag --sort=-creatordate --points-at fec99a9594c659055c299c02283dd327e6091ad9 | head -n 1)"
test -n "$R1_TAG"
test "$(git rev-list -n 1 "$R1_TAG")" = "fec99a9594c659055c299c02283dd327e6091ad9"
printf '%s\n' "$R1_TAG" > /root/otoame-rollout/r1/r1-release-tag.txt
chmod 600 /root/otoame-rollout/r1/r1-release-tag.txt
```

建立仓库外备份目录，备份并验证数据库：

```bash
docker exec "$OTOAME_PG_CONTAINER" pg_dump -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -Fc > /root/otoame-rollout/r1/before-phase-a.dump
test -s /root/otoame-rollout/r1/before-phase-a.dump
docker exec -i "$OTOAME_PG_CONTAINER" pg_restore --list < /root/otoame-rollout/r1/before-phase-a.dump > /dev/null
sha256sum /root/otoame-rollout/r1/before-phase-a.dump > /root/otoame-rollout/r1/before-phase-a.dump.sha256
sha256sum -c /root/otoame-rollout/r1/before-phase-a.dump.sha256
chmod 600 /root/otoame-rollout/r1/before-phase-a.dump /root/otoame-rollout/r1/before-phase-a.dump.sha256
```

依次执行 Phase A 的预检、同步和后检：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-bootstrap-preflight-2026-08-30.sql
```

确认 preflight 输出后，才执行 sync：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-bootstrap-sync-2026-08-30.sql
```

sync 成功后单独执行 postflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-bootstrap-postflight-2026-08-30.sql
```

### 1.3 部署 R1 并回填身份

```bash
cd /root/kun-otoame-next
R1_TAG="$(tr -d '[:space:]' < /root/otoame-rollout/r1/r1-release-tag.txt)"
test "$(git rev-list -n 1 "$R1_TAG")" = "fec99a9594c659055c299c02283dd327e6091ad9"
test "$(git rev-parse HEAD)" = "fec99a9594c659055c299c02283dd327e6091ad9"
KUN_DEPLOY_RELEASE_TAG="$R1_TAG" pnpm exec esno scripts/deployPull.ts
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

先 dry-run，确认输出后再 apply，最后第二次 dry-run 必须收敛为零待写项：

```bash
cd /root/kun-otoame-next
pnpm maintenance:companies:identity:dry
```

确认 dry-run 后单独执行 apply：

```bash
cd /root/kun-otoame-next
pnpm maintenance:companies:identity:apply
```

apply 完成后再次 dry-run：

```bash
cd /root/kun-otoame-next
pnpm maintenance:companies:identity:dry
```

最后重跑 Phase A postflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-bootstrap-postflight-2026-08-30.sql
```

停止条件：身份 dry-run 不收敛、postflight 出现结构错误、站点健康检查失败。此时不要推 R3。

## 阶段 2：推送并发布 R3

### 2.1 推送 R3

```bash
cd /Users/saya/s1/projects/kun-otoame-next
git push origin c617a158b7152b1847fbccb7bb06d4172b358b81:refs/heads/main
git fetch origin main
test "$(git rev-parse origin/main)" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
```

等待 workflow 并记录 R3 tag：

```bash
R3_RUN_ID="$(gh run list --workflow release.yml --commit c617a158b7152b1847fbccb7bb06d4172b358b81 --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$R3_RUN_ID"
gh run watch "$R3_RUN_ID" --exit-status
git fetch --tags origin
R3_TAG="$(git tag --sort=-creatordate --points-at c617a158b7152b1847fbccb7bb06d4172b358b81 | head -n 1)"
test -n "$R3_TAG"
test "$(git rev-list -n 1 "$R3_TAG")" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
gh release view "$R3_TAG"
```

### 2.2 生产安装计数触发器

先在拉取 R3 之前保存正在运行的 R1，再把生产仓库精确快进到 R3：

```bash
cd /root/kun-otoame-next
git status --short
test -z "$(git status --porcelain)"
umask 077
test ! -e /root/otoame-rollout/r3
install -d -m 700 /root/otoame-rollout/r3
test -d .next/standalone
git rev-parse HEAD > /root/otoame-rollout/r3/worktree-before-r3.commit
git describe --tags --exact-match HEAD > /root/otoame-rollout/r3/worktree-before-r3.tag 2>/dev/null || printf 'untagged\n' > /root/otoame-rollout/r3/worktree-before-r3.tag
cp /root/otoame-rollout/r1/r1-release-tag.txt /root/otoame-rollout/r3/runtime-before-r3.deployed-tag
test -f .next/standalone/.next/BUILD_ID
cp .next/standalone/.next/BUILD_ID /root/otoame-rollout/r3/runtime-before-r3.build-id
pm2 jlist | node -e 'let input = ""; process.stdin.on("data", (chunk) => (input += chunk)); process.stdin.on("end", () => { const safe = JSON.parse(input).map((app) => ({ name: app.name, pid: app.pid, cwd: app.pm2_env?.pm_cwd, script: app.pm2_env?.pm_exec_path, status: app.pm2_env?.status })); process.stdout.write(JSON.stringify(safe, null, 2) + "\n"); });' > /root/otoame-rollout/r3/runtime-before-r3.pm2.json
tar --dereference -czf /root/otoame-rollout/r3/runtime-before-r3.tar.gz .next/standalone prisma ecosystem.config.cjs package.json pnpm-lock.yaml
test -s /root/otoame-rollout/r3/runtime-before-r3.tar.gz
tar -tzf /root/otoame-rollout/r3/runtime-before-r3.tar.gz > /dev/null
sha256sum /root/otoame-rollout/r3/runtime-before-r3.tar.gz > /root/otoame-rollout/r3/runtime-before-r3.tar.gz.sha256
sha256sum -c /root/otoame-rollout/r3/runtime-before-r3.tar.gz.sha256
chmod 600 /root/otoame-rollout/r3/runtime-before-r3.* /root/otoame-rollout/r3/worktree-before-r3.*
git fetch origin main --tags
git pull --ff-only
test "$(git rev-parse HEAD)" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
R3_TAG="$(git tag --sort=-creatordate --points-at c617a158b7152b1847fbccb7bb06d4172b358b81 | head -n 1)"
test -n "$R3_TAG"
test "$(git rev-list -n 1 "$R3_TAG")" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
printf '%s\n' "$R3_TAG" > /root/otoame-rollout/r3/r3-release-tag.txt
chmod 600 /root/otoame-rollout/r3/r3-release-tag.txt
```

应用仍在线时，单独运行只读 count preflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-preflight-2026-08-30.sql
```

确认反向代理维护页能阻断公开写请求，再停止应用。不要用“操作很快”代替停写：

```bash
pm2 stop kun-touchgal-next
pm2 status
```

再次备份数据库：

```bash
cd /root/kun-otoame-next
docker exec "$OTOAME_PG_CONTAINER" pg_dump -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -Fc > /root/otoame-rollout/r3/before-count-triggers.dump
test -s /root/otoame-rollout/r3/before-count-triggers.dump
docker exec -i "$OTOAME_PG_CONTAINER" pg_restore --list < /root/otoame-rollout/r3/before-count-triggers.dump > /dev/null
sha256sum /root/otoame-rollout/r3/before-count-triggers.dump > /root/otoame-rollout/r3/before-count-triggers.dump.sha256
sha256sum -c /root/otoame-rollout/r3/before-count-triggers.dump.sha256
chmod 600 /root/otoame-rollout/r3/before-count-triggers.dump /root/otoame-rollout/r3/before-count-triggers.dump.sha256
```

在应用停止期间安装计数触发器并检查不变量：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-sync-2026-08-30.sql
```

sync 完成后单独运行 postflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

此时不能恢复 R1：R1 仍会手工增减计数，与数据库触发器同时运行会双计数。先以退出码确认 resolver 未配置或精确为 `false`，不打印环境内容：

```bash
cd /root/kun-otoame-next
node --env-file=.env -e 'const value = process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED; if (value !== undefined && value !== "false") process.exit(1)'
```

再用审核过的 R3 tag 直接调用旧版部署脚本，绕过 package 中会再次 `git pull` 的包装命令：

```bash
cd /root/kun-otoame-next
R3_TAG="$(tr -d '[:space:]' < /root/otoame-rollout/r3/r3-release-tag.txt)"
test "$(git rev-list -n 1 "$R3_TAG")" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
test "$(git rev-parse HEAD)" = "c617a158b7152b1847fbccb7bb06d4172b358b81"
KUN_DEPLOY_RELEASE_TAG="$R3_TAG" pnpm exec esno scripts/deployPull.ts
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

部署后单独重跑 count postflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

使用预先批准的 A 组完成 flag-off 的创建、重写和投稿批准最小烟雾测试。写入完成后再次运行 count postflight，用它捕获应用与触发器重复计数、漏计数或 UPDATE 路径错误：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

只有 A 组 smoke 与写入后的 postflight 都通过，才关闭维护页。

停止条件：触发器 postflight 失败、R3 启动失败、flag-off 烟雾失败。若必须退回 R1，先按“回滚”一节撤销计数触发器，不能直接启动 R1。

## 阶段 3：推送 R4，但生产暂时继续运行 R3

```bash
cd /Users/saya/s1/projects/kun-otoame-next
git push origin e0a0d8cada8e5741f64f4534a8b693ea81f908c8:refs/heads/main
git fetch origin main
test "$(git rev-parse origin/main)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
```

等待 R4 workflow，记录 tag，并检查 Release：

```bash
R4_RUN_ID="$(gh run list --workflow release.yml --commit e0a0d8cada8e5741f64f4534a8b693ea81f908c8 --limit 1 --json databaseId --jq '.[0].databaseId')"
test -n "$R4_RUN_ID"
gh run watch "$R4_RUN_ID" --exit-status
git fetch --tags origin
R4_TAG="$(git tag --sort=-creatordate --points-at e0a0d8cada8e5741f64f4534a8b693ea81f908c8 | head -n 1)"
test -n "$R4_TAG"
test "$(git rev-list -n 1 "$R4_TAG")" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
gh release view "$R4_TAG"
```

到这里，生产主仓库仍应停在 R3。不要在生产主仓库执行普通 `git pull`，不要运行 Phase B，也不要开启 resolver。

## 阶段 4：从 R4 独立工作树盘点生产重复会社

### 4.1 准备独立维护工作树

R4 维护 CLI 要在仓库外的 detached worktree 中运行，避免提前改变仍用于 R3 部署的主仓库：

```bash
export COMPANY_RUN_ID='20260831-r4-a1'
export COMPANY_AUDIT_DIR="/var/lib/kun-otoame/maintenance/company/$COMPANY_RUN_ID"
export R4_WORKTREE='/root/kun-otoame-maintenance-r4'
cd /root/kun-otoame-next
git fetch origin main --tags
test "$(git rev-parse origin/main)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
if test -d "$R4_WORKTREE"; then
  test "$(git -C "$R4_WORKTREE" rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
else
  git worktree add --detach "$R4_WORKTREE" e0a0d8cada8e5741f64f4534a8b693ea81f908c8
fi
cd "$R4_WORKTREE"
pnpm install --frozen-lockfile --ignore-scripts
pnpm prisma generate
test -z "$(git status --porcelain --untracked-files=normal)"
```

`COMPANY_RUN_ID` 每次尝试必须唯一。发生漂移或计划失败时，把后缀递增为 `a2`、`a3`，重新执行阶段 4–5；旧目录只读保留，不覆盖、不删除。重新登录 SSH 后，需要重新导出同一 attempt 的三个变量。

此时数据库仍是“Phase A + 计数触发器”，禁止在这个 R4 worktree 中运行：

```text
pnpm prisma:deploy-safe
```

### 4.2 生成只读生产 inventory

```bash
umask 077
test ! -e "$COMPANY_AUDIT_DIR"
install -d -m 700 "$COMPANY_AUDIT_DIR"
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:inventory --out="$COMPANY_AUDIT_DIR/company-inventory.json"
chmod 600 "$COMPANY_AUDIT_DIR/company-inventory.json" "$COMPANY_AUDIT_DIR/company-inventory.json.sha256"
test "$(sha256sum "$COMPANY_AUDIT_DIR/company-inventory.json" | cut -d ' ' -f 1)" = "$(tr -d '[:space:]' < "$COMPANY_AUDIT_DIR/company-inventory.json.sha256")"
```

### 4.3 强制人工停点：不能自动合并

- [ ] 私下提供 `company-inventory.json` 与 `.sha256`，不要贴到公开 issue、聊天或日志系统。
- [ ] 逐组判断 canonical company、需要合并的 source、保留谁的 owner 与 introduction。
- [ ] 只有明确无用的公司才进入 `deletions`；零作品关系本身不是删除理由。
- [ ] 不按本地开发库 ID 制作生产 decisions。
- [ ] 不依据名称相似、大小写、全半角、共享 legacy alias、相同域名或关系数为零自动合并。
- [ ] 对证据不足的组保持原样，待以后维护。

确认后生成 canonical `company-decisions.json`。它必须引用 inventory 中的 opaque company ref，并绑定该 inventory 的 SHA；不要直接修改 inventory。

这是本次上线最重要的人工停点。在 decisions 和 SHA 未经确认前，不生成 apply 计划、不执行 Phase B。

人工先在同一审计目录准备 `company-decisions.draft.json`。最小结构如下；实际合并必须使用 inventory 中的 opaque ref，并逐条填写保留 owner、introduction 与理由：

```json
{
  "schemaVersion": 1,
  "inventorySha256": "替换为 company-inventory.json.sha256 中的 64 位摘要",
  "merges": [],
  "deletions": []
}
```

不要把人工编辑的 draft 直接交给 planner。使用仓库的 schema 与 canonical serializer 生成只读最终文件；该命令会拒绝未知字段、错误结构、非安全目录和覆盖已有文件：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
test -f "$COMPANY_AUDIT_DIR/company-decisions.draft.json"
test ! -L "$COMPANY_AUDIT_DIR/company-decisions.draft.json"
chmod 600 "$COMPANY_AUDIT_DIR/company-decisions.draft.json"
DECISIONS_DRAFT="$COMPANY_AUDIT_DIR/company-decisions.draft.json" DECISIONS_FINAL="$COMPANY_AUDIT_DIR/company-decisions.json" pnpm exec esno -e 'import { readFile } from "node:fs/promises"; import { companyCleanupDecisionsSchema, serializeCanonicalJson, writeProtectedArtifact } from "./scripts/companyCleanupFrozenContract"; void (async () => { const draftPath = process.env.DECISIONS_DRAFT; const finalPath = process.env.DECISIONS_FINAL; if (!draftPath || !finalPath) throw new Error("Decision paths are required"); const draft = JSON.parse(await readFile(draftPath, "utf8")); const parsed = companyCleanupDecisionsSchema.parse(draft); await writeProtectedArtifact(finalPath, serializeCanonicalJson(parsed)); })().catch((error) => { console.error(error); process.exit(1); });'
chmod 600 "$COMPANY_AUDIT_DIR/company-decisions.json"
```

`maintenance:companies:plan --manual-only` 会再次验证 schema、canonical 字节与 inventory SHA，只消费 decisions 中明确列出的人工动作，不访问 VNDB，也不生成 automatic merge。

## 阶段 5：生成冻结计划并 dry-run

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:plan --manual-only --inventory="$COMPANY_AUDIT_DIR/company-inventory.json" --decisions="$COMPANY_AUDIT_DIR/company-decisions.json" --out="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
```

plan 生成成功后单独运行 dry-run：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:dry --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
```

人工核对以下内容：

- [ ] blockers 为 0；
- [ ] 每个 source/target 与审核决定一致；
- [ ] 每条 merge 都来自已审核的 decisions，且 `kind` 全部为 `manual`；
- [ ] owner、introduction、alias、语言、来源网站和母品牌保留策略正确；
- [ ] expected post-state 移除的会社恰好等于已审核 merge 的 source 与显式 deletion，没有其它 ID；
- [ ] relations 与受影响游戏数量在预期内；
- [ ] plan sidecar SHA 与待执行文件一致；
- [ ] dry-run 没有访问外部网络，也没有写数据库。

若 inventory 在此期间已经漂移，废弃当前 decisions/plan，重新从阶段 4 开始。不要修改 plan 文件绕过漂移检查。

## 阶段 6：最终停写、清理生产脏数据并安装 Phase B

### 6.1 进入维护窗口并做最终备份

先启用反向代理维护页，确认公网创建、重写和投稿批准均不可写，再停止应用：

```bash
pm2 stop kun-touchgal-next
pm2 status
```

做最终数据库备份：

```bash
umask 077
test ! -e /root/otoame-rollout/r4
install -d -m 700 /root/otoame-rollout/r4
docker exec "$OTOAME_PG_CONTAINER" pg_dump -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" -Fc > /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump
test -s /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump
docker exec -i "$OTOAME_PG_CONTAINER" pg_restore --list < /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump > /dev/null
sha256sum /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump > /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump.sha256
sha256sum -c /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump.sha256
chmod 600 /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump /root/otoame-rollout/r4/before-company-cleanup-and-phase-b.dump.sha256
```

### 6.2 停写后再次 dry-run

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:dry --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
```

如有漂移，保持维护状态，重新 inventory、重审 decisions、重建 plan 和 SHA。禁止强制执行旧计划。

### 6.3 apply 与独立缓存收尾

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
PLAN_SHA256="$(tr -d '[:space:]' < "$COMPANY_AUDIT_DIR/company-cleanup-plan.json.sha256")"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:apply --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json" --confirm-sha256="$PLAN_SHA256"
```

apply 成功后单独执行缓存收尾：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:cache --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
```

若数据库 apply 已成功而 cache 失败，只重跑 `dirty:cache`。不要重新规划，也不要再次手动改数据库。

验证清理已经收敛：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:dry --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:inventory --out="$COMPANY_AUDIT_DIR/company-inventory-after.json"
```

### 6.4 安装 Phase B 最终约束

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-preflight-2026-08-30.sql
```

只有 preflight 没有阻断项，才执行 Phase B sync：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-sync-2026-08-30.sql
```

sync 成功后，分别运行身份约束与计数 postflight：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-postflight-2026-08-30.sql
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

停止条件：清理未收敛、Phase B preflight 有阻断项、sync 失败或任一 postflight 失败。保持维护状态，不继续部署 R4。

## 阶段 7：部署 R4，先保持 resolver 关闭

### 7.1 将生产主仓库精确快进到 R4

```bash
cd /root/kun-otoame-next
git status --short
test -z "$(git status --porcelain)"
git fetch origin main --tags
test "$(git rev-parse origin/main)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
git merge --ff-only e0a0d8cada8e5741f64f4534a8b693ea81f908c8
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
R4_TAG="$(git tag --sort=-creatordate --points-at e0a0d8cada8e5741f64f4534a8b693ea81f908c8 | head -n 1)"
test -n "$R4_TAG"
test "$(git rev-list -n 1 "$R4_TAG")" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
```

确认生产环境的 resolver 未配置或精确为 `false`，然后使用 pinned Release 部署：

```bash
cd /root/kun-otoame-next
node --env-file=.env -e 'const value = process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED; if (value !== undefined && value !== "false") process.exit(1)'
R4_TAG="$(git tag --sort=-creatordate --points-at e0a0d8cada8e5741f64f4534a8b693ea81f908c8 | head -n 1)"
test -n "$R4_TAG"
KUN_DEPLOY_RELEASE_TAG="$R4_TAG" pnpm deploy:pull:pinned
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

R4 的 pinned 部署会校验 tag、manifest、Commit、候选 Prisma Schema 和 immutable release slot。任何校验失败都不得手动复制 artifact 覆盖当前槽。

### 7.2 resolver=false 烟雾测试

本阶段只使用预先批准的 B 组：

- [ ] 首页、登录页、游戏详情页正常；
- [ ] 创建一条测试游戏，会社关系正确；
- [ ] 重写一条测试游戏，会社关系正确；
- [ ] 投稿预览与批准成功，预览会社与发布结果一致；
- [ ] 无 Prisma Schema 错误；
- [ ] 无 `normalized_name` 或 external ID 唯一冲突残留；
- [ ] 公司与标签计数 postflight 仍通过。

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-postflight-2026-08-30.sql
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

## 阶段 8：开启 resolver 并恢复公网

把生产环境中的 `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED` 改为 `true`，不要把环境文件打印到输出。让 PM2 重新加载环境变量：

```bash
cd /root/kun-otoame-next
node --env-file=.env -e 'if (process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED !== "true") process.exit(1)'
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

再次执行最小烟雾测试：

本阶段只使用预先批准的 C 组：

- [ ] VNDB / Bangumi / Steam 获取信息正常；
- [ ] 同一家会社的权威名称或别名解析到 canonical company；
- [ ] 不同开发商、发行商、移植商仍保持为不同会社；
- [ ] 创建与重写成功后，即使会社存在非阻断 warning，也不会误报整个保存失败；
- [ ] 投稿预览与批准使用相同解析结果；
- [ ] 会社列表、会社详情、受影响游戏页面和缓存内容正确。

最终重跑两个 postflight：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-postflight-2026-08-30.sql
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-postflight-2026-08-30.sql
```

全部通过后才关闭维护页，恢复公网写入。保留 previous release slot、数据库备份和审计目录，不要在同一上线窗口立即清理。

## 回滚清单

### R1 / Phase A 失败

Phase A 是加法迁移。若 R1 无法运行，保持维护状态，验证并恢复 R1 前保存的 standalone；不要删除新列或身份表：

```bash
cd /root/kun-otoame-next
sha256sum -c /root/otoame-rollout/r1/runtime-before-r1.tar.gz.sha256
tar -tzf /root/otoame-rollout/r1/runtime-before-r1.tar.gz > /dev/null
pm2 stop kun-touchgal-next || true
install -d -m 700 /root/otoame-rollout/failed-runtime
FAILED_RUNTIME="/root/otoame-rollout/failed-runtime/r1-$(date +%Y%m%d%H%M%S)"
test ! -e "$FAILED_RUNTIME"
install -d -m 700 "$FAILED_RUNTIME"
if test -d .next/standalone; then mv .next/standalone "$FAILED_RUNTIME/standalone"; fi
tar -xzf /root/otoame-rollout/r1/runtime-before-r1.tar.gz -C /root/kun-otoame-next .next/standalone
test -f .next/standalone/server.mjs || test -f .next/standalone/server.js
pm2 delete kun-touchgal-next || true
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
git status --short
test -z "$(git status --porcelain)"
```

上面的归档只恢复 `.next/standalone`；当前源码、Prisma、package/lock 与 Git HEAD 保持不变，避免产生“运行时是 R1、工作树却是半个 R1”的脏状态。恢复后不要运行旧 `deploy:pull`；先排查 R1 失败，再按正式顺序前进。失败的旧 runtime 已归档到 `/root/otoame-rollout/failed-runtime/`，可供事后分析。

### R3 或计数触发器失败

若计数触发器已经安装，禁止直接恢复 R1。保持维护状态，先执行：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-rollback-2026-08-30.sql
```

用 preflight 确认目标触发器已撤销且计数无偏差：

```bash
cd /root/kun-otoame-next
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-tag-company-count-preflight-2026-08-30.sql
```

随后验证并恢复保存的 R1 runtime：

```bash
cd /root/kun-otoame-next
sha256sum -c /root/otoame-rollout/r3/runtime-before-r3.tar.gz.sha256
tar -tzf /root/otoame-rollout/r3/runtime-before-r3.tar.gz > /dev/null
pm2 stop kun-touchgal-next || true
install -d -m 700 /root/otoame-rollout/failed-runtime
FAILED_RUNTIME="/root/otoame-rollout/failed-runtime/r3-$(date +%Y%m%d%H%M%S)"
test ! -e "$FAILED_RUNTIME"
install -d -m 700 "$FAILED_RUNTIME"
if test -d .next/standalone; then mv .next/standalone "$FAILED_RUNTIME/standalone"; fi
tar -xzf /root/otoame-rollout/r3/runtime-before-r3.tar.gz -C /root/kun-otoame-next .next/standalone
test -f .next/standalone/server.mjs || test -f .next/standalone/server.js
pm2 delete kun-touchgal-next || true
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
git status --short
test -z "$(git status --porcelain)"
```

是否恢复数据库备份必须另行人工批准。

### 会社清理数据库成功、缓存失败

只重跑缓存：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
DOTENV_CONFIG_PATH=/root/kun-otoame-next/.env pnpm maintenance:companies:dirty:cache --plan="$COMPANY_AUDIT_DIR/company-cleanup-plan.json"
```

### resolver=true 烟雾失败

第一层回退只关闭 resolver，不回滚应用或数据库。保持维护页，把生产环境中的 `KUN_COMPANY_IDENTITY_RESOLVER_ENABLED` 恢复为 `false`，然后重新加载环境并验证 flag-off 服务：

```bash
cd /root/kun-otoame-next
node --env-file=.env -e 'if (process.env.KUN_COMPANY_IDENTITY_RESOLVER_ENABLED !== "false") process.exit(1)'
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

只有 resolver=false 后应用仍无法运行，才进入下一节的 deployment rollback。

### R4 应用启动失败

先保持 resolver=false，使用本地 previous slot 回滚应用：

```bash
cd /root/kun-otoame-next
pnpm deploy:rollback
pm2 status
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

R3 的兼容层应能连接 Phase B。只有 R3 在 resolver=false 下仍无法运行，才在持续停写状态下撤销 Phase B 最终约束：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-rollback-2026-08-30.sql
```

rollback 成功后单独运行回退 postflight：

```bash
cd "$R4_WORKTREE"
test "$(git rev-parse HEAD)" = "e0a0d8cada8e5741f64f4534a8b693ea81f908c8"
test -z "$(git status --porcelain --untracked-files=normal)"
docker exec -i "$OTOAME_PG_CONTAINER" psql -X --set ON_ERROR_STOP=on -U "$OTOAME_PG_USER" -d "$OTOAME_PG_DATABASE" < migration/production-company-identity-constraint-rollback-postflight-2026-08-30.sql
```

不要未经人工确认直接执行 `pg_restore`。数据库整库恢复会覆盖上线窗口之后的全部写入，只能作为最后手段。

## 明确禁止

- 不在生产运行 `prisma db push`。
- 不一次性把远端 `main` 从当前版本推到 R4。
- 不在 R1 和 R3 Release 完成、生产阶段验收之前继续推下一段。
- 不在生产主仓库提前 `git pull` 到 R4。
- 不在 Phase A 数据库上运行 R4 的 `pnpm prisma:deploy-safe`。
- 不在计数触发器已经安装后启动 R1。
- 不在 Phase B 安装前开启 resolver。
- 不把本地开发库的 company ID 或合并结论复制到生产。
- 不依据名称相似、共享 alias、域名相同或零关系自动合并、删除会社。
- 不修改冻结 plan 绕过 SHA 或漂移检查。
- 不在 apply 成功、cache 失败时重新 apply 数据库。
- 不在未验证备份可读的情况下执行结构迁移或清理。
- 不把数据库 dump、inventory、decisions、plan、receipt 或环境文件提交进 Git。

## 必须人工确认的停点

1. R1 workflow 与 Release tag 已核对，才执行 Phase A。
2. R1 identity dry/apply/dry 已收敛，才推 R3。
3. R3 计数 postflight 与 flag-off 烟雾通过，才推 R4。
4. 生产 inventory 与 decisions 已逐条审核，才生成冻结 plan。
5. plan、SHA、dry-run 与最终停写后快照一致，才 apply。
6. 清理收敛并通过 Phase B postflight，才部署 R4。
7. R4 resolver=false 烟雾通过，才开启 resolver。
8. resolver=true 烟雾与最终 postflight 通过，才恢复公网。
