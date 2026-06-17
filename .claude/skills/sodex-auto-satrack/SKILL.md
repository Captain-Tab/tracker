---
name: sodex-auto-satrack
description: 扫描一个 feature/页面模块，列出全部交互点并产出"埋点候选清单"（建议 snake_case 事件名 + 落点行号 + 建议 payload 字段 + 倾向标记），供人工复核后落地业务埋点。结构化辅助器——只帮你翻代码/起名/推参数，埋不埋由你拍板，不替你判定。ACTIVATE 当用户说「给某模块加埋点」「这个页面要埋哪些点」「扫一下 transfer/spot/xxx 的埋点候选」「sodex-auto-satrack」时。
license: MIT
metadata:
  author: custom
  version: "1.1.0"
---

# sodex-auto-satrack — 业务埋点候选清单生成器（结构化辅助器）

## 定位（先读，决定它能做什么不能做什么）

本 skill 是**结构化辅助器，不是自动判定器**。

| 它做 | 它不做 |
|---|---|
| 扫模块、列全部交互点、追每个 handler 调用链 | ❌ 替你断言"这个必埋" |
| 套启发式给"候选/存疑"**倾向标记** | ❌ 猜"后端是否已有此数据"（前端拿不到，靠人补） |
| 起建议 snake_case 事件名、从可见变量推 payload | ❌ 替你判"是否核心"（业务语义，代码里读不到） |
| 标出依赖 storage 的字段"writer 待确认" | ❌ 直接改运行时代码（除非用户在复核后另行要求落地） |

> **为什么不自动判定**：埋点判定的关键输入是"后端业务库是否已有此数据"——前端 skill 无法可靠获知。强行自动判会瞎判，且埋点错误不报错、不崩、Network 仍 200，会悄无声息坏几个月。本 skill 把"翻代码"自动化，把"判断"留给人。

## 何时用

- 给某个 feature/页面新增业务埋点前，先出候选清单
- 评估一个模块"该埋哪些点"
- 迁移 sodex-web 埋点到 sodex-next 时，对照新模块结构定位落点

> **不扫什么（防重复）**：页面浏览 PV（`$pageview`）已由神策 **autoTrack 自动采集**——`index.html` init 配 `is_track_single_page: true`（SPA 路由切换自动发），`shared/track` 的 `useTrackInit` → `sensorsSink.init()` 调 `sensors.quick("autoTrack")` 启动，propertyPlugin 自动注入公参。**不要**把"进入某页面"作为候选业务事件重复提；仅"页面内某区块的曝光"才算候选 impression。点击热区 / 停留时长（`$WebClick` / `$WebStay`）的 heatmap 已显式关闭（`index.html` heatmap 配置），也不归本 skill。

## 核心判定启发式（仅用于打"倾向标记"，非判决）

埋点的本质是**补后端数据的盲区**。判定一个交互点是否"候选埋"，问两个问题：

```
1. 这个动作的数据，后端业务库是否已有？
     已有（成交订单 / 成功转账 / 后端签发记录）   → 标【存疑】（倾向不埋，可能重复）
     没有（中途步骤 / 点击意图 / 失败·取消态 / 分享 / 客户端曝光） → 标【候选】

2. 埋了能回答什么分析问题？
     答得上（"多少人卡在 enable 这步""授权被拒率"）→ 候选
     答不上 → 不埋

例外（漏斗转化率）：
   后端已有的"成功结果"默认【存疑】；但当它是某个你正在埋的 click 的漏斗终点、
   需要 click→success 配对算前端转化率时 → 升为【候选】，并在备注写明配对的 click 事件。
```

> 启发式输出是【候选】/【存疑】**倾向**，问题 1 的"后端是否已有"由人/产品/数据复核确认，skill 不自行断定。

**经验依据（sodex-web 实证，非臆测）**：sodex-web 54 个业务事件中，最核心的 mutation——下单、撤单、买理财、加推荐——**全部未埋**（后端订单/交易表已有）；被埋的是 connect/enable/transfer/claim/stake 漏斗步骤、share、approve/sign 的 success/failed/cancel 结果态、曝光、客服。即"凡交互皆埋"是错的，分界线是"后端盲区"。详见 references 的现状文档。

