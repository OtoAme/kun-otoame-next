# 会社合并检测覆盖：补上「应当并、现在没进队列」的行

日期：2026-09-21  
分支：`fix/company-ingestion`  
范围：只扩展 **dashboard 检测** 的建议生成。创建热路径的规范化不改。LLM 仍暂缓。合并确认仍走冻结 apply。

生产 dump（`otoame_prod_dump`，441 家）上，现有规则（法人格 + 标点 + 去掉括号后的外层名）检出 16 组。Koei、GION 三种 Mebius 已覆盖。漏网几乎全是「同一部作品一次抓取写成两行」，外加词表缺口。

---

## 1. 不做什么

- 不把同作所有会社并成一家（Cherrymochi、KONAMI、WINGALD 必须留下）。
- 不上通用罗马字↔片假名转换器（`KONAMI` 和 `テンキー` 会误伤）。
- 不改 `normalizeCompanyValue`。
- 检测成功也不写 `authoritative` 别名；人点合并后才升权威。
- 不在检测里 apply。

---

## 2. 分层

### 层 1 — 本地词表与字形（不联网）

在现有 `nameVariantKeys` 上加键，仍用 **闭包 unique-hit**（该键不能出现在簇外）。

| 扩展                                                                                | 覆盖 dump 漏网                                         | 说明                                                                            |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 法人格补 `ltd.`（不要求前面有 `co`）、`llc.`、`llc`、`corp.`、`limited`、`合同会社` | `G.rev Ltd.`、`Re,AER LLC.`                            | 与现有 `Co., Ltd.` / `Inc.` 同类                                                |
| 括号**内**的片段也当键（外层名已经当键）                                            | `拓洋興業（TAKUYO）` → 键 `takuyo`，对上 `#153 TAKUYO` | `オトメイト（PSP版）` 内层是 `psp版`，不会乱配；它已经靠 Otomate 的权威别名进队 |
| 中文/假名**整段粘在**拉丁名前后，且多出来的部分**全部是 CJK**、长度 ≥ 2             | `劳斯麦斯Rolls-Mice` ↔ `Rolls-Mice`                   | `Operetta Due` 多出来的是拉丁，不要                                             |

`PlayMeow Games`、`honeybee Black`、`QuinRose reborn` 仍不并：多出来的是拉丁修饰，不是法人格。

### 层 2 — 同作 + 来源成对名字（可联网，fail-open）

这是 Tenky / 小珠ゆり / おとめ堂 / セルティア 的正路，沿用已拍板的「只信来源表里成对的名字」。

对每部 **至少两家会社** 且带 `vndb_id` 和/或 `bangumi_id` 的作品：

1. 取该作 VNDB `developers{name,original,aliases}`（已有 `loadVndbDevelopers`）。类型仍限 `co` / `ng` / `in`。
2. 可选：NextMoe `works?refs=` + `companies?ids=&include=aliases`。NextMoe 上 Tenky 别名为空，**不能只靠 NextMoe**；VNDB 的 `original` 才是片假名侧。
3. 每个上游会社形成一个名字袋（name ∪ original ∪ aliases，再走现有 fold：后缀、标点、括号内外）。
4. 把**这部作品上的**本地会社主名（同样 fold）投进袋子。
5. 同一袋子里 ≥ 2 家本地行 → 一条建议，`kind = source-pair`。
6. 落进**不同**袋子的，即使同作也不并（KONAMI vs Tenky，Mebius vs Cherrymochi）。
7. 对不上任何袋子的本地行忽略。
8. 密钥缺失、429、5xx：跳过层 2，层 1 结果照出。检测不能 500。

投袋时**只用主名 + authoritative identity**，不用 `alias[]` 里的 legacy（避免错别名繁殖）。`拓洋興業（TAKUYO）` 若层 1 已用括号内键对上，层 2 不必再出一条；按会社 id 集合去重。

### 层 3 — 不做

同作「一家拉丁一家片假名就并」。耽美梦想2 是 KONAMI + Tenky + テンキー，会把 KONAMI 配错。三条及以上时无法在不猜音译的前提下选对拉丁行。

---

## 3. 队列与界面

| kind                | 文案                                        | 来源 |
| ------------------- | ------------------------------------------- | ---- |
| `suffix-unique-hit` | 仅法人格后缀不同                            | 现有 |
| `name-variant`      | 名称变体（标点 / 括号 / 法人格 / 中文粘连） | 层 1 |
| `source-pair`       | 同一作品的来源别名对得上                    | 层 2 |

去重键仍是排序后的会社 id 集合：已 pending 则更新，已 dismissed 则跳过。  
`source-pair` 的 `evidence` 必须带 `patchId`、上游 `vndb`/`nextmoe` 会社 id、命中的名字袋，方便人审。

主会社规则不变：apply 时取簇里最小 id。检测列出的「目标」尽量也用最小 id，避免和合并表单打架。

---

## 4. dump 验收（通过才算覆盖到）

应当**新出现**（或并进已有 TAKUYO 簇）：

- Tenky `#446` ↔ テンキー `#447`
- Kotama Yuri `#407` ↔ 小珠ゆり `#409`（不要 WINGALD）
- Shirano Earl `#410` ↔ 白野あーる `#411`（ShironoR `#412` 可进同一来源袋才并，否则单独人审）
- Otomedou `#413` ↔ おとめ堂 `#414`（不要 Abracadabra）
- Celtia Inc. `#455` ↔ 株式会社セルティア `#456`（不要 MORPATH）
- G.Rev `#316` ↔ G.rev Ltd. `#318`
- Re,AER `#350` ↔ Re,AER LLC. `#348`
- Rolls-Mice `#369` ↔ 劳斯麦斯Rolls-Mice `#370`
- 拓洋興業（TAKUYO） `#245` 进入 TAKUYO 簇

应当**仍然不出现**：

- Cherrymochi 进 Mebius
- KONAMI 进 Tenky / テンキー
- Koei 进 KOEI TECMO
- honeybee 进 Honeybee Black
- Otomate ↔ オトメイト（PSP版）可以保留（平台注记，人审合并即可）

层 2 单测用夹具，不打真网。dump 上的真检测作为手工验收，不进 CI。

---

## 5. 实施顺序

1. **词表 + 括号内键 + CJK 粘连**（纯函数 + 单测 + 接入 `detectCompanyMergeSuggestions`）。不联网，dump 上即可验 Ltd/LLC/粘连/TAKUYO。
2. **同作 VNDB 名字袋**（`loadVndbDevelopers`，限流、批间暂停、fail-open）。覆盖 Tenky 类。
3. **同作 NextMoe 名字袋**（有 `KUN_NEXTMOE_API_KEY` 才跑）。补 VNDB 没有的 Bangumi 写法；对不上就跳过。
4. 文档 / skills 另一次 conventional commit。

创建路径暂不启用层 2。层 1 的 Ltd/LLC 查找键可以稍后同样接到 `ensureCompanyRelationsByName` 的第二查找，避免新投稿再写出 `G.rev Ltd.` 这种行；本设计的验收以检测队列为准。
