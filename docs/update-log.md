# 更新日志（tracker）

`service/`（perps 账户监听 watch + 跟单候选发现 discovery + 编排 app + 基建 lib + 共享 tool）的版本变更记录。最新在上。

---

## HYPE-discovery 深评改造：fill 聚合成交易 + 踢做市 — 2026-06-24

把 HYPE-discovery 从"只 leaderboard 粗筛→选出全是机器人"改为"深评筛低频大单方向性可跟单交易者"。诊断/数据/最终算法见 `docs/api-confidence/hype.md §五·六`。

### 新增

- **`api/index.mjs`**：info 封装（`fetchClearinghouseState`/`fetchUserFills`/`fetchUserFillsByTime`）+ 限流 gate（并发≤4 + 间隔 + 429/503 退避）。
- **`process/evaluate.mjs`**（新建）：拉 userFills → `aggregateTrades` 按 `startPosition` 重建仓位周期（持仓归 0 = 一笔交易）→ 交易级算 PF/胜率/RF/频率/名义/单笔利润 + 门槛过滤。
- **`process/score.mjs`**（新建）：PF/RF/胜率/净额规模 归一加权 × capped 降权(0.9)。

### 变更

- **`config.json`**：vlm 门槛 $500万→$5万 + 新增 `minEfficiency`(pnl/vlm)≥1%（修入口——旧门槛系统性筛掉所有低频交易者）。
- **`process/filter.mjs`**：粗筛加 pnl/vlm 效率门槛。
- **`main.mjs`**：串接 collect→filter→evaluate→score→output（替换 rankTopK）。
- **`process/output.mjs`**：展示交易级深评字段（PF/胜率/trades每天/名义/单笔利润）。
- **`api/index.mjs`**：修预存 bug——leaderboard early-stop 用 `return` 替代 `controller.abort()`（abort 抛 AbortError 被误当采集失败）。

### 关键决策（实施中两方案被实测推翻）

- **fill 必须聚合成交易**：HYPE 一笔交易拆数十 fill 执行（#1: 529 fill=10 交易），fill 级 PF/胜率/频率/单笔利润**全失真**（#1 被误判 PF155万做市，实为低频大单高手）。改为交易级。
- **HFT 判据用 trades/天（非 fills/天）**：fills/天会把大单拆单误判高频。
- **去 clearinghouseState**：marginUsed 仅展示、不进 score，去掉使请求减半（性能优化）。
- **踢做市**：中位单笔利润≥$100 门槛剔"名义够但单笔微利"的做市残留。
- **capped 降权**：userFills 2000 上限→近期画像，PF∞ 乐观，评分×0.9。

### 验证

- `node --check` 全通过；端到端 dry-run（--limit=2000）：扫 2000→粗筛 116→深评合格 23→推荐 20。
- 画像收敛：低频（0.1~1.5 笔/天）+ 大单（名义中位 $3万~$733万）+ 大利润（中位单笔 $204~$32万）方向性交易者；做市/高频/小单/微利全被门槛剔除。
- closedPnl 聚合正确性手算验证（#1 6 笔交易/全赢，与代码一致）。

### 不做（边界）

- 不做 userFillsByTime 全史翻页（接受近期画像，capped 降权应对）；不动 sodex-discovery；下注规模维度未进 score（HYPE 名义锚点未校准，仅展示+用净额维度）。

## sodex-discovery 新增下注规模（betSize）评分维度 — 2026-06-23

算法原本只看比率（PF/RF/胜率），不看下注规模，导致"大量小单刷高 volume"被误判优质（ETH/PLTR volume $14M 拿高分，但中位保证金仅 $2.6k 全是小单）。新增 betSize 维度修正"可跟性"盲区。

### 新增

- **`evaluate.mjs`**：`derivePositionMetrics` 推算每仓保证金（`名义÷杠杆`；平仓历史 `initial_margin` 已清零=0，只能推算），输出 `medMargin`/`maxMargin`（中位/最大）。
- **`score.mjs`**：第 6 评分维度 `betSize`，中位保证金对数归一。锚点经 **leaderboard 前 100 名实测分布校准**（75 有效样本：p50≈$700→0、p90≈$25k→1），专门修正 volume 的"小单刷量"盲区。
- **`output.mjs`**：md 报告新增"投入保证金(名义÷杠杆推算)：中位/最大"展示行。

