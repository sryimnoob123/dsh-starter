# dsh-starter

DeepSeek Harness 的桌面客户端 —— 一个极简的 Electron 壳，把官方 Web 界面装进原生窗口，开箱即用。

[English](#english) · [中文](#中文)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

<a id="english"></a>

## English

**Contents**: [What is this](#what-is-this) · [How it works](#how-it-works) · [Features](#features) · [Install](#install) · [Development](#development) · [License](#license)

### What is this

A thin [Electron](https://www.electronjs.org/) shell for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It does **not** re-implement DSH — it starts its own local `dsh` service and renders the official web GUI inside a frameless window.

The shell only owns four things: **window**, **tray**, **notifications**, and **service lifecycle**. Everything else — the UI, the features, the agent capabilities — lives on the DSH side.

### How it works

- **DSH ships inside the installer.** The `@deepseek-ai/dsh` package (and all of its dependencies) is pre-downloaded at build time and bundled into the setup package. Installing the app needs no network and no npm — double-click, it's ready.
- **The shell owns the service lifecycle.** It starts the bundled DSH on a local port, reuses that port across restarts, and recovers automatically (exponential backoff) if the service crashes.
- **Settings live inside DSH's own settings dialog.** Shell features are injected into the official DSH settings as extra entries — one place for everything.
- **What you edit is what gets injected.** The global prompt editor writes the real `AGENTS.md` the running service reads; persona changes restart and reconnect automatically.
- **Automatic updates.** `electron-updater` checks for new GitHub releases, downloads in the background, and installs on your confirmation — one click from the top-right update button or the tray.

### Features

- 🪟 Frameless window + self-drawn titlebar (minimize / maximize / close-to-tray), Codex-style light/dark/system theme
- 📦 DSH bundled in the installer — offline install, no npm at setup
- 🔄 Shell-managed service — stable port, crash auto-recovery with exponential backoff
- 🔼 Check-for-updates button (top-right) + automatic updates via GitHub releases
- 🧠 Prompt settings inside DSH's own settings — global instructions `AGENTS.md`, persona, identity injection, project-level instructions, notification toggle
- 📊 Usage stats across all sessions (tokens / time / activity)
- 📌 System tray menu (open / stop service / logs / settings / check updates / help / quit)
- ⚡ Quick actions — one-click "Compact context" tray shortcut
- 🔔 Desktop notifications for finished / failed jobs + notification history
- 🐶 Stall watchdog — notifies when a job is silent for 5 minutes
- 📁 File-path menu + drag files into chat as `@path` references
- 🚀 First-run onboarding wizard (model & API connection)
- 🧩 Node.js auto-provisioning — downloads a release if no system Node
- 🪟 Windows persistent-terminal fix — bundles the `win-terminal-inspector` plugin (auto-installed on first launch) to fix DSH's missing Windows terminal inspector
- 🔒 Localhost only — bound to `127.0.0.1`

### Known limitations

- **Persistent terminal on Windows needs the "Full access" sandbox.** The persistent `bash` tool (Git Bash) only starts when the session's permission preset is **Full access** (`danger-full-access`). Under the default `Workspace Write` preset, Git Bash (MSYS) cannot create its signal pipe and the tool reports `PTY shell exited during startup`. To use the persistent terminal, switch the session's permission preset to "Full access" (or run `/permission danger-full-access`) — the trade-off is that shell commands then run without the file sandbox.

### Install

Download the installer from [Releases](https://github.com/sryimnoob123/dsh-starter/releases) and run it. The first launch walks through a short onboarding wizard (model + API connection); after that, double-clicking the icon goes straight into the window.

### Development

```bash
pnpm install
pnpm test          # run the test suite
pnpm typecheck
pnpm build         # compile TypeScript + copy assets
pnpm start         # run the shell (dev)
pnpm prepare:dsh   # pre-download DSH into vendor/dsh (used by the installer)
pnpm dist          # build the Windows installer (bundles DSH)
```

### License

[MIT](LICENSE). Independent, community-maintained project — not affiliated with or endorsed by DeepSeek. The whale logo used as the app icon is a DeepSeek asset, included only to identify the upstream project.

### Acknowledgments

- [dsh-win-terminal-inspector](https://github.com/clearkurt/dsh-win-terminal-inspector) (MIT, © 2026 clearkurt) — bundled **unmodified** to fix DSH's missing Windows terminal inspector. Source, license, and provenance are kept in `vendor/win-terminal-inspector/`.

---

<a id="中文"></a>

## 中文

**目录**：[这是什么](#这是什么) · [怎么工作](#怎么工作) · [功能](#功能) · [安装](#安装) · [开发](#开发) · [许可证](#许可证)

### 这是什么

DeepSeek Harness 的极简桌面壳（[Electron](https://www.electronjs.org/)）。它**不重写** DSH —— 自己拉起本机 `dsh` 服务，把官方 Web 界面装进一个无边框原生窗口，开箱即用。

壳只负责四件事：**窗口**、**托盘**、**通知**、**服务生命周期**；其余（界面、功能、agent 能力）都在 DSH 侧。

### 怎么工作

- **DSH 直接打进安装包。** `@deepseek-ai/dsh` 包（及其全部依赖）在打包时预先下载、一并打进安装包。安装时**无需联网、无需 npm**——双击即装即用。
- **壳接管服务生命周期。** 在本地端口拉起内置 DSH，重启沿用同一端口，服务崩溃时指数退避自动恢复。
- **设置长在 DSH 官方设置里。** 壳的功能设置作为额外条目注入官方设置弹窗——所有配置一个地方。
- **所见即所注入。** 全局提示词编辑器写的是**运行中服务真正读取的那份 `AGENTS.md`**；persona 变更自动重启接回会话。
- **自动更新。** `electron-updater` 检查 GitHub 新版本，后台下载、你确认后安装——右上角更新按钮或托盘一键触发。

### 功能

- 🪟 无边框窗口 + 自绘标题栏（最小化 / 最大化 / 关闭缩到托盘），Codex 风格浅色/深色/跟随系统主题
- 📦 DSH 打包内置 —— 离线安装，装的时候不跑 npm
- 🔄 壳管服务 —— 端口稳定，崩溃指数退避自动恢复
- 🔼 右上角"检查更新"按钮 + GitHub 发布自动更新
- 🧠 提示词设置长在 DSH 官方设置里 —— 全局指令 `AGENTS.md`、persona、身份注入、项目级指令、通知开关
- 📊 全会话用量统计（token / 耗时 / 活动）
- 📌 系统托盘菜单（打开 / 停止服务 / 日志 / 设置 / 检查更新 / 帮助 / 退出）
- ⚡ 快捷操作 —— 托盘一键"压缩上下文"
- 🔔 任务完成 / 失败桌面通知 + 通知历史
- 🐶 卡住看门狗 —— 任务 5 分钟无活动时提醒
- 📁 文件路径菜单 + 拖文件进对话成 `@路径` 引用
- 🚀 首启向导（模型 + API 连接）
- 🧩 Node.js 自动补齐（无系统 Node 时自动下载发行版）
- 🔒 仅监听本机（`127.0.0.1`）

### 已知限制

- **Windows 持久终端需要「Full access（完全访问）」沙箱。** 持久化 `bash` 工具（Git Bash）只有在会话权限预设为 **Full access（`danger-full-access`）** 时才能启动；默认的 Workspace Write 预设下，Git Bash（MSYS）建不了信号管道，工具会报 `PTY shell exited during startup`。要用持久终端，把会话权限预设切成「Full access」（或执行 `/permission danger-full-access`）即可——代价是 shell 命令不再受文件沙箱约束。

### 安装

从 [Releases](https://github.com/sryimnoob123/dsh-starter/releases) 下载安装包运行。首次启动走一遍简短向导（模型 + API 连接）；之后双击图标即进入窗口。

### 开发

```bash
pnpm install
pnpm test          # 跑测试
pnpm typecheck
pnpm build         # 编译 TypeScript + 拷贝资源
pnpm start         # 开发运行
pnpm prepare:dsh   # 预下载 DSH 到 vendor/dsh（安装包用）
pnpm dist          # 打 Windows 安装包（内置 DSH）
```

### 许可证

[MIT](LICENSE)。独立社区项目，与 DeepSeek 无隶属关系。应用图标为 DeepSeek 官方鲸鱼，仅用于标识上游项目，版权归 DeepSeek。

### 致谢

- [dsh-win-terminal-inspector](https://github.com/clearkurt/dsh-win-terminal-inspector)（MIT，© 2026 clearkurt）——内置以修复 DSH 缺失的 Windows 终端检查器，**原样使用、未做修改**。源码、许可与溯源均保留在 `vendor/win-terminal-inspector/`。

---

## 隐私说明

- 仅监听本机 `127.0.0.1`，不对外提供服务。
- 你的 API 密钥保存在 DSH 自己的凭据存储（`DSH_HOME`）里，壳不落明文、不收集、不上传。
- 壳只在本机读写安装目录与用户数据目录，不访问网络之外的任何个人文件。
