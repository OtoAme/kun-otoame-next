# 用户工作台与链接维护验收

2026-10-19，契约版本 1。用户工作台、本人内容管理、链接维护和兼容入口已整合至根工作区；
真实接口、迁移与浏览器验收完成。实现及边界见[契约](13-workspace-maintenance-contract.md)
和[工作台模块](../../docs/reference/workspace.md)。本记录不代表生产部署完成。

## 源码与交付

- 基线：`14945e303958f383a6787fdffd05c4d459dfef8c`。
- 应用代码提交：`0e58a0ddbdb9847a01d8fc3ed954ddf4760f3370`。
- 106 个应用、迁移和测试文件的逐文件 SHA-256 见
  [源码清单](14-workspace-maintenance-source.json)。聚合 SHA-256：
  `a89845138f1ffdb660ead92d5214bf92bbde49e41124a3ac63ccfaa7014859e7`。
  算法为按路径排序后，对每行 `文件 SHA-256 + 两个空格 + 路径 + LF` 的 UTF-8 字节计算 SHA-256。
- 根工作区与生产构建使用的独立源码副本逐文件一致。构建 ID：`xAViiRobgM5u1DvN7uaIH`。
- 后端为原 GPT-6.1 Sol 会话交付的 48 个文件，前端为原 Grok 4.7 会话交付的 47 个文件；
  Astra 负责其余 11 个共享契约、路由与验收文件，并完成审阅和整合。
- 实施 Orca Run：`run_aa2b4655f8c5`。原作者会话保留供后续维护。
- 106 个代码文件独立提交；文档与 skills 随本记录单独提交。验收绑定上述应用提交及
  源码清单，提交内容已逐文件复核，与受验版本一致。

`IssueImageField.tsx`、`resourcePermissions.ts`、共享 dashboard UI 和
`LinkHealthDot.tsx` 与基线相同。四个原有 `tmp-*.ts` 用户文件和忽略目录 `backup/`
未纳入交付、未修改。未推送、未部署，未迁移现有持久数据库。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 独立源码全量 Vitest | 340 个文件通过，1 个文件跳过；3495 项通过，1 项跳过 |
| 根工作区与独立源码 `pnpm typecheck` | 均通过 |
| Prisma client 生成、schema guard | 通过 |
| 文档契约 | 46 项通过 |
| 独立 ESLint | `app`、`components`、`lib` 通过；仅排除下述两个未改动文件 |
| 独立源码生产构建 | `pnpm build --no-lint` 通过，包含 Next 类型检查、215 个静态页面与 postbuild |
| 实际 standalone 产物 | 20 组接口／事务检查、3 组浏览器检查通过 |
| PostgreSQL 迁移 | 首次安装、锁超时回滚、只读检查、幂等及真实运行后重跑通过 |
| 文件审计 | 作者清单、根工作区和受验源码哈希一致，冻结文件未改动，diff 无空白错误 |

全量测试在独立源码副本执行，`DOTENV_CONFIG_PATH=/dev/null`，使用不可连接的合成单元
数据库地址；`GIT_DIR` 只提供基线仓库的只读元数据，供既有会社 planner 测试读取 HEAD。
命令为 `pnpm test --maxWorkers=2`。整链使用单独的 PostgreSQL 18、Redis、3100 端口
standalone 服务、本机受控 checker 和对象存储替身；没有请求真实分享或远端对象存储。

### 接口与事务

真实 HTTP、服务和数据库断言共同覆盖以下行为；浏览器读取和写入连接实际 standalone API。

- 本人查询、详情、更新和删除范围；未知字段、伪造归属及角色拒绝；无贡献用户可进入工作台，
  普通用户不可进入管理员后台。管理读取不产生 grant 或获取记录。