### 变更

- **`main.mjs`**：三 preset 权重新增 `betSize`（balanced 12 / conservative 8 / aggressive 15，从 volume 等匀出，各档和=100）。

### 设计约束

- betSize **只加分、不作硬门槛**——重仓亏更危险（须与 PF/RF 组合）；避免误杀小本金高手 + 阈值拍脑袋。
- CROSS 模式保证金为"名义÷杠杆"**近似**（非精确占用），展示标注"推算"。
- 锚点基于"30D pnl 前 100 名"池，换窗口/全市场可能略偏；样本少，待积累校准。

### 验证

- `node --test` 1/1 全绿；`node --check` 通过；三 preset 权重和均 = 100。
- aggressive 实测：XAut（betSize 1.0、中位 $27k）由 #2 反超 #1；ETH/PLTR（betSize 0.36、小单）降分——精准修正 volume 小单刷量失真，判定门槛不变（仍 3 个通过，只改排名）。

---

## sodex-discovery nTrades 语义正名 + 滚仓盲区记录 — 2026-06-23

`nTrades`（已平仓位数）此前被当"成交频率/经验"代理使用，实测证明仓位数严重低估真实成交频率（0727h 318 仓位 vs 111 笔/天成交；USTECH100 12 仓位 vs 384 笔/天，单仓由 3~83 笔成交拼成）。本次仅做**零成本正名**，不动判定逻辑、不加接口。

### 变更

- **`evaluate.mjs`**：`nTrades` 注释正名为"已平仓位数（非成交笔数）"；`classifyTradeEligibility` 加注滚仓型（持仓不平、仓位数少）可能因 `nTrades<8` 被误杀，指向 docs 盲区记录。判定门槛（`minTrades=20`/`lowFreq=8`）零改动。
- **`output.mjs`**：md 报告展示文案正名——"近90D笔数"→"已平仓位数"、"近90D净额"→"已实现净额"（对齐全历史含义）；`profileType` 加注分档基于仓位数而非成交频率。
- **`docs/api-confidence/sodex.md`**：第六节补充仓位生命周期、两接口（positions 平仓历史 / state 活跃仓位 `cr`）分工、完整已实现利润公式，及**处置决定表**。

### 不做（边界，已记录为盲区）

- **滚仓型资格误杀 / 评估不可靠**：彻底解需 trades 逐笔回放（盈亏质量必须基于已结束交易，活跃仓位 `cr` 无逐笔结构无法算 PF/胜率），该方案请求暴增（cursor 全量 ~17 次/账号）+ funding 回放风险，且滚仓型未在样本观测到，必要性未证明——暂不实现，等观测到真实样本再评估。
- 不采用"低频候选查 trades 让其过资格"折中：过资格但 PF/胜率仍基于极少仓位、统计不可靠，半截子补丁。

### 验证

- `node --test` 1/1 全绿；`node --check` 通过；`/k:check` 三闸门（subagent + 主 review + verify.sh）一致 PASS。

---

## sodex-discovery 去污染字段 + 去截断 + 503 容错 — 2026-06-23

修复粗筛/评估误用 `overview` 受污染字段，导致真盈利账户被误杀的链路问题。证据：账户 2566 近30天逐笔真账本 +$3072、全历史 +$19216，但 `overview.perps_closed_pnl_usd(30D)` 记 −$6129（混入充提/资金费），filter 据此把它在第一关淘汰。

### 变更

