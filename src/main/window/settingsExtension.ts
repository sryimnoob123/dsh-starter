/**
 * DSH 应用内设置扩展（用户拍板："提示词设置放在 DeepSeek 官方设置里面，就叫全局提示词"）：
 * 壳注入脚本——当 DSH 自带设置弹窗打开时，向其左侧导航追加"全局提示词"分类，
 * 右侧内容区显示壳提供的面板（全局指令编辑器 + 身份/Persona 注入开关 + 一键注入 +
 * 项目级指令 + 通知开关 + 保存），数据全部走既有 dshShell 桥（getPromptSettings 等）。
 *
 * 稳定性设计：
 * - 不依赖哈希类名：锚点 = 文本"通用设置/General"的导航按钮 → 其父级 navList；
 *   克隆现有导航格（保样式一致），内容区 = nav 的下一个兄弟（DSH sections 容器）。
 * - DSH 是 SPA 且事件流会重渲染（弹窗可能重建）：MutationObserver + 定时器双兜底重挂载。
 * - 面板配色走 body 上的 --dsw-* 变量（codexSkin 已覆写为 OC 深浅两套）→ 自动随主题。
 */
export const SETTINGS_EXTENSION_SCRIPT = `(function () {
  if (window.__dshSettingsExtension) return;
  window.__dshSettingsExtension = true;

  var LANG = (document.documentElement.lang || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  var STR = {
    zh: {
      title: '全局提示词',
      globalTitle: '全局系统提示词',
      globalHint: '每轮都会注入的全局指令（agent-instructions）。改这里 = 改全局注入内容，保存即生效。',
      globalPlaceholder: '在这里写全局规则，例如：\\n\\n- 用中文回答\\n- 先想清楚再动手',
      injectTitle: '注入开关',
      injectHint: '两个注入开关：身份声明与 Persona。可以一键启用默认注入。',
      identity: '身份注入',
      identityHint: '在每轮系统提示词开头加上一行 DSH 身份声明（默认关闭）。',
      persona: 'Persona 注入',
      personaHint: '拼接在系统提示词里的常驻段落；支持 {{model}} 与 {{cwd}}。关闭 = 不注入。',
      personaTpl: 'Persona 模板',
      oneClick: '一键注入默认提示词',
      projectTitle: '项目级指令',
      projectHint: '每个工作区自己的 AGENTS.md。保存后该工作区的会话自动同步。',
      projectSave: '保存到该工作区',
      projectNone: '没有工作区，或服务未在运行。',
      projectSaved: '已保存。',
      projectFailed: '保存失败：',
      notifyTitle: '通知',
      notifyLabel: '任务结果桌面通知',
      notifyHint: '任务完成 / 失败时弹桌面通知，点击可回到对应会话。',
      save: '保存',
      saveRestart: '保存并重启服务',
      saved: '已保存。全局指令由 DSH 自动同步；身份注入与 persona 在服务重启后生效。',
      savedRestart: '设置已保存，正在重启服务…',
      failed: '保存失败：',
      reuse: '当前连接的是已经在运行的服务：全局提示词可直接编辑（新会话生效）；身份 / Persona 改动需重启服务后生效。',
      modeManaged: '壳管模式',
      modeReuse: '外部模式',
      editingPath: '正在编辑：',
      modeManagedHint: '服务由本应用启动并接管：全局指令与身份 / Persona 均即时生效（改身份 / Persona 会自动重启接回会话）。',
      modeReuseHint: '服务由外部启动：全局指令写入外部服务真实读取的 AGENTS.md（新会话生效）；身份 / Persona 改动需手动重启外部服务。',
      usageTitle: '用量统计',
      usageHint: '当前会话的用量汇总（DSH 官方统计口径）。',
      usageRefresh: '刷新',
      tokensTitle: 'Token',
      tokensHint: '输入为计费口径（未缓存 + 缓存读 + 缓存写）；输出与缓存读写分开统计。',
      inputLabel: '输入（未缓存）',
      outputLabel: '输出',
      cacheReadLabel: '缓存读取',
      cacheWriteLabel: '缓存写入',
      cacheHitLabel: '缓存命中率',
      timeTitle: '耗时',
      timeHint: '墙钟时间：LLM 生成与工具执行的合计，以及首 token 与解码速度。',
      llmLabel: 'LLM 总时长',
      toolLabel: '工具总时长',
      ttftLabel: '平均首 token',
      decodeLabel: '解码速度',
      activityTitle: '活动',
      activityHint: '轮次 = 用户消息轮数；步数 = agent 执行的步数。',
      turnsLabel: '轮次',
      stepsLabel: '步数',
      usageLoading: '正在读取用量…',
      usageFailed: '读取失败：',
      usageNone: '暂无用量数据。',
      usageSession: '会话：',
    },
    en: {
      title: 'Global prompt',
      globalTitle: 'Global system prompt',
      globalHint: 'The global instruction set DSH injects every turn (agent-instructions). Editing it edits what gets injected; save applies it.',
      globalPlaceholder: 'Write global rules here, e.g.:\\n\\n- Answer in Chinese\\n- Think before acting',
      injectTitle: 'Injection switches',
      injectHint: 'Two switches: identity statement and persona. Enable the defaults with one click.',
      identity: 'Identity injection',
      identityHint: 'Prepends a DSH identity line to every system prompt (off by default).',
      persona: 'Persona injection',
      personaHint: 'A standing paragraph appended to the system prompt; supports {{model}} and {{cwd}}. Off = not injected.',
      personaTpl: 'Persona template',
      oneClick: 'Inject default prompts with one click',
      projectTitle: 'Project instructions',
      projectHint: 'Per-workspace AGENTS.md. Sessions in that workspace sync automatically after saving.',
      projectSave: 'Save to workspace',
      projectNone: 'No workspaces, or the service is not running.',
      projectSaved: 'Saved.',
      projectFailed: 'Save failed: ',
      notifyTitle: 'Notifications',
      notifyLabel: 'Job result desktop notifications',
      notifyHint: 'Desktop notification when a job finishes or fails; clicking it jumps to the session.',
      save: 'Save',
      saveRestart: 'Save & restart service',
      saved: 'Saved. Global instructions sync automatically; identity & persona apply after a service restart.',
      savedRestart: 'Saved — restarting the service…',
      failed: 'Save failed: ',
      reuse: 'Connected to an already-running service: the global prompt is editable here (applies to new sessions); identity and persona changes take effect after a restart.',
      modeManaged: 'Shell-managed',
      modeReuse: 'External',
      editingPath: 'Editing: ',
      modeManagedHint: 'The service is started and managed by this app: global prompt and identity/persona all apply immediately (changing identity/persona auto-restarts and reattaches your session).',
      modeReuseHint: 'The service was started externally: the global prompt writes to the AGENTS.md that external service actually reads (applies to new sessions); identity/persona changes need a manual restart of the external service.',
      usageTitle: 'Usage',
      usageHint: 'Usage totals for the current session (DSH official accounting).',
      usageRefresh: 'Refresh',
      tokensTitle: 'Tokens',
      tokensHint: 'Input is billed (uncached + cache read + cache write); output and cache traffic are tracked separately.',
      inputLabel: 'Input (uncached)',
      outputLabel: 'Output',
      cacheReadLabel: 'Cache read',
      cacheWriteLabel: 'Cache write',
      cacheHitLabel: 'Cache hit',
      timeTitle: 'Time',
      timeHint: 'Wall-clock totals for LLM generation and tool execution, plus first-token and decode throughput.',
      llmLabel: 'LLM time',
      toolLabel: 'Tool time',
      ttftLabel: 'Avg first token',
      decodeLabel: 'Decode speed',
      activityTitle: 'Activity',
      activityHint: 'Turns = user message turns; steps = agent steps executed.',
      turnsLabel: 'Turns',
      stepsLabel: 'Steps',
      usageLoading: 'Loading usage…',
      usageFailed: 'Failed: ',
      usageNone: 'No usage data yet.',
      usageSession: 'Session: ',
    },
  };
  var T = function (key) { return STR[LANG][key]; };

  var style = document.createElement('style');
  style.textContent =
    '#dsh-gp-section{color:var(--dsw-alias-label-primary,#e8e6dd);flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:0 24px 24px;box-sizing:border-box;font-size:14px;line-height:1.5;}' +
    '#dsh-gp-section h2{margin:0 0 4px;font-size:15px;font-weight:600;}' +
    '#dsh-gp-section h3{margin:20px 0 4px;font-size:14px;font-weight:500;}' +
    '#dsh-gp-section h3 svg{vertical-align:-3px;margin-right:5px;color:var(--dsw-alias-label-secondary,#b6b4ab);}' +
    '#dsh-gp-section .dsh-gp-hint{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#b6b4ab);font-size:13px;}' +
    '#dsh-gp-section .dsh-gp-path{font:12px ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary,#b6b4ab);' +
    'background:var(--dsw-alias-bg-layer-2,#1c1b1a);border:1px solid var(--dsw-alias-border-l2,#393836);' +
    'border-radius:9px;padding:6px 10px;margin:0 0 10px;overflow-wrap:anywhere;}' +
    '#dsh-gp-section textarea,#dsh-gp-section select{width:100%;background:var(--dsw-specific-input-major,#1c1b1a);' +
    'color:var(--dsw-alias-label-primary,#e8e6dd);border:1px solid var(--dsw-alias-border-l2,#393836);border-radius:9px;' +
    'padding:8px 12px;font:400 13px/1.5 ui-monospace,Consolas,Menlo,monospace;margin:0 0 10px;box-sizing:border-box;}' +
    '#dsh-gp-section select{font-family:inherit;}' +
    '#dsh-gp-section textarea:focus,#dsh-gp-section select:focus{outline:2px solid var(--dsw-alias-brand-primary,#edb449);outline-offset:1px;}' +
    '#dsh-gp-section .dsh-gp-row{display:flex;align-items:flex-start;gap:8px;cursor:pointer;padding:2px 0;}' +
    '#dsh-gp-section .dsh-gp-row input{margin-top:3px;accent-color:var(--dsw-alias-brand-primary,#edb449);}' +
    '#dsh-gp-section .dsh-gp-row .dsh-gp-label{display:block;font-size:14px;}' +
    '#dsh-gp-section .dsh-gp-row .dsh-gp-sub{display:block;color:var(--dsw-alias-label-secondary,#b6b4ab);font-size:13px;}' +
    '#dsh-gp-section button.dsh-gp-btn{height:32px;padding:0 14px;border-radius:9px;border:1px solid transparent;' +
    'font:500 13px/32px inherit;cursor:pointer;}' +
    '#dsh-gp-section button.dsh-gp-btn[disabled]{opacity:0.55;cursor:default;}' +
    '#dsh-gp-section .dsh-gp-primary{background:var(--dsw-alias-brand-primary,#edb449);color:var(--dsw-alias-label-primary-foreground,#151313);}' +
    '#dsh-gp-section .dsh-gp-ghost{background:transparent;color:var(--dsw-alias-label-primary,#e8e6dd);' +
    'border-color:var(--dsw-alias-border-l2,#393836);}' +
    '#dsh-gp-section .dsh-gp-ghost:hover{background:var(--dsw-alias-bg-layer-3,#343331);}' +
    '#dsh-gp-section .dsh-gp-status{display:block;min-height:20px;margin-top:8px;font-size:13px;' +
    'color:var(--dsw-alias-label-secondary,#b6b4ab);}' +
    '#dsh-gp-section .dsh-gp-status.err{color:var(--dsw-alias-state-error-primary,#d98678);}' +
    '#dsh-gp-section .dsh-gp-banner{margin:0 0 12px;padding:8px 12px;border-radius:9px;' +
    'border:1px solid var(--dsw-alias-border-l2,#393836);background:var(--dsw-alias-bg-layer-2,#1c1b1a);' +
    'color:var(--dsw-alias-label-secondary,#b6b4ab);font-size:13px;}' +
    '#dsh-gp-section .dsh-gp-mode{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;' +
    'font-weight:600;line-height:18px;margin:0 0 8px;border:1px solid transparent;}' +
    '#dsh-gp-section .dsh-gp-mode--managed{color:#3fb37a;background:rgba(63,179,122,0.12);border-color:rgba(63,179,122,0.35);}' +
    '#dsh-gp-section .dsh-gp-mode--reuse{color:#d98678;background:rgba(217,134,120,0.12);border-color:rgba(217,134,120,0.35);}' +
    '#dsh-gp-section .dsh-gp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;margin:0 0 10px;}' +
    '#dsh-gp-section .dsh-gp-stat{background:var(--dsw-alias-bg-layer-2,#1c1b1a);border:1px solid var(--dsw-alias-border-l2,#393836);' +
    'border-radius:9px;padding:12px 12px 10px;min-width:0;}' +
    '#dsh-gp-section .dsh-gp-stat .dsh-gp-k{display:block;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b4ab);' +
    'margin-bottom:4px;overflow-wrap:anywhere;}' +
    '#dsh-gp-section .dsh-gp-stat .dsh-gp-v{display:block;font-size:20px;font-weight:600;line-height:1.2;' +
    'font-variant-numeric:tabular-nums;}' +
    '#dsh-gp-section .dsh-gp-stat .dsh-gp-v--accent{color:var(--dsw-alias-brand-primary,#edb449);}' +
    '#dsh-gp-section .dsh-gp-session{font:12px ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-secondary,#b6b4ab);' +
    'display:block;margin:0 0 10px;overflow-wrap:anywhere;}';
  if (!document.getElementById('dsh-gp-style')) {
    style.id = 'dsh-gp-style';
    document.head.appendChild(style);
  }

  var shell = window.dshShell || null;
  var rows = [];

  // DSH 导航/行内图标同款约定：16×16、fill=none、stroke=currentColor 1.25、圆头
  var ICON_D = {
    power: '<path d="M8 2v6"/><path d="M12.5 5.5a6 6 0 1 1-9 0"/>',
    folder: '<path d="M2.5 4.5h4l1.5 2h5.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5Z"/>',
    bell: '<path d="M8 3a3.5 3.5 0 0 1 3.5 3.5c0 2.5 1 3.5 1.5 4H3c.5-.5 1.5-1.5 1.5-4A3.5 3.5 0 0 1 8 3Z"/><path d="M7 13a1.5 1.5 0 0 0 2 0"/>',
    doc: '<path d="M3 3h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M5 6.5h6M5 9.5h6M5 12.5h3"/>',
    chart: '<path d="M3 13.5h10"/><path d="M5 13.5V9.5"/><path d="M8 13.5V5.5"/><path d="M11 13.5V7.5"/><path d="M14 13.5V3.5"/>',
  };
  var ICON = function (kind) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_D[kind] || '') + '</svg>';
  };

  function webPersona() {
    return 'You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.';
  }

  function buildPayload(restart) {
    return {
      includeHarnessIdentity: document.getElementById('dsh-gp-identity').checked,
      persona: document.getElementById('dsh-gp-persona-toggle').checked
        ? document.getElementById('dsh-gp-persona').value
        : '',
      globalPrompt: document.getElementById('dsh-gp-global').value,
      notifyResult: document.getElementById('dsh-gp-notify').checked,
      restart: restart,
    };
  }

  function setStatus(id, text, isErr) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.className = 'dsh-gp-status' + (isErr ? ' err' : '');
  }

  async function save(restart) {
    if (!shell) return;
    setStatus('dsh-gp-status', '…', false);
    try {
      var r = await shell.savePromptSettings(buildPayload(restart));
      if (r && r.ok) setStatus('dsh-gp-status', r.restarting ? T('savedRestart') : (r.message || T('saved')), false);
      else setStatus('dsh-gp-status', T('failed') + (r && r.message ? r.message : ''), true);
    } catch (e) {
      setStatus('dsh-gp-status', T('failed') + String(e), true);
    }
  }

  async function fill() {
    if (!shell || !document.getElementById('dsh-gp-section')) return;
    try {
      var state = await shell.getPromptSettings();
      if (!state) return;
      document.getElementById('dsh-gp-identity').checked = Boolean(state.includeHarnessIdentity);
      var persona = typeof state.persona === 'string' ? state.persona : '';
      document.getElementById('dsh-gp-persona-toggle').checked = persona.trim() !== '';
      document.getElementById('dsh-gp-persona').value = persona || webPersona();
      document.getElementById('dsh-gp-notify').checked = state.notifyResult !== false;
      var modeEl = document.getElementById('dsh-gp-mode');
      var modeHintEl = document.getElementById('dsh-gp-mode-hint');
      if (state.mode === 'managed') {
        modeEl.textContent = '🟢 ' + T('modeManaged');
        modeEl.className = 'dsh-gp-mode dsh-gp-mode--managed';
        if (modeHintEl) modeHintEl.textContent = T('modeManagedHint');
        document.getElementById('dsh-gp-global').value = typeof state.globalPrompt === 'string' ? state.globalPrompt : '';
        document.getElementById('dsh-gp-path').textContent = state.globalPromptPath ? T('editingPath') + state.globalPromptPath : '';
      } else {
        modeEl.textContent = '🔴 ' + T('modeReuse');
        modeEl.className = 'dsh-gp-mode dsh-gp-mode--reuse';
        if (modeHintEl) modeHintEl.textContent = T('modeReuseHint');
        // 复用外部服务：全局指令可编辑（落到外部服务真实读的 AGENTS.md）；身份/persona 也放开（保存后提示需重启）
        document.getElementById('dsh-gp-global').value = typeof state.globalPrompt === 'string' ? state.globalPrompt : '';
        document.getElementById('dsh-gp-path').textContent = state.globalPromptPath ? T('editingPath') + state.globalPromptPath : '';
        document.getElementById('dsh-gp-banner').style.display = '';
        // 外部服务模式不接管重启：禁用重启按钮（身份/persona 保存只提示"需重启"，不强行重启别人的服务）
        var restartBtn = document.getElementById('dsh-gp-save-restart');
        if (restartBtn) restartBtn.disabled = true;
      }
      // 项目级指令
      var pr = await shell.listProjectInstructions();
      var sel = document.getElementById('dsh-gp-ws');
      if (pr && pr.ok) {
        rows = pr.items || [];
        sel.innerHTML = '';
        rows.forEach(function (row) {
          var o = document.createElement('option');
          o.value = row.workspaceId;
          o.textContent = row.title || row.path;
          sel.appendChild(o);
        });
        if (rows.length > 0) renderProject(rows[0]);
        else setStatus('dsh-gp-project-status', T('projectNone'), true);
      } else {
        setStatus('dsh-gp-project-status', pr && pr.message ? pr.message : T('projectNone'), true);
      }
    } catch (e) {
      setStatus('dsh-gp-status', T('failed') + String(e), true);
    }
  }

  function renderProject(row) {
    document.getElementById('dsh-gp-ws').value = row.workspaceId;
    document.getElementById('dsh-gp-project-path').textContent = row.path ? row.path + '/AGENTS.md' : '';
    document.getElementById('dsh-gp-project').value = row.content || '';
  }

  async function saveProject() {
    if (!shell) return;
    var r = await shell.saveProjectInstruction({
      workspaceId: document.getElementById('dsh-gp-ws').value,
      content: document.getElementById('dsh-gp-project').value,
    });
    setStatus('dsh-gp-project-status', r.ok ? T('projectSaved') : T('projectFailed') + (r.message || ''), !r.ok);
  }

  function sectionMarkup() {
    return '' +
      '<h2>' + T('globalTitle') + '</h2>' +
      '<span class="dsh-gp-mode" id="dsh-gp-mode"></span>' +
      '<p class="dsh-gp-hint" id="dsh-gp-mode-hint"></p>' +
      '<p class="dsh-gp-hint">' + T('globalHint') + '</p>' +
      '<div class="dsh-gp-banner" id="dsh-gp-banner" style="display:none">' + T('reuse') + '</div>' +
      '<p class="dsh-gp-path" id="dsh-gp-path"></p>' +
      '<textarea id="dsh-gp-global" rows="8" spellcheck="false" placeholder="' + T('globalPlaceholder') + '"></textarea>' +
      '<h3>' + ICON('power') + T('injectTitle') + '</h3>' +
      '<p class="dsh-gp-hint">' + T('injectHint') + '</p>' +
      '<label class="dsh-gp-row"><input type="checkbox" id="dsh-gp-identity" /><span>' +
      '<span class="dsh-gp-label">' + T('identity') + '</span>' +
      '<span class="dsh-gp-sub">' + T('identityHint') + '</span></span></label>' +
      '<label class="dsh-gp-row"><input type="checkbox" id="dsh-gp-persona-toggle" /><span>' +
      '<span class="dsh-gp-label">' + T('persona') + '</span>' +
      '<span class="dsh-gp-sub">' + T('personaHint') + '</span></span></label>' +
      '<textarea id="dsh-gp-persona" rows="3" spellcheck="false" style="margin-top:8px"></textarea>' +
      '<p><button class="dsh-gp-btn dsh-gp-ghost" id="dsh-gp-oneclick" type="button">' + T('oneClick') + '</button></p>' +
      '<h3>' + ICON('folder') + T('projectTitle') + '</h3>' +
      '<p class="dsh-gp-hint">' + T('projectHint') + '</p>' +
      '<select id="dsh-gp-ws" style="font-family:inherit"></select>' +
      '<p class="dsh-gp-path" id="dsh-gp-project-path"></p>' +
      '<textarea id="dsh-gp-project" rows="6" spellcheck="false"></textarea>' +
      '<p><button class="dsh-gp-btn dsh-gp-ghost" id="dsh-gp-project-save" type="button">' + T('projectSave') + '</button></p>' +
      '<span class="dsh-gp-status" id="dsh-gp-project-status"></span>' +
      '<h3>' + ICON('bell') + T('notifyTitle') + '</h3>' +
      '<label class="dsh-gp-row"><input type="checkbox" id="dsh-gp-notify" /><span>' +
      '<span class="dsh-gp-label">' + T('notifyLabel') + '</span>' +
      '<span class="dsh-gp-sub">' + T('notifyHint') + '</span></span></label>' +
      '<p style="margin-top:16px">' +
      '<button class="dsh-gp-btn dsh-gp-primary" id="dsh-gp-save" type="button">' + T('save') + '</button> ' +
      '<button class="dsh-gp-btn dsh-gp-ghost" id="dsh-gp-save-restart" type="button">' + T('saveRestart') + '</button>' +
      '</p>' +
      '<span class="dsh-gp-status" id="dsh-gp-status"></span>';
  }

  function wire() {
    document.getElementById('dsh-gp-save').addEventListener('click', function () { save(false); });
    document.getElementById('dsh-gp-save-restart').addEventListener('click', function () { save(true); });
    document.getElementById('dsh-gp-oneclick').addEventListener('click', function () {
      document.getElementById('dsh-gp-identity').checked = true;
      document.getElementById('dsh-gp-persona-toggle').checked = true;
      document.getElementById('dsh-gp-persona').value = webPersona();
    });
    document.getElementById('dsh-gp-ws').addEventListener('change', function () {
      var row = rows.find(function (r) { return r.workspaceId === document.getElementById('dsh-gp-ws').value; });
      if (row) renderProject(row);
    });
    document.getElementById('dsh-gp-project-save').addEventListener('click', saveProject);
    fill();
  }

  // ---- 用量统计（ZCode 式，数据 = DSH session.history 的 host 投影汇总）----
  function fmtTokens(n) {
    function scaled(v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); }
    if (n < 1000) return String(n);
    if (n < 1000000) return scaled(n / 1000) + 'K';
    return scaled(n / 1000000) + 'M';
  }
  function fmtDuration(ms) {
    var s = ms / 1000;
    if (s < 60) return Math.round(s * 10) / 10 + 's';
    var whole = Math.round(s);
    return Math.floor(whole / 60) + 'm' + (whole % 60) + 's';
  }
  function setUsage(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function usageMarkup() {
    return '' +
      '<h2>' + T('usageTitle') + '</h2>' +
      '<p class="dsh-gp-hint">' + T('usageHint') + '</p>' +
      '<p><button class="dsh-gp-btn dsh-gp-ghost" id="dsh-gp-usage-refresh" type="button">' + T('usageRefresh') + '</button></p>' +
      '<span class="dsh-gp-session" id="dsh-gp-usage-session"></span>' +
      '<h3>' + ICON('chart') + T('tokensTitle') + '</h3>' +
      '<p class="dsh-gp-hint">' + T('tokensHint') + '</p>' +
      '<div class="dsh-gp-grid">' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('inputLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-input">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('outputLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-output">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('cacheReadLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-cache-read">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('cacheWriteLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-cache-write">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('cacheHitLabel') + '</span><span class="dsh-gp-v dsh-gp-v--accent" id="dsh-gp-usage-cache-hit">–</span></div>' +
      '</div>' +
      '<h3>' + ICON('chart') + T('timeTitle') + '</h3>' +
      '<p class="dsh-gp-hint">' + T('timeHint') + '</p>' +
      '<div class="dsh-gp-grid">' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('llmLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-llm">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('toolLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-tool">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('ttftLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-ttft">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('decodeLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-decode">–</span></div>' +
      '</div>' +
      '<h3>' + ICON('chart') + T('activityTitle') + '</h3>' +
      '<p class="dsh-gp-hint">' + T('activityHint') + '</p>' +
      '<div class="dsh-gp-grid">' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('turnsLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-turns">–</span></div>' +
      '<div class="dsh-gp-stat"><span class="dsh-gp-k">' + T('stepsLabel') + '</span><span class="dsh-gp-v" id="dsh-gp-usage-steps">–</span></div>' +
      '</div>' +
      '<span class="dsh-gp-status" id="dsh-gp-usage-status"></span>';
  }

  async function fillUsage() {
    if (!shell || !document.getElementById('dsh-gp-usage-section')) return;
    setStatus('dsh-gp-usage-status', T('usageLoading'), false);
    try {
      var r = await shell.getSessionUsage();
      if (!r || !r.ok) {
        setStatus('dsh-gp-usage-status', (r && r.message) || T('usageFailed') + T('usageNone'), true);
        return;
      }
      var u = r.usage || {};
      var billed = (u.uncachedInputTokens || 0) + (u.cacheReadTokens || 0) + (u.cacheWriteTokens || 0);
      var hit = billed === 0 ? null : Math.round(((u.cacheReadTokens || 0) / billed) * 100);
      var ttftSteps = u.ttftSteps || 0;
      var avgTtft = ttftSteps === 0 ? null : (u.ttftMs || 0) / ttftSteps;
      var decodeSpeed = u.decodeMs > 0 && u.decodeTokens > 0
        ? Math.round((u.decodeTokens / (u.decodeMs / 1000)) * 10) / 10
        : null;
      setUsage('dsh-gp-usage-session', r.title ? T('usageSession') + r.title : '');
      setUsage('dsh-gp-usage-input', fmtTokens(u.uncachedInputTokens || 0));
      setUsage('dsh-gp-usage-output', fmtTokens(u.outputTokens || 0));
      setUsage('dsh-gp-usage-cache-read', fmtTokens(u.cacheReadTokens || 0));
      setUsage('dsh-gp-usage-cache-write', fmtTokens(u.cacheWriteTokens || 0));
      setUsage('dsh-gp-usage-cache-hit', hit === null ? '–' : hit + '%');
      setUsage('dsh-gp-usage-llm', fmtDuration(u.llmMs || 0));
      setUsage('dsh-gp-usage-tool', fmtDuration(u.toolMs || 0));
      setUsage('dsh-gp-usage-ttft', avgTtft === null ? '–' : Math.round(avgTtft / 100) / 10 + 's');
      setUsage('dsh-gp-usage-decode', decodeSpeed === null ? '–' : decodeSpeed + ' t/s');
      setUsage('dsh-gp-usage-turns', String(u.turns || 0));
      setUsage('dsh-gp-usage-steps', String(u.steps || 0));
      setStatus('dsh-gp-usage-status', '', false);
    } catch (e) {
      setStatus('dsh-gp-usage-status', T('usageFailed') + String(e), true);
    }
  }

  function wireUsage() {
    document.getElementById('dsh-gp-usage-refresh').addEventListener('click', fillUsage);
    fillUsage();
  }

  function makeNavCell(navBtn, id, titleKey, iconInner) {
    var cell = navBtn.cloneNode(true);
    cell.id = id;
    cell.className = cell.className.split(/\\s+/).filter(function (c) { return !/active/i.test(c); }).join(' ');
    var cellSvg = cell.querySelector('svg');
    if (cellSvg) {
      cellSvg.setAttribute('viewBox', '0 0 16 16');
      cellSvg.setAttribute('fill', 'none');
      cellSvg.setAttribute('stroke', 'currentColor');
      cellSvg.setAttribute('stroke-width', '1.25');
      cellSvg.setAttribute('stroke-linecap', 'round');
      cellSvg.setAttribute('stroke-linejoin', 'round');
      cellSvg.innerHTML = iconInner;
    }
    var label = cell.querySelector('span');
    if (label) label.textContent = T(titleKey);
    else cell.textContent = T(titleKey);
    return cell;
  }

  function attach() {
    var navBtn = Array.prototype.slice.call(document.querySelectorAll('button')).find(function (b) {
      return /通用设置|General/.test(b.textContent || '');
    });
    if (!navBtn) return;
    var navList = navBtn.parentElement;
    var nav = navList.parentElement;
    var panelRoot = nav.parentElement;
    var content = nav.nextElementSibling;
    if (!panelRoot || !content || document.getElementById('dsh-gp-nav')) return;

    // 克隆导航格（保 DSH 原生样式），去掉激活类，换我们的标题与图标
    var cell = makeNavCell(navBtn, 'dsh-gp-nav', 'title', ICON_D.doc);
    var usageCell = makeNavCell(navBtn, 'dsh-gp-usage-nav', 'usageTitle', ICON_D.chart);
    // 紧跟在"通用设置"之后（第 2、3 位），比排在最后更显眼
    navList.insertBefore(cell, navList.children[1] || null);
    navList.insertBefore(usageCell, navList.children[2] || null);

    // 内容区 = nav 之后的兄弟（.content = .header 关闭钮 + .options 滚动区）。
    // 面板挂进 .content（.options 之后）而非 .panel：.panel 是 overflow:hidden 定高，
    // 挂那会被裁掉、无法上下滑动；挂 .content 内既保留关闭钮可见，又让面板作为
    // flex 子项（flex:1 + overflow-y:auto）随 .content 列布局滚动。
    var options = content.lastElementChild;
    var section = document.createElement('div');
    section.id = 'dsh-gp-section';
    section.style.display = 'none';
    section.innerHTML = sectionMarkup();
    content.appendChild(section);
    wire();

    var usageSection = document.createElement('div');
    usageSection.id = 'dsh-gp-usage-section';
    usageSection.style.display = 'none';
    usageSection.innerHTML = usageMarkup();
    content.appendChild(usageSection);
    wireUsage();

    function showSection(target) {
      if (options) options.style.display = 'none';
      section.style.display = target === section ? '' : 'none';
      usageSection.style.display = target === usageSection ? '' : 'none';
      Array.prototype.forEach.call(navList.children, function (c) {
        c.className = c.className.split(/\\s+/).filter(function (x) { return !/active/i.test(x); }).join(' ');
      });
      var activeCls = navBtn.className.split(/\\s+/).find(function (x) { return /active/i.test(x); }) || '';
      (target === section ? cell : usageCell).className += ' ' + activeCls;
    }
    cell.addEventListener('click', function () { showSection(section); });
    usageCell.addEventListener('click', function () { showSection(usageSection); });
    Array.prototype.forEach.call(navList.children, function (c) {
      if (c === cell || c === usageCell) return;
      c.addEventListener('click', function () {
        if (options) options.style.display = '';
        section.style.display = 'none';
        usageSection.style.display = 'none';
      });
    });
  }

  attach();
  var extTimer = null;
  function extSchedule() {
    // 防抖：DSH 活跃会话高频重渲染，attach 合并到 200ms 一批（另保留 1.5s 兜底轮询）
    if (extTimer) return;
    extTimer = setTimeout(function () { extTimer = null; attach(); }, 200);
  }
  new MutationObserver(extSchedule).observe(document.body, { childList: true, subtree: true });
  setInterval(attach, 1500);
})();`;
