# Spec 05 · 隔离架构与部署

> 引用总纲 `00-overview.md`。流程 / 状态机 / 共享契约以总纲为准，本文只定义本子单元自身，**冲突以总纲为准**。
> 依赖：03（reconcile + dry-run，有可跑执行器入口 `service/HYPE-copy/main.mjs`）、04（推送 + 日志）。
> 落地时本 spec 已读，**勿重新生成**；直接 `/k:task` 执行本阶段。

---

## 背景与目的

执行写侧需要与读侧（watch / discovery）做**用户级 + 进程级隔离**，并为后续真实签名预置 agent wallet 安全注入通道。本子件落地总纲 §0 前置第 3 条（隔离架构就位、wallet 注入留占位）与 §5 集成点的 `service/app/index.mjs` 编排 + `HYPE-copy@.service` 模板单元。

对应 clarify「隔离与安全」「Agent Wallet」段：
- 写侧每目标独立进程 + 独立 agent wallet/子账户（一钱包一进程签名 → nonce 隔离）。
- 主私钥不上服务器；agent key 只能交易/撤单不能提现；systemd `LoadCredential` 注入。
- **dry-run 阶段不需要真 key**：隔离架构（trader-exec 用户 / systemd 模板 / 资源上限 / targets.json 权限）全部就位，wallet 注入留占位（不签名）。

依据：`docs/server-architecture.md` §6.4（Rust 执行服务范式：trader-exec 用户 / LoadCredential / 资源上限 / 加固选项）、§9（钱包与 nonce 隔离规则）。本子件把该范式套到 Node 执行器上（`ExecStart` 换成 `node main.mjs`，其余加固原样沿用）。

## 选定方案

落点（遵守 feature-components-layout：编排逻辑并入既有单文件 CLI，不新建文件夹）：

| 落点 | 改动 |
|---|---|
| `service/app/index.mjs` | 新增 `HYPE-copy@.service` 模板单元生成函数 + 纳入 `buildUnits`（参考既有 `hypeWatchUnit` 范式）；config 新增 `hypeCopy` 段控制 enable/target 列表 |
| `service/HYPE-copy/targets.json` | 部署后置为 `chmod 600` + `chown trader-exec`（仅 trader-exec 可读） |

**不新建独立 systemd 文件**：沿用 `service/app/index.mjs` 既有「config → 生成 unit 字符串 → apply 写盘 + daemon-reload」的集中编排模式，保持单一事实源。模板单元用 systemd 实例化语法 `HYPE-copy@<target>.service`，`<target>` = targets.json 的 `target.id`。

## 设计概要

### 数据来源

- 复用总纲 §3.1 `targets.json`（单目标）：`target.id`（→ 实例名）、`target.agentKeyRef`（→ LoadCredential 名，dry-run 可空）、`target.dryRun`（恒 true）。
- 复用 `service/app/index.mjs` 既有契约：`warpDeps(cfg)` / `envLines(cfg)` / `buildUnits(cfg)` / `apply` 写盘逻辑（直接 import 风格复用，不重写）。
- 复用 §3.2 `loadTargets`（01 实现）做实例名校验：编排时读 targets.json 取 `target.id`。

### 隔离三层（user / process / wallet）

| 层 | 机制 | dry-run 阶段 |
|---|---|---|
| 用户隔离 | `User=trader-exec` `Group=trader-exec`（独立写侧用户，与读侧 tracker 分离） | 就位 |
| 进程隔离 | 每目标一个 `HYPE-copy@<id>.service` 实例 = 独立进程；一钱包一进程签名（§9 nonce 隔离） | 就位（单目标即单实例） |
| wallet 注入 | `LoadCredential=agent-key:/etc/tracker/HYPE-copy-<id>-agent.key`；程序内读 `$CREDENTIALS_DIRECTORY/agent-key` | **留占位**：dryRun=true 时不输出 LoadCredential 行（无真 key），仅注释标注「真实下单阶段启用」 |

### 模板单元字段（套 §6.4 范式 + Node 化）