- **`filter.mjs`**：删除 `perps_closed_pnl_usd` 盈利门槛与 perps 主导判定（该字段实测污染）；粗筛只保留实测可信的 `volume` 门槛。盈利/合约主导判定下沉到 evaluate 用 positions 逐笔真账本。
- **`evaluate.mjs`**：`perpsPnl` 改取 positions 逐笔净额 `pm.netProfit`（权威），不再读 `overview.perps_closed_pnl_usd`；antiAirdrop 同步基于逐笔净额。
- **`main.mjs`**：`positionsLimit` 200 → 1000。原 200 会截断长历史账户（实测 ETH/PLTR 318 条、MW 445 条），致 `activeSpan/netProfit/maxDD/RF` 失真；实测单账户最多 445 条(~220KB)，1000 覆盖全历史且内存安全（契合 1G 服务器）。删除已无引用的 `FIXED.perpsMustDominate`。
- **`api/index.mjs`**：重试集合纳入 `503`。overview 接口高频偶发 503（同账户时好时坏），原仅 429/409 重试，致 filter 把接口抖动误判为不合格——实测 25 候选 22 个被 503 误杀（88%）。

### 验证

- `node --test` 1/1 全绿；6 文件 `node --check` 通过。
- 端到端 `--dry-run --limit=25` 实测：修复前 filter 幸存 3（22 淘汰中绝大多数为 503 误杀）→ 修复后幸存 20、淘汰 5；XAut 账户 192916 由"被误杀"恢复为推荐 #1（评分 94.2，合约盈利走逐笔真账本 $51,005、最大单笔 $42,703、活跃跨度 49 天）。

### 不做（边界，需后续校准，不猜测）

- **开仓名义 / 单笔盈利维度**：实测能区分重仓方向性（2566/XAut 中位开仓 $72k/$372k）与小额高频（MW $1.5k），有跟单参考价值；但门槛阈值需数据校准，本次不拍脑袋落地。
- **evaluate 流式化**：当前 `pages=2` 候选 ~100、单账户 ≤220KB，无 OOM 证据，暂不改造（仅在调大 pages 时需注意）。

## HYPE-watch 账户保证金展示 — 2026-06-23

从 `clearinghouseState.marginSummary` 提取 per-position 保证金，TG 和 console 两端同步展示。

### 变更

- **`watcher.mjs`**：保存 `marginSummary` + `withdrawable`，传入 render 函数。
- **`render.mjs`**：每仓位"保证金模式"改为"保证金 $XXX (Cross/Isolated)"，`buildTgMessage` 和 `renderPositions` 同步。

### 验证

- `node --test` 70/70 全绿。

---

## discovery TG 报告文件上传 — 2026-06-23

两个 discovery 模块 TG 推送新增 `.md` 报告文件上传——点击即可下载到本地（Telegram `sendDocument`，永久有效）。

### 新增

- **`sendTelegramDocument`**（两个 `output.mjs`）：`readFileSync` + `Blob` + `FormData` → POST `sendDocument`，8s 超时，失败不阻断。
- TG 文本消息尾部改为 `📄 完整报告见附件`（原为不可点击的文件名引用）。

### 变更

- `sodex-discovery/process/output.mjs` + `HYPE-discovery/process/output.mjs`：两 venue 对称新增 `sendTelegramDocument`，`--no-push` / `--dry-run` 自然跳过。
- `buildTgMessage` 签名移除死参数 `mdFileName`（文案改为固定"见附件"后不再需要）。
- `output.test.mjs`：测试断言同步 + 移除 `mdFileName` 变量。

### 验证

- `node --test` 10/10 全绿（HYPE-discovery 9 + sodex-discovery output 1）。

---

## Phase 4：START WATCH 门控（仅新增地址推送）— 2026-06-23

修掉 watch 每次部署对所有地址重推 `👀 START WATCH` 的噪音——只对 config 相比上次**新增**的地址推。

### 新增

- **`tool/seenAddresses.mjs`**：`loadSeenAddresses`/`computeNewAddresses`/`saveSeen` 纯函数门控，sodex-watch 与 HYPE-watch **共用**（+ 5 项单测）。
- 状态文件 `{sodex,HYPE}-watch/.seen-addresses.json`（gitignore）：记录已通知过 START 的地址集合，跨部署比对；启动时并集落盘。

### 变更

