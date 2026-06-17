#!/usr/bin/env node
/**
 * 配置解析器（soso-translation 自包含）
 *
 * 职责：定位 soso-kit 源仓根 → 识别当前项目 → 读/写 projects/<project>.json。
 * 配置「认源仓不认副本」：无论 skill 跑在哪个项目的分发副本里，状态都读写 soso-kit
 * 源仓的 projects/ 目录，从而活过 `sosokit-install` 的 rm -rf 重拷。
 *
 * 配置缺失时自动探测目录布局（locales 路径 / srcDir / namespace 根），写回源仓，提示 review。
 *
 * 作为模块被其他脚本 require；也可独立 CLI 查看/重探：
 *   node resolve-config.cjs            # 打印当前项目解析结果
 *   node resolve-config.cjs --reinit   # 强制重新探测并覆盖写入
 *   node resolve-config.cjs --json     # 仅输出 JSON（供其它脚本/AI 解析）
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// 定位 soso-kit 源仓根：优先 env，其次反查 sosokit-install 软链，最后从本脚本路径上溯
function resolveSosoKitRoot() {
  if (process.env.SOSO_KIT_ROOT && fs.existsSync(process.env.SOSO_KIT_ROOT)) {
    return process.env.SOSO_KIT_ROOT;
  }
  // sosokit-install 软链 → <root>/.claude/kit/cli/install.sh
  try {
    const binPath = execSync("command -v sosokit-install", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (binPath) {
      const real = fs.realpathSync(binPath);
      // .../.claude/kit/cli/install.sh 或 .../.cursor/kit/cli/install.sh → 上溯 4 层到 root
      const marker = real.indexOf(`${path.sep}.claude${path.sep}`) >= 0 ? ".claude" : ".cursor";
      const idx = real.indexOf(`${path.sep}${marker}${path.sep}`);
      if (idx > 0) return real.slice(0, idx);
    }
  } catch {}
  // 本脚本若就在源仓内：.../<root>/.claude/skills/soso-translation/scripts/resolve-config.cjs
  const here = __dirname;
  for (const marker of [".claude", ".cursor"]) {
    const idx = here.indexOf(`${path.sep}${marker}${path.sep}`);
    if (idx > 0) return here.slice(0, idx);
  }
  return null;
}

// 配置目录名（.claude / .cursor），跟随 ~/.sosokit-mode
function resolveConfigDirName() {
  try {
    const modeFile = path.join(process.env.HOME || "", ".sosokit-mode");
    if (fs.existsSync(modeFile)) {
      const mode = fs.readFileSync(modeFile, "utf8").trim();
      if (mode === "cursor") return ".cursor";
    }
  } catch {}
  return ".claude";
}

// 识别当前项目名：git 主仓 basename → cwd basename → package.json name
function identifyProject(cwd) {
  // 1) git 主 worktree 的 basename（覆盖 worktree 场景）
  try {
    const out = execSync("git worktree list", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const first = out.split("\n")[0];
    if (first) {
      const wtPath = first.split(/\s+/)[0];
      if (wtPath) return path.basename(wtPath);
    }
  } catch {}
  // 2) package.json name（取末段，去 scope）
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    if (pkg.name) return String(pkg.name).split("/").pop();
  } catch {}
  // 3) cwd basename
  return path.basename(cwd);
}

function projectsDir(sosoKitRoot, configDirName) {
  return path.join(sosoKitRoot, configDirName, "skills", "soso-translation", "projects");
}

function configPath(sosoKitRoot, configDirName, projectName) {
  return path.join(projectsDir(sosoKitRoot, configDirName), `${projectName}.json`);
}

// 探测：在 projectRoot 下找所有 locales 目录与对应 srcDir，组装 targets
function detectTargets(projectRoot) {
  const targets = [];

  // 候选 locales 相对路径（单仓 + monorepo apps/*）
  const candidates = [];
  for (const rel of ["public/assets/locales", "public/locales"]) {
    candidates.push({ localesRel: rel, srcRel: "src", name: "default" });
  }
  const appsDir = path.join(projectRoot, "apps");
  if (fs.existsSync(appsDir)) {
    for (const app of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (!app.isDirectory()) continue;
      for (const rel of ["public/assets/locales", "public/locales"]) {
        candidates.push({
          localesRel: path.join("apps", app.name, rel),
          srcRel: path.join("apps", app.name, "src"),
          name: app.name,
        });
      }
    }
  }

  for (const c of candidates) {
    const localesAbs = path.join(projectRoot, c.localesRel);
    if (!fs.existsSync(localesAbs)) continue;
    if (!fs.existsSync(path.join(localesAbs, "en"))) continue; // 必须有 en 源
    // srcDir：优先 <app>/src；不存在则用 app 根（如 Next.js pages 目录布局）
    let srcRel = c.srcRel;
    if (!fs.existsSync(path.join(projectRoot, srcRel))) {
      const appRoot = c.name === "default" ? "" : path.join("apps", c.name);
      srcRel = appRoot || "src";
    }
    // namespace 根：features / pages 谁存在就用谁
    const namespaceRoots = [];
    for (const r of ["features", "pages"]) {
      if (fs.existsSync(path.join(projectRoot, srcRel, r))) namespaceRoots.push(r);
    }
    targets.push({
      name: c.name,
      localesDir: c.localesRel.split(path.sep).join("/"),
      srcDir: srcRel.split(path.sep).join("/"),
      namespaceRoots,
      namespaceMap: {},
      fallbackNamespace: "common",
      manualNamespaces: [],
    });
  }
  return targets;
}

// 扫某 localesDir 下除 en 外的语言目录
function listTargetLangs(projectRoot, target) {
  const dir = path.join(projectRoot, target.localesDir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "en")
    .map((d) => d.name)
    .sort();
}

function loadOrDetect({ cwd = process.cwd(), reinit = false } = {}) {
  const sosoKitRoot = resolveSosoKitRoot();
  if (!sosoKitRoot) {
    throw new Error(
      "无法定位 soso-kit 源仓根：请设置 SOSO_KIT_ROOT 环境变量，或确保 sosokit-install 在 PATH 上",
    );
  }
  const configDirName = resolveConfigDirName();
  const projectRoot = cwd;
  const projectName = identifyProject(projectRoot);
  const cfgPath = configPath(sosoKitRoot, configDirName, projectName);

  let config = null;
  if (!reinit && fs.existsSync(cfgPath)) {
    config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } else {
    const targets = detectTargets(projectRoot);
    config = {
      version: 1,
      projectName,
      projectRoot,
      detectedAt: process.env.SOSO_TRANSLATION_DATE || "",
      targets,
    };
    const dir = projectsDir(sosoKitRoot, configDirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  }

  return { sosoKitRoot, configDirName, projectName, projectRoot, cfgPath, config };
}

// 按 name 选 target（monorepo 多 target 时）；不传 name 且只有一个 target 时返回它
function pickTarget(config, name) {
  const targets = config.targets || [];
  if (name) {
    const t = targets.find((t) => t.name === name);
    if (!t) throw new Error(`未找到 target "${name}"，可用: ${targets.map((t) => t.name).join(", ")}`);
    return t;
  }
  if (targets.length === 1) return targets[0];
  return null; // 多 target 必须显式指定
}

module.exports = {
  resolveSosoKitRoot,
  resolveConfigDirName,
  identifyProject,
  loadOrDetect,
  pickTarget,
  listTargetLangs,
};

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  const reinit = args.includes("--reinit");
  const jsonOnly = args.includes("--json");
  try {
    const r = loadOrDetect({ reinit });
    if (jsonOnly) {
      console.log(JSON.stringify(r.config, null, 2));
    } else {
      console.log(`soso-kit 源仓 : ${r.sosoKitRoot}`);
      console.log(`配置目录     : ${r.configDirName}`);
      console.log(`项目名       : ${r.projectName}`);
      console.log(`配置文件     : ${r.cfgPath}`);
      console.log(`targets      : ${(r.config.targets || []).length} 个`);
      for (const t of r.config.targets || []) {
        const langs = listTargetLangs(r.projectRoot, t);
        console.log(`  • ${t.name}: ${t.localesDir}`);
        console.log(`    srcDir=${t.srcDir} roots=[${(t.namespaceRoots || []).join(",")}] 语言(${langs.length})=${langs.join(",")}`);
      }
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
