import type { Diagnoser } from '../core/types.js';
/** DSH 0.1.1-rc.2：依赖缺失崩溃。两种归因（2026-08-22 两类真机样本）：
 *  a) 缺失的包本身是注册插件（junction 断链）→ 隔离该插件；
 *  b) 缺失的是普通依赖 → 从 imported from 归因到引用者插件并隔离引用者；
 *  c) 都归因不到 → 无 suspect，不处置（隔离一个不存在的包是空操作，白烧预算）。
 *  stderr 是外部可控输入：提取的包名不合法（路径穿越/伪造）同样不产 suspect。 */
export declare const dshModuleNotFoundRule: Diagnoser;
/** DSH 0.1.1-rc.2：loader entry id 冲突（patch insert 与 bundle 双挂，如 modlens 既在
 *  dsh.profile.bundles 又在 cordis.patch.yml insert）。
 *  处置语义（2026-08-23 真机教训）：这是配置错误，正确动作是**修复**（清掉重复 insert 块），
 *  不是隔离（隔离会把没坏的插件实体整个删掉，方向反了）。因此诊断始终带 repair 请求：
 *  - 规则侧：id 映射到已知插件（id 或 packageName 两路）；映射不到（第三方）
 *    也照样给 repair——清 insert 块不依赖 suspect；
 *  - 引擎侧：隔离器提供 repair 通道时优先走 repair（不烧隔离预算、不锁会话）。 */
export declare const dshDuplicateEntryRule: Diagnoser;
/** DSH 0.1.1-rc.2：cordis 装载插件失败（版本不兼容/语法错误等）。
 *  从 `loader entry <id> (<包名>):` 提取包名；包名不合法（stderr 可注入/路径穿越）或不在已知清单
 *  → 无 suspect，不处置（隔离一个不存在的包是空操作，白烧预算）。 */
export declare const dshLoaderEntryFailedRule: Diagnoser;
export declare const dshBadPatchYamlRule: Diagnoser;
export declare const dshFallbackBlockerRule: Diagnoser;
export declare const dshDiagnosers: readonly Diagnoser[];