- `sodex-watch/main.mjs` + `HYPE-watch/main.mjs`（多地址路径）：启动 load seen → computeNewAddresses → saveSeen，把 `isNew` 传入各 watcher。
- 两 watcher 首帧 `kind==="START"` 时**仅 `isNew` 推 TG**（console banner 照常）；`isNew` 缺省 true → **单地址 CLI 模式不门控**。
- **强制重推**：删 `.seen-addresses.json` 后下次启动全部地址重新推 START。

### 验证

- `node --test` 全绿（新增 tool 门控 5 项）。
- 实测：seen 文件含 X、Y，config=[X,Y,Z] → 仅 Z 推 START，X/Y 日志"已知地址，跳过"；删文件 → 全部重推。

---

## HYPE Phase 1-3：监听 + 排行发现 + systemd 编排 — 2026-06-23

为 Hyperliquid（HYPE）扩展监听 + 排行发现，与 Sodex 平行对称（spec-set `.claude/kit/spec/hype-watch-discovery/`）。

### 新增

- **`HYPE-watch/`**：HYPE 账号 WS 监听（聚焦频道 clearinghouseState/openOrders/userFills/orderUpdates，ping=`{method:ping}`）+ 每日镜像 + TG。归一模型（szi 带符号方向、mark=positionValue/|size| 反推、roe 直给）；平仓按 **oid 聚合**；**离场单变化提醒**（PLACE/MODIFY/CANCEL，MODIFY 仅认价格变，撤销/成交消歧）；无持仓不推；仅多地址 `--config`。
- **`HYPE-discovery/`**：leaderboard 粗筛（pnl/vlm 门槛，不用 roi）+ 排除已监听 + 落盘/TG。**流式逐行解析**（`createRowScanner` + `streamLeaderboardRows`，不缓存 32MB 全文，内联门槛）——峰值 **264MB→98MB**；topK 截断显式记日志（不静默）。
- **app systemd 扩展**：`buildUnits` 增 `HYPE-watch.service` + `HYPE-discovery.{service,timer}`（共 6 单元）；config 增 `hypeWatch`/`hypeDiscovery` 键（`watch`/`discovery` 仍控 sodex）；两 discovery **默认错峰**（sodex 9 点 / HYPE 10 点），相同 OnCalendar 时 render/apply/status 告警。

### 变更

- `setup/{Makefile,setup-systemd.sh}` 增 HYPE sync-config/logs/status；`docs/{systemd-setup,deploy-commands}` 四服务化；`.gitignore` 忽略 HYPE config/log。

### 验证

- `node --test` 60 项全绿（sodex + HYPE-watch 11 + HYPE-discovery 9）。
- HYPE-watch 真实地址实测：有仓渲染（HYPE 3x LONG / mark 反推 / ROE）、空仓"无持仓"、TG 留空不报错。
- HYPE-discovery dry-run 实测：39288 行 → 排除 2 已监听 → 粗筛 20，峰值 98MB（`/usr/bin/time -l`）。
- `app render` 6 单元正确、错峰告警生效。

### 已知限制 / 后续

- 流式 scanner 一版曾因跨 push 状态残留重复计花括号 → 峰值反升 546MB，已修（spec 03 记 Pitfall）。
- HYPE roi 受充提污染未实证；逐笔深度评估、`orderUpdates` 实时化离场提醒留第二步。

---

## service 多交易所重构 Phase 0：Sodex 重命名 — 2026-06-22

为扩展 Hyperliquid（HYPE）监听 + 排行发现，把 `service/` 重构成「按交易所对称」布局。Phase 0 先重命名 Sodex 模块，逻辑零变更（详见 spec-set `.claude/kit/spec/hype-watch-discovery/`）。

### 变更