## 交互点分级信号（追 handler 调用链，作辅助线索）

| 信号（onClick/handler 调了什么） | 倾向起点 |
|---|---|
| mutation（`useSubmitXxx`/`useMutation`）、钱包签名、合约写、连钱包/Enable | 候选（漏斗/意图） |
| 跳关键转化流程、分享、打开关键转化弹窗 | 候选（看业务，人确认） |
| 纯 UI 态（主题切换/展开收起/tooltip/排序/非内容型 tab 切换） | 存疑/不埋 |
| 成功结果且后端已落库 | 存疑（除非漏斗转化率例外） |

> 调用链信号是技术线索，不等于"核心"——"核心"是业务语义，最终由人判。

## 工作流

1. **确定范围**：用户指定的 feature/目录（如 `src/features/trade` transfer 相关）。
2. **扫交互点**：grep/读组件，枚举 `onClick` / `onConfirm` / `onSubmit` / mutation 触发 / 表单提交等可交互点。
3. **追调用链**：每个 handler 看它最终调了什么（mutation / sign / 导航 / setState / 分享）。
4. **套启发式**：按上面两问 + 分级信号打【候选】/【存疑】。
5. **起名 + 推参数**（先读公用列字典）：
   - **必读**：`src/shared/track/__fixtures__/sensors-event-schema.sample.json` —— 神策真实入库行样本，是**公用单一事实源**（skill 起名 + 后续 payload 验证共用同一份）。建议字段名**必须命中该样本里已有的列**（如 `ticker` / `$type` / `amount` / `status` / `channel` / `coin_id` / `wallet_address`），不要造样本里没有的新列名（造了后端落不进，撞 M5 教训）。
   - 事件名按下方「命名规范」起：新事件强制 `sodex_<surface>_[qualifier_]<action>` 模板；数据团队已给名则原样用。
   - payload 字段 = "数据分析师会用来切片此事件的维度"；从 call-site 可见变量推（实体 id `ticker`/`coin_id`、金额 `amount`/`quantity`、多结果 `status`、入口 `evt_from`、分享 `channel`）。
   - **不重复填信封字段**：`wallet_address`/`platform`/`lang`/`sosovalue` 等由基建（`publicParams.buildSosovalueParams` + `datasinkSink`）自动注入。
   - **字段缺口处理（无原生列时，不臆造、不静默丢）**：需要的业务维度在样本里**找不到对应列**时（如转账方向 from/to 无专用列），在备注标【字段缺口】并给两条路供人/数据定，**不要自己造列名**：
     - 短期：复用语义最近的通用列（`transactionType` / `operation_type` / `action_type`），值用 snake_case 枚举；需确认该列未被占作别的分类。
     - 正解：建议数据团队加专用列（如 `from_account` / `to_account`），属 Q3 数仓就绪依赖。
     - ⚠️ 复用 `extendParams`（自由 JSON）是**下策**：神策默认不能对其内部键 group by，分析师无法分组，仅在维度不需分析分组时才用。
6. **事件粒度（多个同类交互优先合并，不要拆 N 个事件名）**：同一类动作的多个触发点（如 N 个入口按钮、N 个分享渠道、N 个 tab）→ 倾向**合并成 1 个事件 + 1 个维度列区分**（入口用 `evt_from`、渠道用 `channel`），而非每个起一个事件名。理由：新增触发点零 schema 变更、维度列可 group by（既得总数又能拆分）；拆 N 个仅"贴合老命名"，已被放弃。前提：区分维度列必须是样本里的**真实可分组列**。
7. **标 writer 待确认**：依赖 storage/store 的字段（如 `wallet_address`）标注，提醒确认 sodex-next 存在写入源（见 pitfall）。
8. **输出候选清单表**（见下），停下等人复核，不自动落地。

## 输出格式

**候选（建议埋）用 3 列网格框线表**（列：①✅ 交互点 file:line ②事件名 · 参数 ③上报意图）。单元格超宽自动换行，事件名省略 `sodex_<module>_` 前缀（表头注明）。示例（以 vault 为例）：