```ini
# /etc/systemd/system/HYPE-copy@.service（%i = target.id）
[Unit]
Description=HYPE Copy-Trade Executor (%i)
After=network-online.target
Wants=network-online.target
Requires=warp-svc.service          # 复用 warpDeps(cfg)
After=warp-svc.service
OnFailure=tracker-alert@%n.service # 复用既有失败告警（§6.3）

[Service]
Type=simple
User=trader-exec
Group=trader-exec
WorkingDirectory=<ROOT_DIR>/HYPE-copy
ExecStart=<NODE_BIN> <ROOT_DIR>/HYPE-copy/main.mjs --target=%i --config=<ROOT_DIR>/HYPE-copy/targets.json
Environment=HTTP_PROXY=...          # 复用 envLines(cfg)
Environment=HTTPS_PROXY=...
Restart=always
RestartSec=10
MemoryMax=128M                      # §6.4 资源上限
CPUQuota=80%
TasksMax=32
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
# 真实下单阶段启用（dry-run 不注入，无主私钥/agent key）：
# LoadCredential=agent-key:/etc/tracker/HYPE-copy-%i-agent.key
StandardOutput=journal
StandardError=journal
SyslogIdentifier=HYPE-copy-%i

[Install]
WantedBy=multi-user.target
```

### config 与编排（并入 service/app/index.mjs）

- `DEFAULT_CONFIG` 新增：`hypeCopy: { enabled: false, targets: [] }`（默认关，避免误开未就绪执行器；`targets` = 要 enable 的实例 id 数组，留空则只装模板不 enable 实例）。
- `loadConfig` 新增 `hypeCopy` 归一化（`enabled !== true` 默认 false；`targets` 取数组否则空）。
- 新增 `hypeCopyTemplateUnit(cfg, target)`：生成模板单元字符串（`<target>` 用字面 `%i`，资源上限 + 加固字段照上表，dry-run 不输出 LoadCredential）。
- `buildUnits`：装一份模板 `HYPE-copy@.service`（`control:false`，模板本身不 enable），再为 `hypeCopy.targets` 每个 id 装 `{ name: "HYPE-copy@<id>.service", enabled: cfg.hypeCopy.enabled, control: true }`。
- `apply`：实例单元走既有 enable/start 逻辑（无需改 apply 主体，只是 `buildUnits` 多产几个条目）。
- `render` / `status`：相应打印 hypeCopy 模板 + 各实例 enable/active（沿用既有循环，把 HYPE-copy 实例名加入观测列表）。

### targets.json 权限收敛

部署文档（`docs/copy/hype.md`，04 已建）补一节运维命令：

```bash
sudo chown trader-exec:trader-exec <ROOT_DIR>/HYPE-copy/targets.json
sudo chmod 600 <ROOT_DIR>/HYPE-copy/targets.json   # 仅 trader-exec 可读，含 agentKeyRef
```

> `service/app/index.mjs` 的 `apply` **不**自动 chmod targets.json（CLI 以 root 跑系统单元，但 targets.json 属业务配置，权限收敛走部署文档手动执行，避免 CLI 越权改业务文件）。

## i18n 文案（汇总进 i18n 横切 spec）

无（纯部署/编排，无 UI）。

## 边界与约束

- 包含：`HYPE-copy@.service` 模板单元生成（trader-exec / 资源上限 / 加固 / OnFailure 复用）；纳入 `service/app/index.mjs` 编排（config 段 + buildUnits + render/status）；每目标独立进程 = nonce 隔离；wallet 注入占位（dry-run 不输出 LoadCredential）；targets.json 权限收敛（部署文档）。
- 不包含：真实 agent key 生成/注入/签名（后续 gated 阶段，仅留注释占位）；trader-exec 用户创建（部署文档一次性 `useradd`，非本 CLI 职责）；控制面 HTTP（`/flatten` `/untrack`，§8 后续阶段）；多目标实例（一期单目标硬限制，§3.1 `targets.length>1` 由 01 拒绝启动，编排侧 `hypeCopy.targets` 也只配单 id）。
- 约束：模板单元 ExecStart 用 `%i` 传 `--target`，与 01 `loadTargets` 的实例选择对齐；不删既有 sodex-/HYPE- 单元；apply 仅内容变才 restart（沿用既有幂等逻辑，不误伤在跑实例）。