- **目录重命名**：`service/watch/` → `service/sodex-watch/`、`service/discovery/` → `service/sodex-discovery/`（`git mv` 整树改名，相对 import 不变）。
- **systemd 单元改名**：`watch.service`→`sodex-watch.service`、`discovery.service`→`sodex-discovery.service`、`discovery.timer`→`sodex-discovery.timer`。`app/index.mjs` 的 ExecStart 路径、buildUnits 单元名、status 探测同步。
- **迁移链泛化**：`OLD_WATCH_UNIT` 单值改为 `LEGACY_UNITS` 数组（`watch-account.service` / `watch.service` / `discovery.service` / `discovery.timer`），`apply` 时逐个 disable+删除，防新旧单元双开。
- **涟漪同步**：`setup/{Makefile,setup-systemd.sh}`、`.gitignore`、docs（systemd-setup/deploy-commands/watch-account-plan/discover-traders-plan/query-account）路径与单元名全部更新。
- **暂不改 config 键**：`app/config.json` 的 `watch`/`discovery` 键名保留，留 Phase 3 加 HYPE 键时统一重构 schema。

### 验证

- `node service/app/index.mjs render` 三单元名均为 sodex-*，ExecStart 指向 sodex-watch/sodex-discovery，迁移动作含旧单元。
- `node --test` 41/41 不退化。

---

## discovery TG 消息钱包地址完整展示 + VPS 首次部署 — 2026-06-21

### 变更

- **TG 消息地址完整展示**：`output.mjs` 删除 `shortAddr()` 截断函数，`📡` 行展示完整钱包地址（`0x32649e956cda9b18acae74193d5839097f6144e5` 而非 `0x3264…44e5`），避免跟单地址信息丢失。
- **VPS 首次部署**：`racknerd-25e541f`（107.172.90.184）完成新结构部署。从旧 `~/watch-account/`（扁平 `script/`）迁移到 `~/service/`（分层 `service/app/` + `watch/` + `discovery/` + `lib/WARP/` + `tool/`）。`app apply` 自动迁移旧 `watch-account.service` → 新 `watch.service` + `discovery.timer`。discovery 首次运行产出 163 候选 → 7 推荐。
- **Makefile 新增 `pull-logs`**：一键下载 discovery 日志到本地 `service/discovery/log/`。

### 验证

- `output.test.mjs` 7/7 全通过，TG 消息地址已完整不含 `…` 截断。
- `node --check` 通过；`app status` 两服务 active。
- 旧 `watch-account.service` 已 disable+删除，无残留。

---

## discovery TG 消息格式优化 — 2026-06-20

通知消息标题与日期分行 + 移除紧凑单行格式（第 6 起不展示）。

### 变更

- **标题与日期分行**：第一行 `🔭 跟单候选发现`（纯标题），第二行 `⌚ YYYY-MM-DD`（时间带 emoji），避免日期干扰标题语义。
- **移除紧凑单行**：TG 仅展示前 5 名详展卡片，删掉 `#N addr · score · PFx.xx xx%` 紧凑格式（`DETAIL_CARDS` 从"分界线"改为"截断线"）。手机端窄屏下紧凑行与上一条卡片无视觉分隔，易混淆。

### 验证

- 示例数据构建 TG 消息，`node service/discovery/process/output.test.mjs` 全 7 项检查通过，未真实推送。

---

## 定时镜像无持仓不推 TG + formatDisplayId 测试对齐 — 2026-06-20

定时/镜像快照当前无持仓时不再推送 Telegram（仅 console 留痕）；顺带修掉既有 formatDisplayId 测试失败。

### 变更

- **镜像快照无持仓跳过 TG**：`watch/process/snapshot.mjs` 纯快照模式当前无持仓（`positions.some(size!==0)` 为假）时早返回，不推 TG；`watch/process/watcher.mjs` 每日定时镜像（`kind === "SNAPSHOT"`）同理跳过，**事件驱动的开/平仓提醒不受影响**仍照常推送。
- **formatDisplayId 测试对齐**：保留实现的 `】 🎯 label` 空格格式（更易读），把注释示例与 `tool/format.test.mjs` 预期同步为带空格，修掉历史遗留的 1 个 fail。

### 验证

- `node --test` 41/41 全绿（消除既有 formatDisplayId fail）。
- 本地实测 `0x8d56…7480`（当前无持仓）：snapshot 模式正确输出 `镜像快照：当前无持仓，跳过 Telegram 推送`，console 仍完整渲染仓位/平仓历史。

