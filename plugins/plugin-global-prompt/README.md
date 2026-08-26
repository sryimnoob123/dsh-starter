# 🧭 dsh-global-prompt

> 给 DeepSeek Harness 的提示词管理装上图形界面：全局 `AGENTS.md`、各工作区 `AGENTS.md` 可视化编辑，改完即生效，不用再手动翻文件。

![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)

## 这是什么

DSH 的指令注入机制（`dsh-agent-instructions`）是**读文件**的：`$DSH_HOME/AGENTS.md` 就是全局提示词，写进去就生效。但没有面板，你得自己去翻安装目录改文件。

本插件在设置面板里开了三个 tab，把这件事变成点一点：

| Tab | 干什么 |
| --- | --- |
| 全局 | 编辑 `$DSH_HOME/AGENTS.md`，下一条消息就生效，不用重启、不用开新会话 |
| 项目 | 按工作区管理各自的 `AGENTS.md`，只对那个工作区生效 |
| 通知 | 任务完成/失败弹系统通知，点一下回到对应会话 |

## 特性

- **双向同步**：插件外直接改 `AGENTS.md`，面板能读到（150ms 内自动回写设置）；面板保存，文件被重写。两个方向都有内容守卫，不会互刷。
- **不丢数据**：你手动维护过 `AGENTS.md` 的话，插件启动时以磁盘为准回填设置，绝不会被默认空值覆盖；关闭「启用」也不会清空你的文件。
- **身份注入**：可选在每次对话开头加一句「我是 DeepSeek Harness」。
- **人设注入**：写一段人设，一直拼在对话里。支持 `{{model}}`、`{{cwd}}` 占位符。
- **运行时上下文开关**：不需要时抑制 DSH 自带的会话信息快照。
- **结果通知**：桌面壳用系统通知，纯 Web 用浏览器通知。

## 安装

### 独立安装

```bash
dsh plugin --profile <你的profile> add @dsh-desktop/plugin-global-prompt
```

### 随壳内置

dsh-desktop 安装器已捆绑本插件（默认启用，可在插件管理里关掉）。

> 原理：本插件的 bundle patch 会重新启用 `dsh-agent-instructions`（web-app bundle 默认禁用它），面板里写的 AGENTS.md 由官方机制注入——所见即所注入。

## 开发

纯 ESM，无构建步骤。结构：

- `index.js` — 服务端：settings 注册、AGENTS.md 双向同步（目录监听 + 防抖）、两个 HTTP API、身份/人设注入、运行时上下文抑制
- `client.js` — 设置面板 UI（全局/项目/通知三 tab）
- `lib/core.js` — 校验与工具函数（persona ≤ 20000 字符、指令 ≤ 1MiB）
- `test/global-prompt-sync.mjs` — 双向同步防环自测（mock dsh-settings 语义）

跑测试：

```bash
node test/global-prompt-sync.mjs
```

## 兼容性

- 官方 dsh `>= 0.1.1-rc.1`（npm latest 为 0.1.1-rc.2）
- Node >= 20
- DSH Web 与 dsh-desktop Electron 壳均可

## License

MIT
