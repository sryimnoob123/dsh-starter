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
      globalHint: '写在这里的内容，每次对话都会自动带上。改完点保存，马上生效。',
      globalPlaceholder: '在这里写全局规则，例如：\\n\\n- 用中文回答\\n- 先想清楚再动手',
      injectTitle: '注入开关',
      injectHint: '下面两个开关，决定每次对话要不要额外带上「身份」和「人设」这两段文字。',
      identity: '身份注入',
      identityHint: '勾上后，每次对话开头会加一句「我是 DeepSeek Harness」。默认不勾。',
      persona: '人设注入',
      personaHint: '勾上后，你写的人设会一直拼在对话里。支持 {{model}} 和 {{cwd}} 两个占位符。不勾 = 不注入。',
      personaTpl: '人设模板',
      oneClick: '一键填入默认提示词',
      projectTitle: '项目级指令',
      projectHint: '只对某个工作区生效的规则，存在那个工作区的 AGENTS.md 里。',
      projectSave: '保存到该工作区',
      projectNone: '没有工作区，或服务没在运行。',
      projectSaved: '已保存。',
      projectFailed: '保存失败：',
      notifyTitle: '通知',
      notifyLabel: '任务结果桌面通知',
      notifyHint: '任务做完或失败时，弹个桌面通知提醒你，点它能回到对应会话。',
      save: '保存',
      saveRestart: '重启并加载',
      saved: '已保存，马上生效。',
      savedRestart: '已保存，正在重启服务…',
      failed: '保存失败：',
      modeManaged: '壳管模式',
      editingPath: '正在编辑：',
      modeManagedHint: '服务由本应用启动和管理。你在这里改的东西，保存后马上生效，不用做任何别的操作。',
      usageTitle: '用量统计',
      usageHint: '所有会话加起来的用量（token / 耗时 / 活动）。',
      usageTokensTitle: 'Token',
      usageTimeTitle: '耗时',
      usageActivityTitle: '活动',
      usageInput: '输入（未缓存）',
      usageOutput: '输出',
      usageCacheRead: '缓存读取',
      usageCacheWrite: '缓存写入',
      usageCacheHit: '缓存命中率',
      usageLlm: 'LLM 总时长',
      usageTool: '工具总时长',
      usageTtft: '平均首 token',
      usageDecode: '解码速度',
      usageSessions: '会话数',
      usageTurns: '轮次',
      usageSteps: '步数',
      usageRefresh: '刷新',
      usageLoading: '正在读取用量…',
      usageFailed: '读取失败：',
    },
    en: {
      title: 'Global prompt',
      globalTitle: 'Global system prompt',
      globalHint: 'Whatever you write here is added to every conversation. Save applies it right away.',
      globalPlaceholder: 'Write global rules here, e.g.:\\n\\n- Answer in Chinese\\n- Think before acting',
      injectTitle: 'Injection switches',
      injectHint: 'Two switches that decide whether to add the identity and persona texts to every conversation.',
      identity: 'Identity injection',
      identityHint: 'When on, each conversation starts with a line saying "I am DeepSeek Harness". Off by default.',
      persona: 'Persona injection',
      personaHint: 'When on, the persona you write is always included in conversations. Supports {{model}} and {{cwd}}. Off = not injected.',
      personaTpl: 'Persona template',
      oneClick: 'Fill default prompt with one click',
      projectTitle: 'Project instructions',
      projectHint: 'Rules for one workspace only, stored in that workspace\\'s AGENTS.md.',
      projectSave: 'Save to workspace',
      projectNone: 'No workspaces, or the service is not running.',
      projectSaved: 'Saved.',
      projectFailed: 'Save failed: ',
      notifyTitle: 'Notifications',
      notifyLabel: 'Job result desktop notifications',
      notifyHint: 'A desktop notification when a job finishes or fails; clicking it jumps to the session.',
      save: 'Save',
      saveRestart: 'Restart & reload',
      saved: 'Saved — applied right away.',
      savedRestart: 'Saved — restarting the service…',
      failed: 'Save failed: ',
      modeManaged: 'Shell-managed',
      editingPath: 'Editing: ',
      modeManagedHint: 'The service is started and managed by this app. Anything you change here takes effect right after you save — no other steps needed.',
      usageTitle: 'Usage',
      usageHint: 'Cumulative usage across all sessions (tokens / time / activity).',
      usageTokensTitle: 'Tokens',
      usageTimeTitle: 'Time',
      usageActivityTitle: 'Activity',
      usageInput: 'Input (uncached)',
      usageOutput: 'Output',
      usageCacheRead: 'Cache read',
      usageCacheWrite: 'Cache write',
      usageCacheHit: 'Cache hit',
      usageLlm: 'LLM time',
      usageTool: 'Tool time',
      usageTtft: 'Avg first token',
      usageDecode: 'Decode speed',
      usageSessions: 'Sessions',
      usageTurns: 'Turns',
      usageSteps: 'Steps',
      usageRefresh: 'Refresh',
      usageLoading: 'Loading usage…',
      usageFailed: 'Failed: ',
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
    '#dsh-gp-section .dsh-gp-mode{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;' +
    'font-weight:600;line-height:18px;margin:0 0 8px;border:1px solid transparent;}' +
    '#dsh-gp-section .dsh-gp-mode--managed{color:#3fb37a;background:rgba(63,179,122,0.12);border-color:rgba(63,179,122,0.35);}' +
    '#dsh-gp-usage-section{color:var(--dsw-alias-label-primary,#e8e6dd);flex:1 1 auto;min-width:0;min-height:0;overflow-y:auto;padding:0 24px 24px;box-sizing:border-box;font-size:14px;line-height:1.5;}' +
    '#dsh-gp-usage-section h2{margin:0 0 4px;font-size:15px;font-weight:600;}' +
    '#dsh-gp-usage-section h3{margin:18px 0 6px;font-size:14px;font-weight:500;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-hint{margin:0 0 10px;color:var(--dsw-alias-label-secondary,#b6b4ab);font-size:13px;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:0 0 4px;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-card{background:var(--dsw-alias-bg-layer-2,#1c1b1a);border:1px solid var(--dsw-alias-border-l2,#393836);border-radius:9px;padding:10px 12px;min-width:0;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-k{display:block;font-size:12px;color:var(--dsw-alias-label-secondary,#b6b4ab);margin-bottom:2px;overflow-wrap:anywhere;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-v{display:block;font-size:18px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums;}' +
    '#dsh-gp-usage-section .dsh-gp-usage-status{display:block;min-height:20px;margin-top:8px;font-size:13px;color:var(--dsw-alias-label-secondary,#b6b4ab);}' +
    '#dsh-gp-usage-section .dsh-gp-usage-status.err{color:var(--dsw-alias-state-error-primary,#d98678);}';
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
    chart: '<path d="M3 13h10"/><path d="M5.5 13V9"/><path d="M8 13V6"/><path d="M10.5 13V3.5"/>',
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
      document.getElementById('dsh-gp-notify').checked = state.notifyResult === true;
      var modeEl = document.getElementById('dsh-gp-mode');
      var modeHintEl = document.getElementById('dsh-gp-mode-hint');
      // managed 模式：壳自己管服务，改动保存即生效、重启按钮始终可点
      modeEl.textContent = '🟢 ' + T('modeManaged');
      modeEl.className = 'dsh-gp-mode dsh-gp-mode--managed';
      if (modeHintEl) modeHintEl.textContent = T('modeManagedHint');
      document.getElementById('dsh-gp-global').value = typeof state.globalPrompt === 'string' ? state.globalPrompt : '';
      document.getElementById('dsh-gp-path').textContent = state.globalPromptPath ? T('editingPath') + state.globalPromptPath : '';
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

  function usageCard(id, label) {
    return '<div class="dsh-gp-usage-card"><span class="dsh-gp-usage-k">' + label + '</span><span class="dsh-gp-usage-v" id="' + id + '">–</span></div>';
  }

  function usageMarkup() {
    return '' +
      '<h2>' + T('usageTitle') + '</h2>' +
      '<p class="dsh-gp-usage-hint">' + T('usageHint') + '</p>' +
      '<p style="margin:0 0 12px"><button class="dsh-gp-btn dsh-gp-ghost" id="dsh-gp-usage-refresh" type="button">' + T('usageRefresh') + '</button></p>' +
      '<h3>' + T('usageTokensTitle') + '</h3>' +
      '<div class="dsh-gp-usage-grid">' +
        usageCard('dsh-gp-usage-input', T('usageInput')) +
        usageCard('dsh-gp-usage-output', T('usageOutput')) +
        usageCard('dsh-gp-usage-cache-read', T('usageCacheRead')) +
        usageCard('dsh-gp-usage-cache-write', T('usageCacheWrite')) +
        usageCard('dsh-gp-usage-cache-hit', T('usageCacheHit')) +
      '</div>' +
      '<h3>' + T('usageTimeTitle') + '</h3>' +
      '<div class="dsh-gp-usage-grid">' +
        usageCard('dsh-gp-usage-llm', T('usageLlm')) +
        usageCard('dsh-gp-usage-tool', T('usageTool')) +
        usageCard('dsh-gp-usage-ttft', T('usageTtft')) +
        usageCard('dsh-gp-usage-decode', T('usageDecode')) +
      '</div>' +
      '<h3>' + T('usageActivityTitle') + '</h3>' +
      '<div class="dsh-gp-usage-grid">' +
        usageCard('dsh-gp-usage-sessions', T('usageSessions')) +
        usageCard('dsh-gp-usage-turns', T('usageTurns')) +
        usageCard('dsh-gp-usage-steps', T('usageSteps')) +
      '</div>' +
      '<span class="dsh-gp-usage-status" id="dsh-gp-usage-status"></span>';
  }

  function fmtTokens(n) {
    var scaled = function (v) { return v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10); };
    if (n < 1000) return String(n);
    if (n < 1000000) return scaled(n / 1000) + 'K';
    return scaled(n / 1000000) + 'M';
  }

  function fmtDuration(ms) {
    var s = ms / 1000;
    if (s < 60) return String(Math.round(s * 10) / 10) + 's';
    var whole = Math.round(s);
    return Math.floor(whole / 60) + 'm' + (whole % 60) + 's';
  }

  function setUsage(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setUsageStatus(text, isErr) {
    var el = document.getElementById('dsh-gp-usage-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'dsh-gp-usage-status' + (isErr ? ' err' : '');
  }

  async function fillUsage() {
    if (!shell || !document.getElementById('dsh-gp-usage-section')) return;
    setUsageStatus(T('usageLoading'), false);
    try {
      var r = await shell.getSessionUsage();
      if (!r || !r.ok) {
        setUsageStatus(T('usageFailed') + ((r && r.message) || ''), true);
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
      setUsage('dsh-gp-usage-input', fmtTokens(u.uncachedInputTokens || 0));
      setUsage('dsh-gp-usage-output', fmtTokens(u.outputTokens || 0));
      setUsage('dsh-gp-usage-cache-read', fmtTokens(u.cacheReadTokens || 0));
      setUsage('dsh-gp-usage-cache-write', fmtTokens(u.cacheWriteTokens || 0));
      setUsage('dsh-gp-usage-cache-hit', hit === null ? '–' : hit + '%');
      setUsage('dsh-gp-usage-llm', fmtDuration(u.llmMs || 0));
      setUsage('dsh-gp-usage-tool', fmtDuration(u.toolMs || 0));
      setUsage('dsh-gp-usage-ttft', avgTtft === null ? '–' : String(Math.round(avgTtft / 100) / 10) + 's');
      setUsage('dsh-gp-usage-decode', decodeSpeed === null ? '–' : String(decodeSpeed) + ' t/s');
      setUsage('dsh-gp-usage-sessions', String(r.sessionCount || 0));
      setUsage('dsh-gp-usage-turns', String(u.turns || 0));
      setUsage('dsh-gp-usage-steps', String(u.steps || 0));
      setUsageStatus('', false);
    } catch (e) {
      setUsageStatus(T('usageFailed') + String(e), true);
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

    // 内容区 = nav 之后的兄弟（.content = .header 关闭钮 + .options 滚动区）。
    // 面板挂进 .content（.options 之后）而非 .panel：.panel 是 overflow:hidden 定高，
    // 挂那会被裁掉、无法上下滑动；挂 .content 内既保留关闭钮可见，又让面板作为
    // flex 子项（flex:1 + overflow-y:auto）随 .content 列布局滚动。
    var options = content.lastElementChild;

    // 壳扩展清单（顺序 = 导航位置）：全局提示词第 2 位、用量统计第 3 位
    var exts = [
      { navId: 'dsh-gp-nav', sectionId: 'dsh-gp-section', titleKey: 'title', icon: ICON_D.doc, markup: sectionMarkup, wire: wire },
      { navId: 'dsh-gp-usage-nav', sectionId: 'dsh-gp-usage-section', titleKey: 'usageTitle', icon: ICON_D.chart, markup: usageMarkup, wire: wireUsage },
    ];

    exts.forEach(function (ext, idx) {
      // 克隆导航格（保 DSH 原生样式），去掉激活类，换我们的标题与图标
      var cell = makeNavCell(navBtn, ext.navId, ext.titleKey, ext.icon);
      navList.insertBefore(cell, navList.children[1 + idx] || null);
      var section = document.createElement('div');
      section.id = ext.sectionId;
      section.style.display = 'none';
      section.innerHTML = ext.markup();
      content.appendChild(section);
      ext.wire();

      cell.addEventListener('click', function () {
        if (options) options.style.display = 'none';
        exts.forEach(function (o) {
          var s = document.getElementById(o.sectionId);
          if (s) s.style.display = 'none';
        });
        section.style.display = '';
        Array.prototype.forEach.call(navList.children, function (c) {
          c.className = c.className.split(/\\s+/).filter(function (x) { return !/active/i.test(x); }).join(' ');
        });
        cell.className += ' ' + (navBtn.className.split(/\\s+/).find(function (x) { return /active/i.test(x); }) || '');
      });
    });

    Array.prototype.forEach.call(navList.children, function (c) {
      var isExt = exts.some(function (e) { return c.id === e.navId; });
      if (isExt) return;
      c.addEventListener('click', function () {
        if (options) options.style.display = '';
        exts.forEach(function (o) {
          var s = document.getElementById(o.sectionId);
          if (s) s.style.display = 'none';
        });
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