```
模块: features/vault · 事件名前缀 sodex_vault_

┌───────────────────────────┬────────────────────────────────┬───────────────────────────────────┐
│   ✅ 交互点 (file:line)    │         事件名 · 参数          │             上报意图              │
├───────────────────────────┼────────────────────────────────┼───────────────────────────────────┤
│ ✅ VaultHeader:45 /        │ sodex_vault_deposit_click ·    │ 入口意图——漏看"开了没提交"的流失  │
│ VaultStats:150            │ evt_from                       │                                   │
├───────────────────────────┼────────────────────────────────┼───────────────────────────────────┤
│ ✅ useSubmitVaultDeposit   │ sodex_vault_deposit_result ·   │ 失败/取消前端盲区；成功配 click   │
│ 三态                      │ status, amount                 │ 算转化率                          │
└───────────────────────────┴────────────────────────────────┴───────────────────────────────────┘
```

**存疑（不埋）用简表**（❌ 交互点 + 不埋因）：

```
┌─ 存疑（不埋）──────────────────────────────────────────────┐
│ ❌ onMax / panel toggle / 勾选    纯 UI 态                   │
│ ❌ 卡片点击 / retry / cooldown    边界,测失败/冷却流失才升候选 │
└────────────────────────────────────────────────────────────┘
```

末尾追加：
```
⚠️ 字段缺口「<维度>」无原生列 → <候选列> 选一，或请数据团队加专用列

复核：① 候选全埋? result 的 success 要不要 ② 存疑项升候选? ③ 字段缺口选哪列?
```

**复核规则**（随表附上）：
- 【存疑】请确认"后端是否已有此数据"再定埋不埋
- 升级【存疑→候选】若需 click→success 漏斗转化率配对
- 【字段缺口】维度无原生列 → 选「复用通用列 / 建议数据团队加专用列」，勿自造列名
- 勾选确认后落地：统一放 `shared/track/events/<module>.ts`，一模块一文件
- 框线对齐受终端 CJK 宽度影响，可能略参差（可接受）

## 命名规范（模板，强约束）

事件名模板（全 snake_case）：

```
sodex_<surface>_[<qualifier>_]<action>
```

- **`sodex_` 前缀**：SoDEX 在共享 datasink（与 SSI 同一神策实例）的命名空间，**新事件强制带**，避免与 SSI 等产品事件撞名
- `<surface>`：功能面 / 对象（order / transfer / kline_order / stake / asset_detail …）
- `<qualifier>`（可选）：限定词（market / limit / spot …）
- `<action>`：动词；点击意图 → `click`，结果态 → `result`，曝光 → `impression`，其余直接业务动词（buy / sell / cancel / switch / share）

新事件示例（假设）：`sodex_order_place_click` / `sodex_stake_confirm_click` / `sodex_transfer_confirm_click`

**优先级（高 → 低，避免越权改名）：**

1. **数据团队对该事件已明确给名** → 原样用（可能无前缀，如现存 `kline_order_*`）。**本模板与 skill 一切启发式都不得推翻数据团队既有规范。**
2. 否则 = 新提案事件（无既有规范）→ **强制套模板（含 `sodex_` 前缀）**。
3. **已上线既有事件**（`asset_detail_click` / `feeds_share_click` / `kline_order_*`）→ **不回改**（改名断数仓 schema 连续性，属数据团队决策）。

## 落地约定（人复核确认后，若要求落地代码时遵守）

- 唯一入口 `saTrackService.track(eventName, payload?)`。**不走神策 SDK 手动 track、不引入 wrapper 组件 / autoTrack**（违 D-2 单通道 / D-3 heatmap 关闭）。
- **事件 helper 统一放 `shared/track/events/<module>.ts`，一模块一文件**（如 `transfer.ts` / `stake.ts`），在 `events/index.ts` re-export，业务层从 `@/shared/track` 导入。该 `events/` 目录即"埋点清单"（分模块分文件、自文档、零漂移）。
  - 埋点是横切基础设施，归 `shared/track`，**不放 `features/*/track/`**（避免 satrack 反向依赖各业务 feature 成环）。
  - 事件参数类型只 import `shared/` 内的类型（如 `TransferAccount` 来自 `shared/components/features/Transfer/type`），不 import 各 feature 的 domain（保持 shared→无反向依赖）。