---

## app 编排层 + 统一代理 + service 改名 — 2026-06-20

集中编排两个服务（watch / discovery）+ 统一 WARP 代理 + discovery 可配调度；顶层 `script/` 改名 `service/`。

### 新增

- **`service/app/`（编排层）**：`config.json`（开关 + discovery 调度，gitignore）+ `config.example.jsonc`（注释枚举全部取值）+ `index.mjs`（`render`/`apply`/`status`）。按 config 生成 systemd 单元 `watch.service` + `discovery.service`(oneshot) + `discovery.timer`（OnCalendar 带 `Asia/Shanghai` + `Persistent=true`）。两个独立单元 = **进程隔离**；单 config + CLI = **集中管理**。`apply` 幂等（仅 unit 内容变才 restart，不误重启 watch）+ 自动迁移旧 `watch-account.service`。
- **`service/lib/WARP/`（统一代理）**：`installFetchProxy`(undici) + `installWsProxy`(ws)。**修复 discovery 无代理 bug**（VPS 走 WARP 不再裸连/泄漏 IP）+ 去重 watch 的 fetch/WS 代理。
- **discovery 可配调度**：`app/config.json` 的 `discovery.schedule`——`freq`(weekly/monthly/daily) + `day`（weekly 用 cron 0-6：0=周日..6=周六；monthly 1-28）+ `hour`(0-23，Asia/Shanghai)。

### 变更

- **目录改名 `script/` → `service/`**（整树改名，相对 import 不变）；VPS 部署根 `/root/watch-account` → `/root/service`；单元名 `watch-account.service` → `watch.service`（apply 自动迁移）。`setup/{setup-systemd.sh,Makefile}` + `docs` + `.gitignore` 同步。
- discovery/watch 改用 `lib/WARP`（discovery/api、watch/api、watch/watcher）。

### discovery 算法 v2（同期）

弃 `chart`（实测 pnl_usd 是累计曲线非单日，致 Sharpe/maxDD 全错）/ 日级 `Sharpe`（稀疏离散低信号）/ `maxDD/总盈利`比（分母趋零爆炸）；改 **positions 逐笔真账本** + **Recovery Factor**（净盈利/maxDD，永不爆炸）；freshness 改用 positions 近 7 天逐笔实现（overview 短窗是快照口径，与榜单误导同源）。

### 验证

- `node --check` 全过；`node --test` 基线 40/41（1 既有 formatDisplayId fail）。
- 本地实测：`app render` 三单元正确（OnCalendar 含 Asia/Shanghai）；discovery 前 5 名 + watch snapshot（0x8d56…）行为正常、不推 TG；day 0-6 → OnCalendar 三种正确。

---

## watch 结构重组 — 2026-06-20

把根目录单体脚本按「层」重组到 `script/watch/`，并抽全局共享格式化层 `script/tool/`（纯结构迁移，行为零变更）。

### 变更

- **抽 `script/tool/format.mjs`**：数字/千分位/去尾零/USD/百分比/时间格式化 + 地址(shortAddress/formatDisplayId/isAddress)/HH:MM(isValidHHMM/pickAt) 校验，供 watch/discovery/query 共享。
- **`watch-account.mjs`(1090 行) 按层拆**：`watch/main.mjs`(入口) + `watch/api/index.mjs`(REST IO+共享限流+TG+符号缓存) + `watch/process/{parse(归一+diff), render(渲染), watcher(AccountWatcher+WS), snapshot(SnapshotMode), config(loadConfig)}.mjs`。WS polyfill 留在 watcher（保 query 不依赖 ws）；共享限流状态经 ES module live binding 跨模块引用。
- **`query-account.mjs` → `watch/query.mjs`**：复用 `api/index.mjs` 的 httpGetJson/resolveAccountIdViaChain 与 `tool/format` 的 isAddress，删内部重复实现。
- **`watch.config.json` → `watch/config.json`**（gitignore 路径同步）。
- **测试**：原 `format.test.mjs` 按被测模块拆为 `tool/format.test.mjs`(format/校验) + `watch/test/domain.test.mjs`(parse/render)。

