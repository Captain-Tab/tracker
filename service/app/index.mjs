#!/usr/bin/env node
// app 服务编排：读 app/config.json（缺则默认 both on）→ 生成/同步 systemd 单元。
//   sodex/HYPE 各：watch.service（长驻守护）+ discovery.service(oneshot) + discovery.timer（周期触发），共 6 单元。
// 独立 systemd 单元 = 进程隔离（一个崩不连累其他）；config + 本 CLI = 集中管理。两 discovery 默认错峰（sodex 9 点 / HYPE 10 点）。
//
// 子命令：
//   render  打印将生成的 unit 内容 + 计划动作，不写不改（本机可跑，不调 systemctl）
//   apply   写变化的 unit → daemon-reload → 按 enabled 启停 → 仅内容变才 restart → 迁旧单元（root+systemd）
//   status  打印 config + sodex-watch.service / sodex-discovery.timer 的 enable/active + timer 下次触发
//
// 零依赖（node:fs / child_process / path / url）。OnCalendar 带 Asia/Shanghai（不依赖系统时区，与 watch 一致）。
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, ".."); // service/（代码根；VPS 上即 /root/service）
const NODE_BIN = process.execPath;
const SYSTEMD_DIR = "/etc/systemd/system";
// 重组前的旧单元名，apply 时迁移（防与新 sodex-* 单元双开）：
// watch-account.service（最早）/ watch.service / discovery.service / discovery.timer（改名前）
const LEGACY_UNITS = ["watch-account.service", "watch.service", "discovery.service", "discovery.timer"];

// 星期数字 → systemd 名（cron 习惯：0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat）
const DOW_CRON = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 注：watch/discovery 键控制 sodex-* 单元（沿用旧键名，不改避免 live config 漏键误开）；
// hypeWatch/hypeDiscovery 控制 HYPE-* 单元。两 discovery 默认错峰（sodex 9 点 / HYPE 10 点）。
const DEFAULT_CONFIG = {
  watch: { enabled: true },
  // schedule.day（weekly）用 cron 数字：0=周日..6=周六；默认 1=周一
  discovery: { enabled: true, schedule: { freq: "weekly", day: 1, hour: 9 } },
  hypeWatch: { enabled: true },
  hypeDiscovery: { enabled: true, schedule: { freq: "weekly", day: 1, hour: 10 } },
  deploy: { proxyUrl: "http://127.0.0.1:40000", requiresWarp: true },
};

// ---------- 配置加载 + 校验（缺文件/非法 → 默认 both on）----------
// schedule: freq∈{weekly,monthly,daily}；weekly day=0..6(cron,0=Sun)，默认 1；monthly day=1..28，默认 1；hour 0..23
function normalizeSchedule(s) {
  s = s ?? {};
  const freq = ["weekly", "monthly", "daily"].includes(s.freq) ? s.freq : "weekly";
  const hourRaw = Number(s.hour);
  const hour = Number.isInteger(hourRaw) ? Math.max(0, Math.min(23, hourRaw)) : 9;
  let day = null;
  if (freq === "weekly") { const d = Number(s.day); day = Number.isInteger(d) && d >= 0 && d <= 6 ? d : 1; }
  else if (freq === "monthly") { const d = Number(s.day); day = Number.isInteger(d) && d >= 1 && d <= 28 ? d : 1; }
  return { freq, day, hour };
}

function loadConfig() {
  const path = join(__dirname, "config.json");
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      watch: { enabled: raw.watch?.enabled !== false },
      discovery: { enabled: raw.discovery?.enabled !== false, schedule: normalizeSchedule(raw.discovery?.schedule) },
      hypeWatch: { enabled: raw.hypeWatch?.enabled !== false },
      hypeDiscovery: { enabled: raw.hypeDiscovery?.enabled !== false, schedule: normalizeSchedule(raw.hypeDiscovery?.schedule ?? DEFAULT_CONFIG.hypeDiscovery.schedule) },
      deploy: {
        proxyUrl: raw.deploy?.proxyUrl ?? DEFAULT_CONFIG.deploy.proxyUrl,
        requiresWarp: raw.deploy?.requiresWarp !== false,
      },
    };
  } catch (e) {
    console.error(`config.json 解析失败，回退默认：${e.message}`);
    return DEFAULT_CONFIG;
  }
}

