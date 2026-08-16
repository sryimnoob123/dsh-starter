# win-terminal-inspector —— 捆绑的第三方 bug-fix 插件

## 是什么

第三方插件 **dsh-win-terminal-inspector**（作者 clearkurt，MIT 许可），本目录是 vendor 进来的副本。
上游：https://github.com/clearkurt/dsh-win-terminal-inspector

- vendor 自上游 commit `c8c5e5afb50a7fd04aa0db8c313eb150cb7bc5b6`（2026-08-14）
- 代码**原样拷贝、未做任何修改**（`index.js` / `lib/inspector.js` / `package.json` / `LICENSE` 与上游逐字节一致）

本项目按既定策略「插件只捆绑修恶性 bug 的这一种」把它打进安装包，用于修复 DSH 在
Windows 上的持久终端崩溃。

## 解决什么问题

DSH 官方 `@deepseek-ai/dsh-subprocess-local` 的 `createProcessInspector()` 只实现了两个
平台后端：Linux（读 `/proc`）和 macOS（调 `/bin/ps`），**没有 Windows 后端**。

因此 Windows 上任何「持久终端」（persistent/PTY shell，即 `tool-bash-persistent`）一 spawn
就硬抛：

```
subprocess-local: terminal inspection is unsupported on platform win32
```

本插件补上缺失的 `WindowsProcessInspector`，修掉这个 throw。

## 怎么工作（机制）

- **注入点**：`LocalSubprocessRuntime.spawnTerminal` 读取公开钩子
  `this.terminalInspector ?? createProcessInspector()`。插件 `apply()` 时包装实例的
  `spawnTerminal`——每次 spawn 前塞入一个 `WindowsProcessInspector`，spawn 后把 node-pty
  终端 attach 给它（用于 ConPTY Ctrl-C 注入），spawn 结束清空钩子。
- **可逆**：dispose 恢复原型方法，不修改任何官方 node_modules 文件。

`WindowsProcessInspector` 各方法语义：

| 方法 | Windows 语义 |
|---|---|
| `foregroundPgid` | shell 存活时返回 shellPid（整树共享同一 ConPTY 控制台 = 一个"进程组"） |
| `isStdinWaiting` | 恒 false（就绪判定走提示符机制，同 macOS） |
| `processTree` | `Win32_Process` 父子表，children-first、防环 |
| `processSession` | 恒 []（Windows 无 POSIX session） |
| `isAlive` | pid + 创建时间双重比对，防 PID 复用 |
| `signalGroup` | SIGINT → ConPTY 写 `\x03`；SIGTERM/SIGKILL → `taskkill /T /F` 整树强杀 |
| `signalProcess` | 存活校验后 `TerminateProcess` |

进程表后端：`powershell.exe Get-CimInstance Win32_Process`，300ms TTL 缓存防重复拉表。

## 怎么装进项目 / 分发给用户

1. **打包**：`vendor/win-terminal-inspector/` 打进安装包（`build/electron-builder.yml` 的 `files`）。
2. **自动安装**：壳在 win32 首次启动（服务就绪后）把它自动装进
   `<DSH_HOME>/profiles/web/plugins/dsh-win-terminal-inspector/`，并在
   `profiles/web/cordis.patch.yml` 幂等追加 insert 条目
   （实现见 `src/main/install/winInspectorPlugin.ts`）。
3. **装一次记一次**：`shell-config.json` 的 `winTerminalInspectorInstalled` 标记；用户手动卸载后
   不会反复重装。
4. **卸载**：删除 patch 条目 + plugins 目录即可，完全可逆。

## 作用范围 / 已知边界

- ✅ 只修「`unsupported on platform win32`」这个 throw。
- ❌ 不解决 Git Bash（MSYS）在 `workspace-write` 受限令牌下建不了信号管道的问题——持久终端要
  **真正跑通**，还需把会话权限预设切到 **Full access（`danger-full-access`）**
  （见 README「已知限制」）。
- 非 win32 平台完全 no-op。

## 许可

MIT，Copyright (c) 2026 clearkurt。按 MIT 要求保留 `LICENSE` 与本说明。

本目录文件：`index.js`、`lib/inspector.js`、`package.json`、`LICENSE`（上游 MIT 原文）。
