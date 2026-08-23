# dsh-doctor

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的离线诊断工具——在**启动前**或**安装插件前**跑一次，它会告诉你社区反复报告的哪几类故障会在你机器上咬人。

零 npm 依赖。单文件。任何有 `node` 的环境都能跑（`zstd` 只在扫 `.zstd` 会话日志时需要，E1 会检查它）。

## 为什么

dsh 的插件树"装出来就是脆的"：一个悬空引用、一个断掉的 `file:` 链接、一个重复的 entry id、一段损坏的会话日志，都能让 profile 在启动时直接挂掉或拖垮整个 web 服务器——而 `--dump-config` 从不挂载 loader，所以在坏配置上也"一切正常"。这类故障被汇总在 [dsh discussion #1496](https://github.com/deepseek-ai/deepseek-harness/discussions/1496)（Advisory：插件安装路径需要护栏）。`dsh-doctor` 就是这个护栏——**26 项内置检查**（env 7 / profile 11 / session 8）映射到 18 个社区报告，每一项都用合成负样例验证过；外加一个**自更新的远程检查目录**（声明式规则，v0.2.0 起）。

## 用法

```bash
node dsh-doctor.mjs                      # 全部检查（env + profile + session）
node dsh-doctor.mjs --profile web        # 仅 profile 检查
node dsh-doctor.mjs --session <path>     # 仅会话检查（默认自动找最新会话）
node dsh-doctor.mjs --env                # 仅环境检查
node dsh-doctor.mjs --json               # 机器可读输出
node dsh-doctor.mjs --no-catalog         # 不拉远程目录（只用内置副本）
```

退出码：`0` = 全部通过 · `1` = 发现问题（内置检查 + 目录中 `severity: error` 的项）· warn 级目录失败不改退出码。

## 检查项（28 内置 + 5 目录）

### env
| ID | 检查 | 对应讨论 |
|---|---|---|
| E1 | `node`/`pnpm`/`zstd` 在 PATH | [#1270](https://github.com/deepseek-ai/deepseek-harness/discussions/1270) |
| E2 | `.env` 是文件而非目录 | [#71](https://github.com/deepseek-ai/deepseek-harness/discussions/71) |
| E3 | node 版本 / `--expose-internals` 可及性 | [#113](https://github.com/deepseek-ai/deepseek-harness/discussions/113), [#1313](https://github.com/deepseek-ai/deepseek-harness/discussions/1313) |
| E4 | node-pty 原生二进制在位（`prebuilds/<platform>-<arch>/pty.node`） | [#1219](https://github.com/deepseek-ai/deepseek-harness/discussions/1219) |
| E5 | 存储 JSON 文件合法（严格 UTF-8 + 可解析） | [#1357](https://github.com/deepseek-ai/deepseek-harness/discussions/1357) |
| E6 | 锚点 tripwire：S6/S7/S10 依赖的契约仍在安装的 `dsh-session` 里 | [anti-rot idea](https://github.com/deepseek-ai/deepseek-harness/discussions/1534) |
| E10 | 启动前 Web 端口 3080 可用性（dsh web 自身占用=正常；其他进程=FAIL；`DSH_DOCTOR_PORT` 可覆盖） | [#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719) |

### profile
| ID | 检查 | 对应讨论 |
|---|---|---|
| P2 | bundle 层与用户 patch 的 insert id 冲突（启动必崩） | [#1404](https://github.com/deepseek-ai/deepseek-harness/discussions/1404) |
| P3 | 用户 patch 的 insert `name:` 能从 profile 锚点解析 | [#1197](https://github.com/deepseek-ai/deepseek-harness/discussions/1197), [#880](https://github.com/deepseek-ai/deepseek-harness/discussions/880) |
| P4 | `file:` 依赖完整 | [#1197](https://github.com/deepseek-ai/deepseek-harness/discussions/1197) |
| P5 | 顶层无 `@deepseek-ai/*` 重复（双模块实例） | [#1486](https://github.com/deepseek-ai/deepseek-harness/discussions/1486), [#1697](https://github.com/deepseek-ai/deepseek-harness/discussions/1697) |
| P7 | `cordis.patch.yml` 结构 lint（`~ insert:` null 字面量、tab 缩进、缺冒号、顶层映射+序列混排 → UI 打不开） | [#1724](https://github.com/deepseek-ai/deepseek-harness/discussions/1724) |
| P12 | profile 内 bundle 版本 vs 运行 CLI（发词汇名 `installed_bundle`，#1719 v1.1：未声明=skip / manifest 撒谎或分歧=warn / 一致=pass；web「诊断」面板 / `/dsh-doctor/run` API 跑的是 bundle） | [#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719) |
| P13 | client 半 `provide` 服务名抢注核心客户端服务（`chatFileMentions` 等 `@deepseek-ai/dsh-client-*`，warn）或跨 bundle 同名（浏览器端 service already registered → UI 白屏、服务端日志无感知） | [#2752](https://github.com/deepseek-ai/deepseek-harness/discussions/2752) |
| P14 | 声明 `bin` 可执行性（目标文件在位 + 文本 bin 必须带 shebang；仅可执行位不识别解释器 → 直接执行 ENOEXEC，#1846） | [#1846](https://github.com/deepseek-ai/deepseek-harness/discussions/1846) |

### session
| ID | 检查 | 对应讨论 |
|---|---|---|
| S1 | 孤儿 `tool_call`（无对应 tool result） | [#1363](https://github.com/deepseek-ai/deepseek-harness/discussions/1363), [#1544](https://github.com/deepseek-ai/deepseek-harness/discussions/1544) |
| S2 | 未闭合 turn（会话卡"运行中"） | [#466](https://github.com/deepseek-ai/deepseek-harness/discussions/466), [#1265](https://github.com/deepseek-ai/deepseek-harness/discussions/1265) |
| S6 | `seq == index` 连续性（官方语义，chunk 行按 `expandRow` 展开） | [#1333](https://github.com/deepseek-ai/deepseek-harness/discussions/1333), [#1452](https://github.com/deepseek-ai/deepseek-harness/discussions/1452), [#1469](https://github.com/deepseek-ai/deepseek-harness/discussions/1469) |
| S7 | `end-seed` 后重放（重放已提交尾部） | [#1497](https://github.com/deepseek-ai/deepseek-harness/discussions/1497) |
| S8 | 未知事件类型且无 `ignorable`（整包拒绝） | [#1538](https://github.com/deepseek-ai/deepseek-harness/discussions/1538) |
| S9 | zstd 容器帧数（单帧日志 → `session.list` 整体 500） | [#1043](https://github.com/deepseek-ai/deepseek-harness/discussions/1043) |
| S10 | `sourceEventSeqs` 引用非更早事件 | [#1469](https://github.com/deepseek-ai/deepseek-harness/discussions/1469) |
| S11 | 全会话扫描：损坏 → 隔离建议；超大 / 工作区估算物化堆（max(事件×600B, 字节×6)，默认 1GiB，`DSH_DOCTOR_HEAP_MB`）→ 冷启动卡顿风险 | [#1550](https://github.com/deepseek-ai/deepseek-harness/discussions/1550) |

## 备注

- S 类检查复刻了 harness 自身的校验（如 `SessionLogScanner` 的 `seq == events.length` + `expandRow` chunk 展开），所以离线结论与 boot/resume 实际行为一致。
- 尊重 `$DSH_HOME`（默认 `~/.dsh`），可以用临时 home 干跑，不碰真实数据。
- 当前活跃 turn 的尾部 in-flight 工具调用按警告而非错误处理，扫活会话不会误报。
- 同生态位兄弟实现：[boyin111-1/dsh-doctor](https://github.com/boyin111-1/dsh-doctor) —— 两工具用同一批坏 fixture 交叉验证过。

## 相关社区工具

> **dsh-doctor/v1 词汇表 r5 兼容，v1.1 `installed_bundle` 待认领** —— 起草 [@ciceroyang](https://github.com/ciceroyang)（ciceroyang/dsh-doctor），审阅 [@sjh9714](https://github.com/sjh9714)（dsh-win32）与 [@moonquake2004](https://github.com/moonquake2004)（[#1719](https://github.com/deepseek-ai/deepseek-harness/discussions/1719)）。我们的 `node`/`pnpm` 检查按 r5 语义输出词汇名（pass/warn/fail/skip；`summary.skip` 常驻）；P12 直接发 v1.1 词汇名 `installed_bundle`（四态 skip/warn/pass/warn，r6 表待发）。

- [zoahdev/dsh-plugin-doctor](https://github.com/zoahdev/dsh-plugin-doctor) —— 发布前插件 bundle 健康检查（manifest/patch/entry/files/build/pack+全新 profile 安装）+ 宿主遮蔽 `profile-shadow` 哨兵（作者/CI 侧）。与本工具的用户侧 profile/session/env 诊断互补；它的 `profile-shadow` 与我们的 P5 从两个方向标记同一个宿主遮蔽前置条件。
- [boyin111-1/dsh-doctor](https://github.com/boyin111-1/dsh-doctor) —— 同生态位离线诊断兄弟实现，用同一批坏 fixture 交叉验证。

## Symptom → check quick-start (dsh-diagnose alignment)

If you're coming from a symptom (rather than from the machine), these are the checks to run first. Coverage is honest: ✅ = direct offline coverage, ⚠️ = partial (we see the log/profile effects, not the runtime internals), ❌ = gap (runtime-only, no offline probe today).

| Symptom family | dsh-doctor checks | What they catch |
|---|---|---|
| session log corruption / can't resume | S1, S2, S6, S7, S8, S9, S10 | orphan tool calls, unclosed turns, seq gaps, end-seed replay, unknown event types, zstd single-frame, sourceEventSeqs drift |
| oversized / cold-start stall | S11 | estimated materialization heap, corrupt-session quarantine |
| boot failure (UI won't open) | P1–P10, E10 | dangling bundles, id collisions, patch syntax, host shadowing, adapter conflicts, client-service injects, port 3080 |
| tool registry gaps (tools missing) | P1, P2, P8, P10, P9 | unresolved/conflicting/duplicated tool registrations, client-only service injects |
| compaction / history unavailable | S10, S6, S8 | sourceEventSeqs not remapped after compaction |
| agent-loop lifecycle (session stuck "running") | S2, S1, S6 | unclosed turns, orphan tool calls, broken seq |
| llm retry storms | S6, S11, S2 | retry traffic effects on log integrity/size |
| token metering off | S11, S1, S2 | metering derives from the event stream |
| workflow script failures | P7, S6, S8, S1 | patch syntax (boot), workflow event integrity |
| approval policy pending | S2, S1 | open turns / orphan calls from pending or rejected approvals |
| credentials resolution | E2, E5, P4 | `.env` shape, storage JSON, `file:` links |
| web internals | E10, P10, E5 | port, client half, workspace storage |
| subagent depth | S11, S8 | session size, subagent event types |
| sandbox denials | E4 | node-pty binary (infra only) — ❌ runtime policy not offline-checkable |
| approval internals | S2 | ⚠️ runtime policy; only the turn-level effect |
| credentials internals | E2, E5 | ⚠️ file-level only |

The `dsh-doctor/v1` envelope (`--json --envelope`) is the machine-readable form of any of these runs, so a symptom tool can consume the verdict directly.

## 自更新检查（v0.2.1，层 B）

工具也会盯着自己的 npm 版本：每次运行对比已装版本与 `dist-tags.latest`（与目录同样的 6h TTL 缓存 + 离线回退）。有新版时打印提示、JSON 里报 `update: { current, latest, available }`——**未经你要求绝不改动你的安装**。

- `--update` —— 立即执行更新：在宿主 profile 里跑 `pnpm install`（可用 `DSH_DOCTOR_UPDATE_CMD` 覆盖），然后提示重启 `dsh web`。
- `DSH_DOCTOR_AUTO_UPDATE=1` —— 有新版时自动更新。
- 诚实边界：cordis 启动时加载插件，新引擎要重启才生效——层 B 是"换文件 + 提醒重启"，不做热替换。
- `--no-catalog` 同时禁用更新检查（纯离线模式）。

## 远程检查目录（v0.2.0，层 A）

内置 26 项检查编译在工具里。**目录**是第二层、自更新的：本仓库的 `plugin/checks.json` 放声明式规则（**规则是数据，不是代码**），所有已装实例自动获取新规则——无需重装。

- **工作机制**：每次运行尝试从 GitHub 拉 `plugin/checks.json`（3s 超时）→ 成功后缓存到 `$DSH_HOME/.cache/dsh-doctor/checks.json`（TTL 6h）→ 失败回退 last-known-good 缓存 → 再回退内置副本。新检查因此在上游提交后 ≤6h 内自动到达。
- **安全性**：规则是**只读探测原语**，由内置引擎执行（`command-exists`、`path-*`、`json-valid`、`text-contains` / `text-not-contains`、`file-size-above`、`glob-count`）。远程内容永远无法执行代码——只能新增模式检查。
- **严重级别**：`error`（默认，改退出码）或 `warn`（只报告，不影响退出码）。`--no-catalog` 关闭远程拉取。
- **加一条检查**（这就是重点——无需发版）：往 `plugin/checks.json` 追加一条并提交即可。目前已随目录发布的检查：

| ID | 探测 | 检查 | 对应讨论 |
|---|---|---|---|
| E7 | `command-exists` | `dsh` 在 PATH | [#1270](https://github.com/deepseek-ai/deepseek-harness/discussions/1270) 家族 |
| E8 | `text-contains`（warn） | profile `.npmrc` 含 `ignore-workspace-root-check=true` | [dsh-market #20](https://github.com/dsh-market/dsh-market/issues/20) |
| E9 | `json-valid` | `config/workspace.json` 可解析 | [#1357](https://github.com/deepseek-ai/deepseek-harness/discussions/1357) 家族 |
| P6 | `text-not-contains` | patch insert `name:` 含空格（Windows spawn lint） | [#1420](https://github.com/deepseek-ai/deepseek-harness/discussions/1420) |

目录检查的结果在 JSON 输出中标 `src: "catalog"`，CLI 输出标 `[目录]`。

## LLM 观察者（v0.3.0，层 C）

第三层把"现场信号 → 目录条目"的回路半自动化：从诊断运行产出**候选检查提案**，人做最后把关（认证门禁不变）。设计与细节见 [`docs/layer-c-observer.md`](docs/layer-c-observer.md)。

- `dsh-doctor --observe run.json` —— 聚类诊断运行的 fail/warn 信号（`--json` / `--envelope` 输出，或含 JSON 的目录），按目录 schema 起草候选检查（确定性，默认 `severity: warn`）。
- `--observe-llm "<cmd>"`（或 `DSH_DOCTOR_LLM_CMD`）—— 用 LLM 富化草稿：`cmd` 从 stdin 收 prompt，stdout 回 JSON。回复被封闭探测词表约束，任何解析/词表违规静默回退草稿。
- `--observe-apply proposals.json` —— 把**校验通过**的提案并入本地覆盖层 `plugin/checks.local.json`（幂等）。覆盖层参与本地诊断直到你认证该检查，但永不随包分发——认证后的检查应进 `plugin/checks.json`。

安全不变量：封闭探测词表（LLM 输出永远是数据、不是代码）、提案默认 warn、不自动上目录、不依赖任何外部服务（不带 `--observe-llm` 即确定性模式）。

## 也可作为 dsh 插件安装

工具以标准 dsh bundle 形态发布（`plugin/`），可以在 web UI 里跑同样的检查（28 内置 + 5 目录规则）：

```bash
# 装进 profile（checkout 或已发布路径均可）
dsh plugin --profile web add file:/path/to/dsh-doctor/plugin
```

装完你会得到：

- **设置 → 诊断**面板：一键跑全部检查，按 env / profile / session 分组渲染结果，带逐项修复建议与隔离建议（只展示建议，绝不自动执行）；
- **HTTP API**：`GET /dsh-doctor/run` 返回同样的 JSON（可选 `?profile=` / `?session=` 收窄范围）。

架构：插件的服务端路由 shell 出 `plugin/dsh-doctor.mjs --json`——与 CLI 同一份真相源（检查按设计是离线/文件系统导向的，不需要 harness 内部接口）。仓库根目录的 `dsh-doctor.mjs` 是兼容 `node dsh-doctor.mjs` 的薄封装。

## License

MIT
