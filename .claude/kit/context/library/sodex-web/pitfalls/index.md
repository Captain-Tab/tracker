# Pitfalls 索引

记录开发中遇到的真实问题，供 AI agent 按需加载。

| ID | 标签 | 标题 | 一句话描述 |
|----|------|------|-----------|
| trade-feerate-mobx | mobx,store,react,响应式 | MobX 缺少 makeObservable | 数据写入 store 但组件不重新渲染，根因是 makeObservable 未调用 |
| mobx-store-timing-isMobileScreen | mobx,store,isMobileScreen,timing,useEffect,matchMedia | MobX ui.isMobileScreen 初始值时序问题 | 需要同步获取屏幕尺寸时禁止依赖 MobX store，必须用 window.matchMedia |
| async-mock-hides-timing-bug | mock,async,useState,redirect,timing | 异步数据 Mock 陷阱：同步 Mock 隐藏时序 Bug | 同步 mock 跳过异步时序，隐藏 useState 初始值导致的跳转死循环 |
| multi-state-missing-transition | state-machine,redirect,useEffect,spec | 多状态遗漏转换路径：spec 定义错误导致 check 也无法捕获 | 需求涉及多状态时 spec 未构建 N×N 转换矩阵，遗漏 1→2 降级路径 |