// schedule → systemd OnCalendar（带显式 Asia/Shanghai，不依赖系统时区）
export function scheduleToOnCalendar(s) {
  const hh = String(s.hour).padStart(2, "0");
  if (s.freq === "daily") return `*-*-* ${hh}:00:00 Asia/Shanghai`;
  if (s.freq === "weekly") return `${DOW_CRON[s.day]} *-*-* ${hh}:00:00 Asia/Shanghai`;
  return `*-*-${String(s.day).padStart(2, "0")} ${hh}:00:00 Asia/Shanghai`; // monthly
}

// ---------- systemd unit 模板 ----------
function warpDeps(cfg) {
  return cfg.deploy.requiresWarp ? ["After=warp-svc.service", "Requires=warp-svc.service"] : [];
}
function envLines(cfg) {
  const p = cfg.deploy.proxyUrl;
  return p ? [`Environment=HTTP_PROXY=${p}`, `Environment=HTTPS_PROXY=${p}`] : [];
}

function watchUnit(cfg) {
  return [
    "[Unit]", "Description=Sodex Account Watcher", "After=network-online.target",
    ...warpDeps(cfg), "Wants=network-online.target", "",
    "[Service]", "Type=simple",
    `ExecStart=${NODE_BIN} ${ROOT_DIR}/sodex-watch/main.mjs --config=${ROOT_DIR}/sodex-watch/config.json`,
    ...envLines(cfg), "Restart=always", "RestartSec=10", "",
    "[Install]", "WantedBy=multi-user.target", "",
  ].join("\n");
}
function discoveryServiceUnit(cfg) {
  return [
    "[Unit]", "Description=Sodex Copy-Trade Discovery", "After=network-online.target",
    ...warpDeps(cfg), "",
    "[Service]", "Type=oneshot",
    `ExecStart=${NODE_BIN} ${ROOT_DIR}/sodex-discovery/main.mjs`,
    ...envLines(cfg), "",
  ].join("\n");
}
function discoveryTimerUnit(cfg) {
  return [
    "[Unit]", "Description=Sodex Copy-Trade Discovery Timer", "",
    "[Timer]", `OnCalendar=${scheduleToOnCalendar(cfg.discovery.schedule)}`, "Persistent=true", "",
    "[Install]", "WantedBy=timers.target", "",
  ].join("\n");
}

// HYPE 单元（与 sodex 对称：watch 长驻 / discovery oneshot + timer）
function hypeWatchUnit(cfg) {
  return [
    "[Unit]", "Description=HYPE Account Watcher", "After=network-online.target",
    ...warpDeps(cfg), "Wants=network-online.target", "",
    "[Service]", "Type=simple",
    `ExecStart=${NODE_BIN} ${ROOT_DIR}/HYPE-watch/main.mjs --config=${ROOT_DIR}/HYPE-watch/config.json`,
    ...envLines(cfg), "Restart=always", "RestartSec=10", "",
    "[Install]", "WantedBy=multi-user.target", "",
  ].join("\n");
}
function hypeDiscoveryServiceUnit(cfg) {
  return [
    "[Unit]", "Description=HYPE Copy-Trade Discovery", "After=network-online.target",
    ...warpDeps(cfg), "",
    "[Service]", "Type=oneshot",
    `ExecStart=${NODE_BIN} ${ROOT_DIR}/HYPE-discovery/main.mjs`,
    ...envLines(cfg), "",
  ].join("\n");
}
function hypeDiscoveryTimerUnit(cfg) {
  return [
    "[Unit]", "Description=HYPE Copy-Trade Discovery Timer", "",
    "[Timer]", `OnCalendar=${scheduleToOnCalendar(cfg.hypeDiscovery.schedule)}`, "Persistent=true", "",
    "[Install]", "WantedBy=timers.target", "",
  ].join("\n");
}