- **横切身份动作（连钱包 / enable trading 等）走 `user.ts` 全局事件**（`trackConnectWalletClick` / `trackEnableTradingClick`，`evt_from` 区分来源），**禁止在各 feature 建 `sodex_<feature>_connect/enable`**——各 feature 复用 user 模块 helper。这两个全局事件用**两级维度**：`sceneName`（模块/场景，粗粒度，跨事件可统一 group by）+ `evt_from`（场景内具体入口，细粒度、不带模块前缀）。helper 用对象入参 `{ sceneName, evtFrom }`。例：连钱包按钮在现货下单区 → `{ sceneName: "trade", evtFrom: "spot_order" }`；全局 Header → `{ sceneName: "global", evtFrom: "header" }`。只接**用户主动点击的入口按钮** onClick；**不埋内部程序化/兜底的 `openConnectWalletDialog` 调用**（重定向兜底非点击意图）。
  - **维度拆分原则**：模块归 `sceneName`、入口归 `evt_from`，**不把模块塞进 `evt_from` 前缀**（如旧的 `trade_spot_order` 应拆为 `sceneName=trade` + `evt_from=spot_order`）——否则按模块聚合得字符串解析前缀。
  - **保留词守卫**：`sceneName=global` 专指全局布局 Header（`HeaderConnectWallet`）；`evt_from=header` 仅全局 Header / 页面级 header 用，feature 页面内"顶部操作区"用 `top`（如 `vault` 场景 `evt_from=top`），**勿因组件名叫 `XxxHeader` 就取 `header`/`xxx_header`** 污染聚合。
  - **`sodex_connect_wallet_click` 只在"专门连钱包入口"触发**：文案为 "Connect Wallet" 的按钮、下单按钮的 connect 态、走 `ensureWriteIdentity` 的登录按钮。**其它一律不触发本事件**——尤其动作按钮（Deposit / Transfer / Withdraw / Swap 等，文案是动作名）未连钱包时的兜底跳连钱包**不埋**（用户意图是该动作、连钱包只是前置 guard，非连钱包点击意图；这类形如 `guarded(() => { if (needsWalletPicker) openConnectWalletDialog(); else action() })`）。
- helper 是纯函数即可；参数从调用方传入（call-time），无需 `use<Name>Track` hook 包装，除非确需在 hook 内注入 store/state。
- **每个 track helper 必须有独立 `/** */` 注释**（说明触发场景 + 上报意图）；**禁止多个 helper 共用一段/一行注释或仅用 `// —— 分组 ——` 段注释代替**。逐函数注释，不合并。
- **每个 events 文件顶部必须有「埋点清单」注释速查表**：列 = `事件名（省 sodex_<module>_ 前缀）/ 入口（组件或 hook 名，不写行号防漂移）/ 参数`，标题行带事件总数 `· N 事件`。**新增/删事件时同步更新表行与计数**（它是该文件事件的目录视图；逐函数注释 + 代码仍是事实源）。
- **【强制】落地任何埋点改动（新增 / 修改 / 删除 事件或其参数/取值）后，必须同步更新 `docs/track-events-inventory.md`**：
  - 新增事件 → 在 §0 事件目录加一行（含编号 + 事件名 + 模块 + 参数）+ 对应模块表加一行（每参数一列，单元格 `参数名：值1、值2、…`）；目录总数 `全 N 事件` 同步 +1。
  - 删除事件 → 删目录行 + 模块表行，总数 -1。
  - 修改事件名 / 参数 / 取值枚举 → 同步改目录与模块表对应单元格。
  - 该文档是项目内埋点的盘点视图（事实源仍是 `events/*.ts` 的 manifest + 代码），入库可 review；漏更新 = 文档漂移，等同未完成落地。与 `events/*.ts` 顶部 manifest 速查表**两处都要改**，不可只改其一。
