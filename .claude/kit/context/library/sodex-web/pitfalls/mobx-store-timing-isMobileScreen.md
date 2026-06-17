---
id: mobx-store-timing-isMobileScreen
tags: [mobx, store, isMobileScreen, timing, useEffect, matchMedia]
related_feature: user-auth-enable
severity: high
gate: true
gate_rule: 需要同步获取屏幕尺寸时，禁止依赖 MobX ui.isMobileScreen（初始值 false，异步更新），必须用 window.matchMedia 同步检测
trigger: [isMobileScreen, store, mobx, mobile, 移动端, 屏幕]
date: 2026-04-09
---

# MobX ui.isMobileScreen 初始值时序问题

## 问题描述

移动端 Enable Trading 后刷新页面，又需要重新 Enable Trading。原因是 `validatePrivateKey` 在页面加载早期执行，此时 `ui.isMobileScreen` 还是初始值 `false`，导致查询了错误的 key name（`webkey` 而非 `mobilekey`），服务端未找到记录，判定为需要重签。

## 调试过程中的误判

最初以为是 key name 映射逻辑有误，实际是 MobX store 的初始化时序问题。`ui.isMobileScreen` 由 `useIsMobileScreen` hook 在 `RouteSwitch` 组件中通过 `useEffect` 异步设置，但 `usePrivateKeyRefresh` 的 useEffect 依赖 `[user.realId, user.address]`，这两个值先于 `isMobileScreen` 就绪，导致 `validatePrivateKey` 提前执行。

## 根因

`ui.isMobileScreen` 初始值为 `false`（`models/ui.ts:51`），通过 `useIsMobileScreen` → `useEffect` → `ui.setIsMobileScreen()` 异步更新。任何在此更新之前执行的代码都会读到错误值。

## 避免方式

- 需要**同步**获取屏幕尺寸时，直接用 `window.matchMedia("(max-width:759.99px)").matches`
- `ui.isMobileScreen` 仅适用于 React 渲染场景（组件内响应式更新），不适用于非渲染路径的早期逻辑（如 API 调用、私钥校验）
- 项目中已封装 `apiKeyName.ts` 的 `isMobile()` 函数作为同步检测方案
