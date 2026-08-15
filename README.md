# dsh-desktop

DeepSeek Harness 的桌面客户端 —— 一个极简的 Electron 壳，把官方 Web 界面装进原生窗口。

[English](#english) · [中文](#中文)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

<a id="english"></a>

## English

**Contents**: [What is this](#what-is-this) · [Status](#status) · [Features](#features) · [Install](#install) · [Development](#development) · [License](#license)

### What is this

A thin [Electron](https://www.electronjs.org/) shell for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness). It does **not** re-implement DSH — it reuses your existing `dsh` service (or starts one for you) and renders the official web GUI at `http://127.0.0.1:3080` inside a frameless window.

The shell only owns four things: **window**, **tray**, **notifications**, and **service lifecycle**. Everything else — the UI, the features, the agent capabilities — lives on the DSH side.

### Status

Early stage (MVP). The shell core is implemented and covered by **334 tests**. Some features (auto-update, first-run onboarding, install wizard) are wired up but not yet fully verified on real machines. Contributions are welcome.

### Features

- 🪟 Frameless window + self-drawn titlebar (minimize / maximize / close-to-tray)
- 🌙 Light / dark theme (follows the OS, or pick in DSH appearance settings) — Codex-style skin
- 📊 Usage stats — per-session token / time / activity (tray → Usage)
- 📌 System tray menu (open / stop service / logs / settings / check updates / help / quit)
- ⚡ Quick actions — one-click "Compact context" tray shortcut for the current session
- 🔔 Desktop notifications for finished / failed jobs
- 🐶 Stall watchdog — system notification when a job shows no activity for 5 minutes (independent of the agent itself)
- 🗂️ Notification history — every shell notification is recorded (last 500) and viewable/cleared from the tray
- 🔄 Automatic updates (`electron-updater`)
- 🔌 Smart port detection — reuse a running service, ask on conflict
- 🚀 First-run onboarding wizard (model & connection config)
- 📦 Install wizard — downloads `@deepseek-ai/dsh` into a folder you choose
- 🧩 Node.js auto-provisioning — no system Node needed; downloads an official release on first run if missing
- 🧠 Prompt settings — edit the global instructions file (`AGENTS.md`, WYSIWYG), persona, identity injection, and the notification toggle
- 🔒 Localhost only — bound to `127.0.0.1`

### Install

Download the installer from [Releases](https://github.com/sryimnoob123/dsh-starter/releases) and run it. The first launch walks through a short onboarding wizard (workspace + model + API connection); after that, double-clicking the icon goes straight into the window.

> If a DSH service is already running locally, it is detected and reused — zero setup.

### Development

```bash
pnpm install
pnpm test        # run the test suite
pnpm typecheck
pnpm build       # compile TypeScript + copy assets
pnpm start       # run the shell (dev)
pnpm dist        # build the Windows installer
```

In dev, you can point `DSH_CHECKOUT` at a local DeepSeek Harness checkout to use it as the service source.

### License

[MIT](LICENSE). Independent, community-maintained project — not affiliated with or endorsed by DeepSeek. The whale logo used as the app icon is a DeepSeek asset, included only to identify the upstream project.

---

<a id="中文"></a>

## 中文

**目录**：[这是什么](#这是什么) · [当前进度](#当前进度) · [功能](#功能) · [安装](#安装) · [开发](#开发) · [许可证](#许可证)

### 这是什么

DeepSeek Harness 的极简桌面壳（[Electron](https://www.electronjs.org/)）。它**不重写** DSH —— 复用你已有的 `dsh` 服务（或帮你启动一个），把官方 Web 界面装进一个无边框原生窗口（`http://127.0.0.1:3080`）。

壳只负责四件事：**窗口**、**托盘**、**通知**、**服务生命周期**；其余（界面、功能、agent 能力）都在 DSH 侧。

### 当前进度

早期阶段（MVP）。壳核心已完成，并有 **334 个测试**覆盖。自动更新、首启向导、安装向导已接入，但尚未在真机完整验证。欢迎贡献。

### 功能

- 🪟 无边框窗口 + 自绘标题栏（最小化 / 最大化 / 关闭缩到托盘）
- 🌙 浅色 / 深色主题（跟随系统，或到 DSH 外观设置里选）—— Codex 风格换肤
- 📊 用量统计 —— 每会话 token / 耗时 / 活动（托盘 → 用量）
- 📌 系统托盘菜单（打开 / 停止服务 / 日志 / 设置 / 检查更新 / 帮助 / 退出）
- ⚡ 快捷操作 —— 托盘一键"压缩上下文"（当前会话）
- 🔔 任务完成 / 失败桌面通知
- 🐶 卡住看门狗 —— 任务 5 分钟无活动时系统通知（独立于 agent 本身）
- 🗂️ 通知历史 —— 每条壳通知都会记录（最近 500 条），托盘可回看/清空
- 🔄 自动更新（`electron-updater`）
- 🔌 智能端口探测（复用已运行服务，端口冲突时询问）
- 🚀 首启向导（模型与连接配置）
- 📦 安装向导（把 `@deepseek-ai/dsh` 下载到自选目录）
- 🧩 Node.js 自动补齐（无需系统 Node，缺失时首次自动下载官方发行版）
- 🧠 提示词设置（编辑全局指令文件 `AGENTS.md`（所见即所注入）、persona、身份注入与通知开关）
- 🔒 仅监听本机（`127.0.0.1`）

### 安装

从 [Releases](https://github.com/sryimnoob123/dsh-starter/releases) 下载安装包运行。首次启动会走一遍简短向导（工作区 + 模型 + API 连接）；之后双击图标即进入窗口。

> 若本机已有 DSH 服务在运行，会自动检测并复用，零配置。

### 开发

```bash
pnpm install
pnpm test        # 跑测试
pnpm typecheck
pnpm build       # 编译 TypeScript + 拷贝资源
pnpm start       # 开发运行
pnpm dist        # 打 Windows 安装包
```

开发时可设 `DSH_CHECKOUT` 指向本地 DeepSeek Harness checkout，作为服务来源。

### 许可证

[MIT](LICENSE)。独立社区项目，与 DeepSeek 无隶属关系。应用图标为 DeepSeek 官方鲸鱼，仅用于标识上游项目，版权归 DeepSeek。
