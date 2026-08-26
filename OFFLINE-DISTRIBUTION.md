# 离线分发与自愈体系（设计 brief，待批准）

日期：2026-08-22 ｜ 状态：**草案——等待用户审阅** ｜ 前置：dshmarket 修复已完成（profileWorkspace 自愈，398 测试全绿）

用户三项决策：**① 分发形态 = 全量安装包；② 修复按钮 = 新开修复会话；③ 只动壳管辖的内容（用户机器上已有的 node/依赖不重复安装、不碰用户数据）**。

---

## F1 全量安装包：插件与依赖随包分发

**现状地基**（已有，不重建）：
- `extraFiles` 已把 `vendor/dsh/node_modules` → 安装目录 `dsh/node_modules`，装完即用不联网；
- electron-updater 全链路 + GitHub 发布源（`sryimnoob123/dsh-starter`）已配置；
- NSIS 更新覆盖只删安装清单内文件，运行时生长的 `dsh-home` 不在清单 → 更新后用户数据存活（**验证点 V1：实测确认**）。

**要做的**：
1. **种子净化脚本**（扩展 `pnpm prepare:dsh`）：从活的 `dsh-home` 拷出"种子"进构建中间目录——保留 `profiles/*/`（package.json、cordis.patch.yml、pnpm-workspace.yaml、node_modules 插件实体）、剔除 logs / 缓存 / 对话历史 / `*.bak`。
2. **extraFiles 加种子**：种子进安装包 `dsh-home-seed/`（与用户数据区分开）。
3. **首启播种**：壳启动检测用户 `dsh-home` 不存在 → 从包内种子整体拷贝；已存在 → 只做**种子合并**（见 4），不覆盖任何已有文件。
4. **种子合并（"有了就不装"的落点）**：对比包内种子 profiles 的 bundles 清单 vs 用户 bundles——包里新增的插件自动补（实体从种子 node_modules 拷入 + junction 接线）；用户已有的版本不动；用户隔离过（quarantinedPlugins）的绝不回装。全程幂等。
5. **体积门调整**：现 320 MiB 上限，加插件层后实测重定（build-installer.mjs 里改）。

**天然满足、无需开发**：壳用自带 node（不装不删系统 node）；依赖实体全在包内解压即用，无联网重装。

## F2 右上角"修复"按钮：一键把问题发给 DSH 对话

1. 壳窗口标题栏右上角加入口（`desktopChrome`）；出问题时（self-rescue 事件、spawn 失败）高亮提示。
2. 点击 → 收集：最近 self-rescue 诊断事件（壳内 ring buffer，rescueEngine 事件流已有）+ `shell.log`/`service.log` 尾部 + quarantinedPlugins + 环境摘要（版本/端口/profile）。
3. 通过既有 `POST /api/<method>` 通道（壳已是同款客户端）**新开修复会话**，注入结构化首条消息：角色设定 + 诊断数据 + 日志文件路径（让 DSH 自己深入读）+ 建议动作清单。DSH 在会话里自行修复。
4. 不打断用户当前会话；修复会话带标记便于辨认。

**实现前待查**：dsh 侧"程序化新建会话 + 注入首条消息"的 API 形态（writing-plans 阶段第一件事）。

## F3 启动自检（检测机制收口）

启动时跑清单，缺了自动补、有了绝不动，结果记 `shell.log`：

| 检查项 | 动作 | 状态 |
|---|---|---|
| profile 的 pnpm-workspace.yaml | 缺则补 | **已上线**（profileWorkspace.ts） |
| dsh-home 播种 | 不存在则从种子拷 | F1 |
| 种子合并 | bundles diff 补新插件 | F1 |
| vendor(dsh/node_modules) 完整性 | 关键实体抽查，缺则报修复会话 | 新增 |
| 隔离残留清理 | quarantined 实体/junction 残留清扫 | 新增 |
| junction 层健康 | 交给 dsh 侧 healProfilesModuleFallback（已存在） | 观察 |

## 实施顺序

**F1 → F3 → F2**（F1 先行：market 修好后你装的插件正好成为第一批打包验证素材；F2 依赖 dsh 会话 API 细查，放最后）。

## 非目标

- 不做增量差分包（已拍板全量）；
- 不安装/删除用户系统级的 node、pnpm；
- 不自动删除用户自装内容（只清壳管辖的隔离残留）；
- 不改 shell-rescue 独立包（三块全在壳层）。

## 风险与验证点

- **V1**：NSIS 更新覆盖后用户 dsh-home 数据存活实测；
- **V2**：种子合并在"用户删过包里插件"场景不回装；
- **V3**：安装包体积实测 + 门值重定；
- **V4**：修复会话注入后 DSH 能正确读到日志文件并执行修复。
