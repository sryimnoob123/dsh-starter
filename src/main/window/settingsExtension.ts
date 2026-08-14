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
      reuse: '当前复用外部 DSH 服务：身份注入 / persona / 全局指令由该服务的环境决定。',
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
      reuse: 'An external DSH service is being reused: identity / persona / global instructions belong to that service.',
    },
  };
  var T = function (key) { return STR[LANG][key]; };

  var style = document.createElement('style');
  style.textContent =
    '#dsh-gp-section{color:var(--dsw-alias-label-primary,#e8e6dd);padding:16px 2px;font-size:14px;line-height:1.5;}' +
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
    'color:var(--dsw-alias-label-secondary,#b6b4ab);font-size:13px;}';
  if (!document.getElementById('dsh-gp-style')) {
    style.id = 'dsh-gp-style';
    document.head.appendChild(style);
  }

  var shell = window.dshShell || null;
  var rows = [];

  // DSH 导航/行内图标同款约定：16×16、fill=none、stroke=currentColor 1.25、圆头
  var ICON = function (kind) {
    var d = {
      power: '<path d="M8 2v6"/><path d="M12.5 5.5a6 6 0 1 1-9 0"/>',
      folder: '<path d="M2.5 4.5h4l1.5 2h5.5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5Z"/>',
      bell: '<path d="M8 3a3.5 3.5 0 0 1 3.5 3.5c0 2.5 1 3.5 1.5 4H3c.5-.5 1.5-1.5 1.5-4A3.5 3.5 0 0 1 8 3Z"/><path d="M7 13a1.5 1.5 0 0 0 2 0"/>',
      doc: '<path d="M3 3h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M5 6.5h6M5 9.5h6M5 12.5h3"/>',
    }[kind] || '';
    return '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
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
      if (state.mode === 'managed') {
        document.getElementById('dsh-gp-global').value = typeof state.globalPrompt === 'string' ? state.globalPrompt : '';
        document.getElementById('dsh-gp-path').textContent = state.globalPromptPath || '';
      } else {
        document.getElementById('dsh-gp-banner').style.display = '';
        document.getElementById('dsh-gp-path').textContent = '';
        var dis = [document.getElementById('dsh-gp-global'), document.getElementById('dsh-gp-identity'), document.getElementById('dsh-gp-persona-toggle'), document.getElementById('dsh-gp-persona')];
        dis.forEach(function (n) { if (n) n.disabled = true; });
        // 外部服务模式不接管：禁用重启按钮（与独立设置页一致，避免误导）
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

  function attach() {
    var navBtn = Array.prototype.slice.call(document.querySelectorAll('button')).find(function (b) {
      return /通用设置|General/.test(b.textContent || '');
    });
    if (!navBtn) return;
    var navList = navBtn.parentElement;
    var nav = navList.parentElement;
    var panelRoot = nav.parentElement;
    if (!panelRoot || document.getElementById('dsh-gp-nav')) return;

    // 克隆导航格（保 DSH 原生样式），去掉激活类，换我们的标题与图标
    var cell = navBtn.cloneNode(true);
    cell.id = 'dsh-gp-nav';
    cell.className = cell.className.split(/\\s+/).filter(function (c) { return !/active/i.test(c); }).join(' ');
    var cellSvg = cell.querySelector('svg');
    if (cellSvg) {
      cellSvg.setAttribute('viewBox', '0 0 16 16');
      cellSvg.setAttribute('fill', 'none');
      cellSvg.setAttribute('stroke', 'currentColor');
      cellSvg.setAttribute('stroke-width', '1.25');
      cellSvg.setAttribute('stroke-linecap', 'round');
      cellSvg.setAttribute('stroke-linejoin', 'round');
      cellSvg.innerHTML = '<path d="M3 3h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M5 6.5h6M5 9.5h6M5 12.5h3"/>';
    }
    var label = cell.querySelector('span');
    if (label) label.textContent = T('title');
    else cell.textContent = T('title');
    // 紧跟在"通用设置"之后（第二个位置），比排在最后更显眼
    navList.insertBefore(cell, navList.children[1] || null);

    // 内容区 = nav 之后的兄弟（DSH sections 容器）；我们的面板挂到面板根下
    var content = nav.nextElementSibling;
    var section = document.createElement('div');
    section.id = 'dsh-gp-section';
    section.style.display = 'none';
    section.innerHTML = sectionMarkup();
    panelRoot.appendChild(section);
    wire();

    cell.addEventListener('click', function () {
      if (content) content.style.display = 'none';
      section.style.display = '';
      Array.prototype.forEach.call(navList.children, function (c) {
        c.className = c.className.split(/\\s+/).filter(function (x) { return !/active/i.test(x); }).join(' ');
      });
      cell.className += ' ' + (navBtn.className.split(/\\s+/).find(function (x) { return /active/i.test(x); }) || '');
    });
    Array.prototype.forEach.call(navList.children, function (c) {
      if (c === cell) return;
      c.addEventListener('click', function () {
        if (content) content.style.display = '';
        section.style.display = 'none';
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