- 受保护引用拒绝额外字段、缺槽、重排及删除；待审／封禁作者资源在新旧写入口均只读。
- 并发有效首报只有一个维护事件和一条发布者通知；事项清单与角标去重。
- 服务器决定暂缓期限，检测前与落库时双重冻结；在途反馈无法绕过；到期仍是同轮且不重发通知。
- 停止、重开、重复及零权反馈、新地址版本、同版本改码和 409 旧基点保持规定边界。
- 维护核实与健康结案对同一报告者合并结果通知；纯机器异常不制造用户事件或催办。
- 七天健康超时在暂缓期间继续执行；健康结案与维护回应各自独立；私有说明不进入公开摘要。
- 新旧精确事项通知地址均可读取及标记已读，不影响其他收件人；兼容跳转保留合法筛选。
- 维护列表、分页与待办口径一致；资源不可见时原有合法事项仍保留入口及一次计数。
- 整份资源删除保留必要历史、账务只回退一次、结果通知合并；移动保留轮次、版本和通知标记。
- 实际 multipart 上传拒绝他人素材，以登记信息覆盖伪造 metadata，成功只消费一次，支持后续编辑。
- 站方争议通知保留，普通发布者只接收维护首报；公开资源顺序不随健康变化移动。

### 浏览器

360、390、1280px 检查布局、长输入、取消零写入、失败及 409 后保留草稿与原始基点、
后台刷新不覆盖草稿。维护弹窗失败时保留说明；待审／封禁详情不显示凭据，服务器允许时
仍可进入资源删除确认，取消不写入。新 cookie 会话无需旧 localStorage 即能显示正确权限；
上传失败可重试，上传成功后再次保存不会复用已消费的 uploadId。

390px 公开资源页验证已经揭示的链接判失效后立即折叠，展开仍有有效凭据，核实可用后
在原卡片恢复；不会多建 grant、重排资源或让长密码撑破视口。四张最终截图已人工复核。

### 迁移

在全新 `touchgal_final_e2e` 上先安装既有链接健康结构与 CHECK，再验证本次 SQL：

- preflight 与 postflight 在只读会话执行成功。
- 首次安装遇到 5 秒锁超时后全部回滚，未留下维护表或修改旧事项。
- 八类存量 fixture 中，仅当前版本、合法最新上下文、未回应的发布者疑似事项且有计权证据
  得到接续；不补发通知，旧事项、上下文、健康时钟和 CHECK 定义均不变。
- 再次 sync 幂等；运行真实业务后重跑，维护事件、revision、参与者与通知标记均保持原值。

## 验证边界与上线条件

根目录默认 `pnpm test` 会额外发现被 Git 忽略的
`backup/m03-review-retest/review-d36-deleted-probe.test.ts`，其中一个历史 mock 与现有账号
检查不符。该文件未修改；上表全量结果来自独立受验源码，不包含用户备份。

默认 `pnpm build` 的 lint 阶段仍受两个基线文件的既有 Prettier 错误阻塞：
`components/patch/resource/LinkHealthDot.tsx` 与
`components/patch/resource/resourcePermissions.ts`。后者为本期冻结文件，两者均未改动。
本次使用 `--no-lint` 完成生产构建，并独立运行项目现有 ESLint 配置，只排除这两个文件；
没有关闭 Next 类型检查。独立 lint 命令：

```bash
ESLINT_USE_FLAT_CONFIG=false node node_modules/eslint/bin/eslint.js app components lib --quiet \
  --ignore-pattern components/patch/resource/LinkHealthDot.tsx \
  --ignore-pattern components/patch/resource/resourcePermissions.ts
```

生产发布仍须停旧写入，按审定 preflight → sync → postflight → schema guard 执行，
再切换同一源码版本；不能新旧应用混跑。生产数据库迁移和部署不在此次本地交付内。

## 本地证据

本次验证目录为 `/tmp/otoame-workspace-verify-1019`，保留源码副本、构建产物与以下证据：

- `source-manifest-final.json`、`full-tests-final.log`、`typecheck-final.log`、`build-final.log`。
- `production-acceptance.log`、`artifacts/http-results.json`（`passed: true`、`browser: all`）。
- `migration-final.log`、`artifacts/migration-install.json`、`artifacts/migration-postruntime.json`。
- `artifacts/workspace-360.png`、`workspace-390.png`、`workspace-1280.png`、`public-health-390.png`。

测试服务与一次性数据库在验收后清理；证据目录保留在本机，不作为永久制品存储。