// 单元清单。controlUnit = 实际 enable/start 的单元（discovery 控 timer，service 由 timer 触发不直接 enable）。
function buildUnits(cfg) {
  return [
    { name: "sodex-watch.service", content: watchUnit(cfg), enabled: cfg.watch.enabled, control: true },
    { name: "sodex-discovery.service", content: discoveryServiceUnit(cfg), enabled: cfg.discovery.enabled, control: false },
    { name: "sodex-discovery.timer", content: discoveryTimerUnit(cfg), enabled: cfg.discovery.enabled, control: true },
    { name: "HYPE-watch.service", content: hypeWatchUnit(cfg), enabled: cfg.hypeWatch.enabled, control: true },
    { name: "HYPE-discovery.service", content: hypeDiscoveryServiceUnit(cfg), enabled: cfg.hypeDiscovery.enabled, control: false },
    { name: "HYPE-discovery.timer", content: hypeDiscoveryTimerUnit(cfg), enabled: cfg.hypeDiscovery.enabled, control: true },
  ];
}

// 错峰检查（NFR 硬约束）：两 discovery 都 enabled 且 OnCalendar 相同 → 返回告警串，否则 null。
function staggerWarning(cfg) {
  if (!cfg.discovery.enabled || !cfg.hypeDiscovery.enabled) return null;
  const a = scheduleToOnCalendar(cfg.discovery.schedule);
  const b = scheduleToOnCalendar(cfg.hypeDiscovery.schedule);
  if (a === b) return `⚠️ 错峰告警：sodex-discovery 与 HYPE-discovery 的 OnCalendar 相同（${a}），两个 32MB 级解析会叠加内存峰值。建议调不同时刻。`;
  return null;
}