- 事件名按上方「命名规范」（新事件带 `sodex_` 前缀；数据团队给名则用其名）；神策已注册的 `$` 预置列（`ticker` / `$type` / `$tab_title` 等）按 schema 原样保留（落库列约定，非命名风格）。
- **helper 内 `track()` 的 payload 必须写成【内联对象字面量】，禁止先收进 `params` 变量再整体转发**（如 `track("x", params)`）。原因：契约 `TrackEventPayload = Partial<Record<AllowedColumn, unknown>>` 靠 TS excess-property check 拦截"样本里没有的列名"，但该检查**只对内联字面量生效**；转发具名变量（且对象混有合法键时）会绕过检查，让非法列名静默漏过编译期。正例 `track("x", { a: params.a, b: params.b })`；反例 `track("x", params)`。
- **`$` 前缀不等于"神策预置列、必然存在"**。任何带 `$` 的列名（`$channel` 等）落地前必须在 `sensors-event-schema.sample.json` 里 grep 确认确实是一个 key；样本里没有就用不带 `$` 的同义业务列（如渠道用 `channel` / `shareChannel`，不要臆造 `$channel`）。教训：`feeds_share_click` 曾用 `$channel`（样本无此列）经变量转发漏过 tsc，数据落到未声明字段。
- 改名导致与老数仓不连续 → 知会数据团队登记新事件名。

## 机器门禁（确定性检查已脚本化，非人工记忆）

落地任何埋点改动后，跑：

```bash
node .claude/skills/sodex-auto-satrack/scripts/lint-track.mjs
```

（也由 `.claude/kit/check/verify.sh` 调用，故 `/k:check` 会自动跑。）脚本做 4 类**纯静态、零判断**校验，取代下方对应的人工自检项：

| 检查 | 内容 | 取代的旧自检项 |
|------|------|---------------|
| ① 列契约 | 每个 `track()` payload 的 key ∈ AllowedColumn（sample.json 列 − SystemColumn）。比 tsc 强：连变量转发情形也覆盖 | 「字段名对照样本真实列」 |
| ② 内联字面量 | 禁止 `track(name, 具名变量)` 转发（绕过 tsc excess-property check） | 「payload 是内联字面量」 |
| ③ manifest 计数 | events 文件顶部「· N 事件」== 文件内 track 事件数 | 「manifest 行数与计数一致」 |
| ④ 文档同步 | events/*.ts 每个事件名都出现在 `docs/track-events-inventory.md` | 「增/改/删后同步 inventory」 |

> 分界线：**确定性的"符合契约 / 是否同步 / payload 对不对" → 脚本**；**语义的"埋不埋 / 叫什么 / 带哪些维度" → 下面的自检 + 人**。
> 脚本 exit ≠ 0 即未完成落地，先修到绿再汇报。

## 硬约束（自检）

- [ ] skill 只出候选清单 + 倾向，未替人断言"必埋"/"后端是否已有"
- [ ] 事件名符合命名规范（新事件带 `sodex_` 前缀 / 沿用数据团队给定名，未越权改既有名）；信封字段未重复填；`$` 预置列保留
- [ ] 依赖 storage 的字段标了"writer 待确认"
- [ ] 落地（如要求）走 `saTrackService` 单通道，无 wrapper/autoTrack
- [ ] 〔脚本①自动〕字段名已对照 sample.json 真实列，无臆造列名（含 `$` 前缀列）——`lint-track.mjs` 校验
- [ ] 〔脚本②自动〕helper 内 `track()` payload 是内联对象字面量（非转发 `params` 变量）——`lint-track.mjs` 校验
- [ ] 需要的维度无原生列时标了【字段缺口】+ 两条路（复用通用列 / 建议加列），未自造列名、未默认塞 extendParams
- [ ] 多个同类触发点已评估合并（1 事件 + 维度列），未无脑拆 N 个事件名
- [ ] evt_from 取值未撞保留词（`header` 仅全局 Header；页面顶部区用 `<feature>_top` 而非 `<feature>_header`）
- [ ] 每个 helper 都有独立 `/** */` 注释（触发场景 + 上报意图），未多函数共用一段注释
- [ ] 〔脚本③自动〕events 文件顶部「埋点清单」总数与文件内 track 事件数一致——`lint-track.mjs` 校验（注释表的入口/参数列仍需人工填准）
- [ ] 〔脚本④自动〕增/改/删事件后已同步 `docs/track-events-inventory.md`，事件名无漂移——`lint-track.mjs` 校验（§0 目录行 + 模块表的取值枚举仍需人工填准）
- [ ] 提醒：埋点验证不接受"代码触发/Network 200"，须解码真实 POST payload 逐字段对照该样本（gate pitfall）