### 验证

- `node --check` 全 9 个 .mjs 通过；`node --test` 基线不退化（40 pass / 1 既有 formatDisplayId fail，原样保留）。
- watch --snapshot / query 行为与迁移前一致（纯结构迁移）。

---

## discovery v1 — 2026-06-20

新增跟单候选发现系统 `script/discovery/`（五阶段管线：collect→filter→evaluate→score→output）。

### 新增

- **五阶段纯函数管线 + 零依赖**（Node18 fetch）：`main.mjs` + `api/index.mjs` + `process/{collect,filter,evaluate,score,output}.mjs` + `config.json`。漏斗 ~150→~30→十几→topK，只覆盖榜单前 100 名。
- **api/index.mjs 接口收口**：4 个 HTTP（leaderboard/overview/chart/positions，JSDoc 契约）+ WS 声明 + 自带轻量限流（并发≤4 + 间隔 + 429/409 退避）+ 大整数安全解析。
- **D1-D4**：positions 带 `limit=200`；弃 tradeRatio 用 perps 绝对额；双通道门槛（中频≥20 或 低频≥8&PF≥3&win≥70%）；不用 ROI。
- **输出**：`log/discovery-YYYY-MM-DD-HHmm.{json,md}` + TG 推送（前5详展/第6起紧凑）；只读 watch.config 排除已监听，**绝不写**；topK 是上限不凑数；0 通过照常出文件。
- CLI：`--dry-run`（仅 stdout）/`--no-push`（落盘不推 TG）/`--limit=N`/`--top`/`--pages`/`--config`。

### 算法 v2 根因修正（dry-run 实测后）

- **D5 chart 弃用**：`chart.pnl_usd` 实测是累计曲线非单日，evaluate 全部逐笔指标改用 positions 真账本。
- **D6 freshness 改 positions**：overview 短窗是净值快照口径（混转入/提现，与榜单 pnl 误导同源），改用 positions 近 7 天逐笔实现（`<0`=正在亏淘汰，`=0` 休眠放行）。
- **D7 弃 Sharpe/ddRatio，用 Recovery Factor**：日级 Sharpe 低信号、`maxDD/总盈利` 分母趋零爆炸（D2 同病）；统一用 `RF=净盈利/maxDD`（永不爆炸）。preset 矩阵随之重校准。
- 新增 `maxWin/maxLoss` 仅展示（RF 已数学兜住单笔尾部，不设门槛）。

### 验证

- `node --check` 全 7 文件通过；`node --test` 基线 40/41（1 个 format.test 为既有失败，未触碰）。
- 真实地址校验：3602(中频)/192916(低频) 通过；17139(合约亏)/204502(单日集中) 淘汰。
- dry-run 收敛 162→42→7，0 落盘/0 推送验证 dry-run 与 --no-push。

---

## watch-account v2.1 — 2026-06-20

通知样式优化（手机 TG 防折行 + emoji 标识）+ displayId 改地址 + 每地址镜像时刻。

### 变更

- **displayId 改用地址**：banner 头默认 `【短地址】`（前 4 位含 `0x` + `...` + 后 4，如 `【0x58...7027】`）；config 项有 `label` 时用 🎯 追加（如 `【0x58...7027】🎯 xiao`），不再显示交易所内部 accountId。新增 `shortAddress()` / `formatDisplayId()` 工具。
- **通知防折行 + emoji**（手机 TG 窄屏）：仓位卡片隔断线缩为原宽 50%（8 段）；banner 头分**三行**（👀🟢🔴📈📉📸🔄 动作 / 🕐 时间 / 📡 身份+🎯label），离场单 🏹 同步三行；平仓历史时间精简为 `MM/DD HH:mm` 挪到行尾、`已实现盈亏→盈亏`、**数量单独成行 `数量：N`**（开仓→平仓行不再被数量挤折）。

### 新增

- **每地址独立每日镜像时刻 `at`**：config 项可选 `at`（`HH:MM`），每地址各自触发 SNAPSHOT 可错峰；优先级 地址项 `at` > 全局 `--at` > 默认 `20:00`，非法值告警回退。

