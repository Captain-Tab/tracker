# 认证与权限体系

## Lark OAuth 登录流程

1. 用户访问 `/login`，点击 Lark 登录按钮
2. Lark OAuth 回调返回 `code`
3. `loginWithLark(code)` → 调用 `getLarkAccessToken({ code })` 获取 `access_token`
4. `extractBearerToken()` 提取 JWT，存入 cookie（带过期时间）
5. `getLarkUser()` → 调用 `getUserInfo()` 获取用户信息，存入 localStorage
6. 导航到 `/`

## Token 存储与验证

- **存储**：`userCookies`（cookie）存 JWT，`userStorages`（localStorage）存用户信息 JSON
- **验证**：`isJWTExpired(token)` 检查 JWT 是否过期
- **清除**：登出或 401 时清除 cookie + localStorage，跳转 `/login`

## UserProvider 上下文

文件：`src/context/UserProvider.tsx`

| 字段/方法 | 类型 | 说明 |
|-----------|------|------|
| `user` | UserInfoData \| null | 当前用户信息 |
| `isAuthenticated` | boolean | 是否已认证（user 存在且 cookie 有效） |
| `isLoading` | boolean | 登录/获取用户信息加载中 |
| `hasPermission(code)` | (string) => boolean | 检查 `user.permissions.page` 是否包含指定权限码 |
| `hasRole(role)` | (string) => boolean | 检查 `user.roles` 是否包含指定角色 |
| `pagePermissions` | string[] | `user.permissions.page` 数组 |
| `loginWithLark(code)` | (string) => Promise | Lark OAuth 登录 |
| `logout()` | () => void | 登出并跳转 |
| `checkTokenExpiry()` | () => boolean | JWT 是否已过期 |
| `mfaBound` | boolean | MFA 是否已绑定 |
| `mfaLoading` | boolean | MFA 状态加载中 |
| `fetchMfaStatus()` | () => Promise\<void\> | 获取 MFA 状态 |
| `updateMfaStatus(bound)` | (boolean) => void | 更新 MFA 状态 |
| `authData` | any[] \| null | 认证数据 |

白名单路径（`/login`）不做认证检查。其余路径在 `useEffect` 中自动校验 token + 用户信息。

## MfaProvider 的 withMfa() 模式

文件：`src/context/MfaProvider.tsx`

`withMfa` 用于给需要 MFA 验证的 API 调用包一层弹窗：

```typescript
const { withMfa } = useMfa();
const deleteWithMfa = withMfa(deleteItem); // deleteItem 最后一个参数为 mfaCode
await deleteWithMfa(itemId); // 自动弹出 MFA 输入框，用户输入后调用 deleteItem(itemId, mfaCode)
```

- 未绑定 MFA → `toast.error` 提示并 reject
- 用户取消弹窗 → reject（"用户取消 MFA 验证"）
- 验证失败 → 弹窗内显示错误，不关闭

## 权限代码规范

格式：`page:<module>` 或 `page:<parent>:<child>`

| 权限码 | 对应模块 |
|--------|---------|
| `page:banners` | 通知栏配置 |
| `page:risk-control` | 风险控制 |
| `page:symbol-config` | 币对管理 |
| `page:systemManager:users` | 用户管理 |
| `page:systemManager:roles` | 角色管理 |
| `page:systemManager:permission` | 权限管理 |
| `page:systemManager:operation-log` | 操作日志 |

## 路由级权限守卫

`PermissionRoute.tsx`：用 `hasPermission(code)` 判断，无权限显示"访问被拒绝"。
仅 `menuConfig` 中设了 `code` 的顶层路由受保护。

## 侧边栏菜单权限过滤

`Sidebar.tsx` 的 `filteredMenuConfig` 递归过滤 `menuConfig`：
- 有 `route.code` 的菜单项 → `hasPermission(code)` 为 false 则隐藏
- 父菜单的所有子菜单都被过滤 → 父菜单也隐藏