// ---------- systemd 探测 + 执行 ----------
function hasSystemd() {
  try { execSync("command -v systemctl", { stdio: "ignore" }); return true; } catch { return false; }
}
function sh(cmd) { execSync(cmd, { stdio: "inherit" }); }
function isActive(unit) {
  try { execSync(`systemctl is-active --quiet ${unit}`); return true; } catch { return false; }
}
function unitExists(unit) { return existsSync(join(SYSTEMD_DIR, unit)); }
function readInstalled(unit) {
  const p = join(SYSTEMD_DIR, unit);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

// ---------- render：干跑 ----------
function render(cfg) {
  console.log("# app 编排 render（干跑，不写不改）\n");
  console.log(`# config: sodex watch=${cfg.watch.enabled} discovery=${cfg.discovery.enabled}@${cfg.discovery.schedule.hour}时 → ${scheduleToOnCalendar(cfg.discovery.schedule)}`);
  console.log(`#         HYPE  watch=${cfg.hypeWatch.enabled} discovery=${cfg.hypeDiscovery.enabled}@${cfg.hypeDiscovery.schedule.hour}时 → ${scheduleToOnCalendar(cfg.hypeDiscovery.schedule)}`);
  console.log(`#         deploy.proxyUrl=${cfg.deploy.proxyUrl} requiresWarp=${cfg.deploy.requiresWarp}`);
  const warn = staggerWarning(cfg);
  if (warn) console.log(`# ${warn}`);
  console.log("");
  for (const u of buildUnits(cfg)) {
    console.log(`===== ${SYSTEMD_DIR}/${u.name} (${u.enabled ? "enable" : "disable"})${u.control ? "" : " [由 timer 触发，不直接 enable]"} =====`);
    console.log(u.content);
  }
  console.log("# 计划动作（apply 时执行）：");
  console.log(`#   - 写入变化的 unit → daemon-reload`);
  console.log(`#   - sodex-watch.service: ${cfg.watch.enabled ? "enable + start" : "disable --now"} / HYPE-watch.service: ${cfg.hypeWatch.enabled ? "enable + start" : "disable --now"}`);
  console.log(`#   - sodex-discovery.timer: ${cfg.discovery.enabled ? "enable --now" : "disable --now"} / HYPE-discovery.timer: ${cfg.hypeDiscovery.enabled ? "enable --now" : "disable --now"}`);
  console.log(`#   - 迁移旧单元（若存在）：${LEGACY_UNITS.join(" / ")} → disable --now + 删除`);
}

// ---------- apply：写 + 同步（幂等，仅内容变才 restart）----------
function apply(cfg) {
  const warn = staggerWarning(cfg);
  if (warn) console.log(warn);
  // 迁移旧单元：防与新 sodex-* 单元双开
  for (const old of LEGACY_UNITS) {
    if (unitExists(old) || isActive(old)) {
      console.log(`迁移旧单元 ${old} → disable --now + 删除`);
      try { sh(`systemctl disable --now ${old}`); } catch {}
      try { execSync(`rm -f ${join(SYSTEMD_DIR, old)}`); } catch {}
    }
  }

  const units = buildUnits(cfg);
  let anyChanged = false;
  const changedSet = new Set();
  for (const u of units) {
    const installed = readInstalled(u.name);
    if (installed !== u.content) {
      writeFileSync(join(SYSTEMD_DIR, u.name), u.content, "utf8");
      anyChanged = true;
      changedSet.add(u.name);
      console.log(`写入 ${u.name}（${installed === null ? "新建" : "内容变化"}）`);
    }
  }
  if (anyChanged) sh("systemctl daemon-reload");

  for (const u of units) {
    if (!u.control) continue; // sodex-discovery.service 由 timer 触发，不直接 enable
    if (u.enabled) {
      sh(`systemctl enable ${u.name}`);
      if (!isActive(u.name)) sh(`systemctl start ${u.name}`);
      else if (changedSet.has(u.name)) sh(`systemctl restart ${u.name}`); // 仅内容变才重启，不误伤在跑的 watch
    } else {
      sh(`systemctl disable --now ${u.name}`);
    }
  }
  console.log("✅ apply 完成");
}

// ---------- status ----------
function status(cfg) {
  console.log(`config: sodex watch=${cfg.watch.enabled} discovery=${cfg.discovery.enabled}@${scheduleToOnCalendar(cfg.discovery.schedule)}`);
  console.log(`        HYPE  watch=${cfg.hypeWatch.enabled} discovery=${cfg.hypeDiscovery.enabled}@${scheduleToOnCalendar(cfg.hypeDiscovery.schedule)}`);
  const warn = staggerWarning(cfg);
  if (warn) console.log(warn);
  for (const u of ["sodex-watch.service", "sodex-discovery.timer", "HYPE-watch.service", "HYPE-discovery.timer"]) {
    const en = (() => { try { return execSync(`systemctl is-enabled ${u}`).toString().trim(); } catch { return "disabled/absent"; } })();
    const ac = isActive(u) ? "active" : "inactive";
    console.log(`  ${u}: enabled=${en} active=${ac}`);
  }
  try { sh("systemctl list-timers sodex-discovery.timer HYPE-discovery.timer --no-pager"); } catch {}
}

function main() {
  const cmd = process.argv[2] ?? "status";
  const cfg = loadConfig();

  if (cmd === "render") { render(cfg); return; }

  if (cmd === "apply" || cmd === "status") {
    if (!hasSystemd()) {
      console.error(`❌ '${cmd}' 仅在 systemd 服务器上可用（本机无 systemctl）。本机请用 'render' 审查生成内容。`);
      process.exit(1);
    }
    if (cmd === "apply") apply(cfg);
    else status(cfg);
    return;
  }

  console.error("用法: node service/app/index.mjs <render|apply|status>");
  process.exit(1);
}

// 仅作为入口直接运行时执行；被 import（如单测 scheduleToOnCalendar）时不触发
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