### 验证

- `node --check` 通过；`node --test` 41/41 全绿（v2.0 基础上新增 at / fmtTimeShort / formatDisplayId 测试）。

---

## v2.0 — 2026-06-20

多地址 + 平仓历史 + 离场挂单前瞻 + banner 去重。围绕"跟/盯某交易者、预判其操作"的增强。

### 新增

- **多地址监听**：`--config=script/watch.config.json`，一进程同时盯多个地址，各自独立 WS（物理隔离）+ 独立 Telegram 会话（全局 `tgToken` + 每地址 `tgChat`，地址项可选 `tgToken` 覆盖）。
- **离场挂单（reduceOnly）前瞻**：仓位卡片末尾显示该仓的止盈/止损出场计划 `离场挂单 {止盈|止损} @ 价 (全平/部分 量)`；挂/改/撤离场单另发独立轻提醒。这是唯一的前瞻信号。
- **`label` 别名**：config 项可选 `label` 给地址起别名，banner 头显示（具体格式见 v2.1）。
- **模块级共享限流**：所有地址 REST 走同一闸，一处 429/409 全员退避；冷却结束唤醒**全部** watcher（防其余地址漏报冷却期内变化）。
- **内存限容**：长跑去重集合超阈值用当前数据重建，防泄漏。

### 变更

- **平仓历史替换成交历史**：原逐笔成交（trades）+ 客户端回放估算 Realized PnL → 改用 `perps/positions` 的**权威** `realized_pnl` / 资金费 / 均价（更准，直接表达"这个仓位平掉赚了多少"）。客户端按 `updated_at` 降序取最近 N（接口按 position_id 返回，非平仓时间）。
- **banner 去重**：删掉与仓位卡片重复的 `OPENED/CLOSED…` 明细行，banner = 头部（动词由头部表达、币/量/价由仓位卡片表达、平仓由「平仓历史」表达）。通知样式的进一步防折行优化见 v2.1。
- **★ 新记录改键**：从成交 `trade_id` 换为平仓 `position_id`，沿用首帧基线不标、之后标新的机制。

### 删除

- `fetchTradesNext` / `fetchTradesWeb` / `computeRealizedPnl` / `renderTrades` / `--all` 翻页 / `--enable-web-fallback`（trades 备路）。

### 不做（边界）

- 开仓挂单（`R:false`）监听（churn 噪声）；单 WS 多路复用（≤10 地址无收益）；多地址快照（`--config` 与 `--snapshot` 互斥）；部分减仓的即时权威 PnL（接口只返已平仓 size=0）。

### 兼容性

- 保留单地址 CLI：`node script/watch-account.mjs 0xAddr` 行为不变。
- 配置文件含 TG 凭据 → `.gitignore`，仅服务器本地存在。
- 依赖 `ws` 包（`npm install ws`）；代理(WARP)另需 `undici` + `https-proxy-agent`。

### 验证

- `node --test`（script/）32/32 全绿（原 20 + 新增 12）；`node --check` 通过。
- 真实地址 `0x5847…7027`（accountId 3602）端到端实测：平仓历史权威盈亏、离场挂单 TP/SL、G3 排序、G4 数字枚举映射均正确。

---

## v1.1 — 2026-06-19

- 项目结构重组为 `script/` `docs/` `setup/` 目录（commit a24138c）。
- 消息格式化：统一 `fmtNum/fmtUsd/fmtPct/fmtTime`，千分位 + 去尾零 + 北京时间 `YYYY/MM/DD HH:mm:ss`；动词化 banner（commit d977386）。

## v1.0 — 2026-06-18

- 初版：单地址实时 WS 监听 perps 账户，REST 拉成交历史 + 客户端回放估算 Realized PnL。
- 指纹去重 + 防抖合并 + 限流退避 + 失败兜底（per-instance）。
- `--snapshot` 快照模式（按需 + 每日定时）；Telegram 推送；零鉴权（实测验证）（commit c6c43d6 / 013aa20）。
