# VITE_TRACK_URL 全环境统一指向 datasink production

**日期**: 2026-05-13 | **类型**: refactor | **范围**: global

---

## 变更概述

`.env.development` / `.env.preview` 中的 `VITE_TRACK_URL` 切换为与 prod 完全一致的 `https://datasink.sosovalue.com/sa?project=production`，废弃原 `datasink1` 测试子域 + `?project=default`。神策 SDK `server_url`（构建期由 `htmlEnvReplacePlugin` 替换占位）与 saTrack 直连（运行时读 `import.meta.env`）同步切换。

---

## 核心变更

### 1. .env.development

```diff
- VITE_TRACK_URL=https://datasink1.sosovalue.com/sa?project=default
+ VITE_TRACK_URL=https://datasink.sosovalue.com/sa?project=production
```

### 2. .env.preview

```diff
- VITE_TRACK_URL=https://datasink1.sosovalue.com/sa?project=default
+ VITE_TRACK_URL=https://datasink.sosovalue.com/sa?project=production
```

### 3. datasinkSink.ts 顶部注释同步

```diff
- // URL 来自 VITE_TRACK_URL（mainnet → datasink production，其他 → datasink1 default）。
+ // URL 来自 VITE_TRACK_URL（2026-05-13 起全环境统一指向 datasink production）。
```

---

## 文件变更列表

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `.env.development` | 修改 | VITE_TRACK_URL → production |
| `.env.preview` | 修改 | VITE_TRACK_URL → production |
| `.env.production` | 不变 | 已经是 production |
| `src/shared/track/infra/datasinkSink.ts` | 修改 | 顶部注释同步 |
| reference guide | 修改 | 老项目对齐表 + 开发指南 §修改 server_url + 更新记录 |

---

## 风险与限制

- ⚠️ **数据池混流**：dev / preview 测试流量进入生产 `?project=production`，与真实用户事件混在同一 project。看板需用 `channelArea` / `pageId` / `userAgent` / referrer 字段过滤 dev 流量。需要通知数据团队。
- ✅ AES 密钥保留原 dev (`BYFllGY5tLuS06cX`) / prod (`AXEkkFX4sKtR95bW`) 分支，不影响跨环境 distinct_id 隔离。
- ✅ deviceId / anonymousId localStorage 不变，跨版本继承不影响。
- ✅ `datasink1.` 子域如已下线，本次切换可顺带消除 dev 报错。

---

## 关联文档

- **Reference**: `.claude/kit/context/library/sodex-next/reference/global/global-track-guide.md`（老项目对齐表 server_url 行 + 开发指南 §修改 server_url + 更新记录）