## 集成点

- `service/app/index.mjs` — 既有 `warpDeps` / `envLines` / `buildUnits` / `loadConfig` / `apply` / `render` / `status`（复用，新增 hypeCopy 分支）。
- `service/HYPE-copy/main.mjs` — 03 入口，接收 `--target=%i`（实例名 → loadTargets 选目标）。
- `service/HYPE-copy/targets.json` — §3.1 schema（含 `agentKeyRef` 占位）。
- `docs/copy/hype.md` — 04 已建，本件补「隔离部署 + targets.json 权限 + trader-exec 用户」运维节。
- `docs/server-architecture.md` §6.4 / §9 — 范式来源（不改，引用）。

## 验收标准

- [ ] `node service/app/index.mjs render` 输出含 `HYPE-copy@.service` 模板单元，字段含 `User=trader-exec`、`MemoryMax`、`CPUQuota`、`NoNewPrivileges`、`ProtectSystem=strict`（套 §6.4）。
- [ ] dry-run 阶段：模板单元**不含** `LoadCredential` 生效行（仅注释占位），不依赖真 key 即可 apply。
- [ ] `hypeCopy.enabled=false`（默认）时：装模板但不 enable 任何实例；`enabled=true` + `targets:["<id>"]` 时：enable 对应 `HYPE-copy@<id>.service` 实例。
- [ ] 每目标一实例 = 独立进程（§9 一钱包一进程，nonce 隔离）；编排不为同一 id 装两份。
- [ ] `ExecStart` 含 `--target=%i`，与 01 `loadTargets` 实例选择契合。
- [ ] 既有 sodex-/HYPE-watch/discovery 单元不受影响（buildUnits 仅追加，apply 幂等仅内容变才 restart）。
- [ ] 部署文档 `docs/copy/hype.md` 含 trader-exec 用户创建 + targets.json `chmod 600`/`chown trader-exec` 命令。
- [ ] `scheduleToOnCalendar` 等既有单测不被破坏（本件不动 schedule 逻辑）。

## 验收场景（Given/When/Then）

### 场景 1：dry-run 模板单元就位但不注入 key
- **Given** `config.json` 配 `hypeCopy: { enabled: true, targets: ["whale1"] }`，targets.json 单目标 `id="whale1"` `dryRun=true` `agentKeyRef` 空
- **When** 执行 `node service/app/index.mjs render`
- **Then** 输出 `HYPE-copy@.service` 模板（`User=trader-exec` / `MemoryMax=128M` / 加固字段齐全）+ `HYPE-copy@whale1.service`（enable）；模板**无** `LoadCredential` 生效行，仅注释 `# 真实下单阶段启用`；不报缺 key 错误

### 场景 2：进程隔离 = nonce 隔离（单实例单进程）
- **Given** 单目标 `whale1`，`hypeCopy.targets=["whale1"]`
- **When** apply（systemd 服务器）
- **Then** 仅起一个 `HYPE-copy@whale1.service` 进程，ExecStart 带 `--target=whale1`；该进程独占其 agent wallet 签名通道（§9：一钱包一进程，dry-run 阶段不签名但进程边界已就位），不与读侧 tracker 用户进程共享

### 场景 3：targets.json 仅 trader-exec 可读
- **Given** 部署后 targets.json 含 `agentKeyRef`
- **When** 按 `docs/copy/hype.md` 执行 `chown trader-exec:trader-exec` + `chmod 600`
- **Then** 其他用户（含读侧 tracker）无法读 targets.json；仅 `HYPE-copy@<id>.service`（trader-exec 身份）能加载目标配置

### 场景 4：默认不误开执行器
- **Given** `config.json` 缺 `hypeCopy` 段（或 `enabled` 非 true）
- **When** apply
- **Then** 装入 `HYPE-copy@.service` 模板（备用）但**不 enable/start 任何实例**；既有 sodex-/HYPE-watch/discovery 单元状态不变
