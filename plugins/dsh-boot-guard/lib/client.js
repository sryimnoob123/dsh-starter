// dsh-boot-guard rescue console — loader-independent, dependency-free client.
(function () {
  "use strict";
  if (window.__DSH_BOOT_GUARD__) return;
  window.__DSH_BOOT_GUARD__ = true;

  var INSERTED = false;
  var MAX_SELECTION = 64;
  var FAILURE_TITLE = "Failed to load plugins";
  var LOADER_FAILURE_DETAIL = /failed to (?:import|apply|resolve|initialize) loader entry|client-modules:\s*bundle script .*failed to load/i;
  var HEALTHY_UI_SELECTOR = '[role="tree"],textarea,[contenteditable="true"],[role="textbox"],input:not([type="hidden"])';
  var observer = null;
  var observerStopTimer = null;
  var mountDebounceTimer = null;
  var panel = null;
  var restoreConfirmTimer = null;
  var isPreview = false;
  var failureText = "";
  var messages = {
    zh: {
      serviceOnline: "救援服务在线",
      serviceReadOnly: "救援服务只读",
      title: "启动恢复中心",
      subtitle: "插件加载已中断。定位故障项并临时跳过，刷新后即可重新进入工作区。",
      previewReadOnly: "只读自检",
      readOnlyMode: "只读模式",
      suspectHeading: "已定位疑似故障插件",
      autoSelected: "已自动选中",
      search: "搜索插件名称或条目 ID",
      refreshState: "重新检测插件状态",
      pluginScope: "插件范围",
      related: "疑似故障",
      custom: "用户插件",
      skipped: "救援已跳过",
      all: "全部插件",
      selectVisible: "选择当前可用项",
      clearSelection: "清除选择",
      copyDiagnostics: "复制诊断",
      restoreSkipped: "恢复已跳过",
      skipSelected: "跳过所选并刷新",
      configuredOff: "配置已禁用",
      rescueCore: "救援核心",
      instances: "{count} 个实例",
      selectPlugin: "选择 {name}",
      restore: "恢复",
      empty: "当前范围内没有匹配的插件",
      listSummary: "显示 {visible} 项 · {actionable} 项可操作",
      skipSelectedCount: "跳过所选并刷新（{count}）",
      restoreConfirmCount: "再次点击确认恢复（{count}）",
      restoreSkippedCount: "恢复已跳过（{count}）",
      readOnlyDefault: "当前无法安全修改配置，已进入只读模式。",
      readOnlyProfile: "无法安全定位当前 DSH profile，已进入只读模式。",
      readOnlyPatch: "当前 profile 的 cordis.patch.yml 无法安全读取或不是顶层 YAML 数组，已进入只读模式。",
      readOnlyRemote: "当前连接不是本机回环地址；远程配置变更默认禁用。",
      statusSelected: "已选择 {count} 个插件；只会写入带救援标记的临时禁用项。",
      statusSelectedOne: "已选择 1 个插件；只会写入带救援标记的临时禁用项。",
      statusSkipped: "当前有 {count} 个插件由救援临时跳过。",
      statusSkippedOne: "当前有 1 个插件由救援临时跳过。",
      statusIdle: "选择疑似故障插件后执行跳过；不会删除插件或用户数据。",
      previewNoMutation: "这是只读自检页面：界面与诊断正常，未修改任何插件配置。",
      refreshing: "{message}，正在刷新…",
      operationFailed: "操作失败：{message}",
      diagnosticsTitle: "DSH Boot Guard 诊断",
      reportVersion: "版本",
      reportTime: "时间",
      reportWritable: "可写",
      reportReadOnlyReason: "只读原因",
      reportSuspected: "疑似故障",
      reportSkipped: "救援已跳过",
      reportFailure: "加载错误",
      yes: "是",
      no: "否",
      none: "无",
      notDetected: "未识别",
      diagnosticsCopied: "诊断信息已复制到剪贴板。",
      clipboardFailed: "无法访问剪贴板，请手动复制错误信息。",
      detecting: "正在重新检测插件状态…",
      stateUpdated: "插件状态已更新。",
      refreshFailed: "状态刷新失败：{message}",
      maxSelection: "单次最多处理 {count} 个插件，请分批操作。",
      selectedFirst: "单次最多处理 {max} 个插件，已选择当前范围中的前 {count} 项。",
      writeSkipPending: "正在写入临时跳过配置…",
      skippedSuccess: "已跳过 {count} 个插件",
      skippedSuccessOne: "已跳过 1 个插件",
      restorePending: "正在恢复插件…",
      restoredSuccess: "插件已恢复",
      confirmRestore: "再次点击恢复按钮以确认；只会撤销 Boot Guard 写入的临时禁用项。",
      restoreAllPending: "正在恢复全部救援跳过项…",
      restoreAllSuccess: "全部救援跳过项已恢复",
      fallbackTitle: "救援服务暂时不可用",
      fallbackBody: "无法读取插件状态：{message}。请临时在当前 DSH profile 的 cordis.patch.yml 中禁用故障条目。",
      previewStatus: "自检模式不会修改配置；可检查搜索、筛选和选择交互。"
    },
    en: {
      serviceOnline: "Rescue service online",
      serviceReadOnly: "Rescue service read-only",
      title: "Startup Recovery Center",
      subtitle: "Plugin loading was interrupted. Find and temporarily skip the faulty entry, then refresh to return to your workspace.",
      previewReadOnly: "Read-only check",
      readOnlyMode: "Read-only mode",
      suspectHeading: "Likely faulty plugin found",
      autoSelected: "Selected automatically",
      search: "Search plugin name or entry ID",
      refreshState: "Check plugin status again",
      pluginScope: "Plugin scope",
      related: "Likely faulty",
      custom: "User plugins",
      skipped: "Rescue-skipped",
      all: "All plugins",
      selectVisible: "Select available items",
      clearSelection: "Clear selection",
      copyDiagnostics: "Copy diagnostics",
      restoreSkipped: "Restore skipped",
      skipSelected: "Skip selected and refresh",
      configuredOff: "Disabled in config",
      rescueCore: "Rescue core",
      instances: "{count} instances",
      selectPlugin: "Select {name}",
      restore: "Restore",
      empty: "No matching plugins in this view",
      listSummary: "Showing {visible} · {actionable} available",
      skipSelectedCount: "Skip selected and refresh ({count})",
      restoreConfirmCount: "Click again to restore ({count})",
      restoreSkippedCount: "Restore skipped ({count})",
      readOnlyDefault: "The active profile cannot be changed safely. Read-only mode is enabled.",
      readOnlyProfile: "The active DSH profile could not be located safely. Read-only mode is enabled.",
      readOnlyPatch: "The active profile's cordis.patch.yml could not be read safely or is not a top-level YAML array. Read-only mode is enabled.",
      readOnlyRemote: "This connection is not using a loopback address. Remote configuration changes are disabled by default.",
      statusSelected: "{count} plugins selected. Only temporary entries marked by Boot Guard will be written.",
      statusSelectedOne: "1 plugin selected. Only temporary entries marked by Boot Guard will be written.",
      statusSkipped: "{count} plugins are currently being skipped by Boot Guard.",
      statusSkippedOne: "1 plugin is currently being skipped by Boot Guard.",
      statusIdle: "Select a likely faulty plugin to skip it temporarily. No plugins or user data will be deleted.",
      previewNoMutation: "This is a read-only self-check. The UI and diagnostics work, and no plugin configuration was changed.",
      refreshing: "{message}. Refreshing…",
      operationFailed: "Operation failed: {message}",
      diagnosticsTitle: "DSH Boot Guard diagnostics",
      reportVersion: "Version",
      reportTime: "Time",
      reportWritable: "Writable",
      reportReadOnlyReason: "Read-only reason",
      reportSuspected: "Suspected",
      reportSkipped: "Guard skipped",
      reportFailure: "Failure",
      yes: "yes",
      no: "no",
      none: "none",
      notDetected: "not detected",
      diagnosticsCopied: "Diagnostics copied to the clipboard.",
      clipboardFailed: "Clipboard access is unavailable. Copy the error details manually.",
      detecting: "Checking plugin status again…",
      stateUpdated: "Plugin status updated.",
      refreshFailed: "Status refresh failed: {message}",
      maxSelection: "You can process up to {count} plugins at once. Please use smaller batches.",
      selectedFirst: "You can process up to {max} plugins at once. The first {count} available items were selected.",
      writeSkipPending: "Writing temporary skip entries…",
      skippedSuccess: "Skipped {count} plugins",
      skippedSuccessOne: "Skipped 1 plugin",
      restorePending: "Restoring plugin…",
      restoredSuccess: "Plugin restored",
      confirmRestore: "Click Restore again to confirm. Only temporary entries written by Boot Guard will be removed.",
      restoreAllPending: "Restoring all rescue-skipped plugins…",
      restoreAllSuccess: "All rescue-skipped plugins restored",
      fallbackTitle: "Rescue service is temporarily unavailable",
      fallbackBody: "Plugin status could not be read: {message}. Temporarily disable the faulty entry in the current DSH profile's cordis.patch.yml.",
      previewStatus: "Self-check mode does not change configuration. You can test search, filters, and selection."
    }
  };

  function normalizeLocale(value) {
    var primary = String(value || "").trim().toLowerCase().split(/[-_]/)[0];
    return primary === "en" || primary === "zh" ? primary : "";
  }

  function fallbackLocale() {
    var candidates = [];
    try { candidates.push(document.documentElement.getAttribute("lang")); } catch (_) {}
    try { candidates = candidates.concat(navigator.languages || [], navigator.language || ""); } catch (_) {}
    for (var index = 0; index < candidates.length; index++) {
      var locale = normalizeLocale(candidates[index]);
      if (locale) return locale;
    }
    return "zh";
  }

  var model = {
    version: "",
    locale: fallbackLocale(),
    entries: [],
    skipped: {},
    selected: {},
    suspects: {},
    filter: "custom",
    query: "",
    busy: false,
    confirmRestore: false,
    writable: true,
    readOnlyReason: "",
    readOnlyReasonCode: ""
  };

  function t(key, values) {
    var dictionary = messages[model.locale] || messages.zh;
    var value = dictionary[key] === undefined ? messages.zh[key] : dictionary[key];
    return String(value === undefined ? key : value).replace(/\{([a-z]+)\}/gi, function (_, name) {
      return values && values[name] !== undefined ? String(values[name]) : "{" + name + "}";
    });
  }

  function localizedReadOnlyReason() {
    if (model.readOnlyReasonCode === "profile-unresolved") return t("readOnlyProfile");
    if (model.readOnlyReasonCode === "patch-invalid") return t("readOnlyPatch");
    if (model.readOnlyReasonCode === "remote-mutation-disabled") return t("readOnlyRemote");
    return model.readOnlyReason || t("readOnlyDefault");
  }

  var icons = {
    rescue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm-5.6-.6 2.8 2.8m5.6 5.6 2.8 2.8m0-11.2-2.8 2.8m-5.6 5.6-2.8 2.8"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 .3 7M19 4v4h-4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
    warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.3 4.1 2.6 17.5A1.7 1.7 0 0 0 4.1 20h15.8a1.7 1.7 0 0 0 1.5-2.5L13.7 4.1a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 3.5v.01"/></svg>'
  };

  function api(path, options) {
    return fetch("/boot-guard" + path, Object.assign({ credentials: "same-origin" }, options || {}))
      .then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) throw new Error(body.error || ("HTTP " + response.status));
          return body;
        });
      });
  }

  function findFailureRoot() {
    var root = document.getElementById("root") || document.body;
    if (!root || !root.querySelector || !root.querySelectorAll) return null;

    // A healthy DSH shell always exposes navigation or an editable control.
    // Chat messages may quote the loader error, so never use root.textContent
    // alone as the failure signal.
    if (root.querySelector(HEALTHY_UI_SELECTOR)) return null;

    var heading = Array.prototype.find.call(root.querySelectorAll('h1,h2,h3,[role="heading"]'), function (candidate) {
      return String(candidate.textContent || "").replace(/\s+/g, " ").trim() === FAILURE_TITLE;
    });
    if (!heading) return null;

    var text = String(root.textContent || "").replace(/\s+/g, " ").trim();
    var titleOffset = text.indexOf(FAILURE_TITLE);
    if (titleOffset < 0 || titleOffset > 500 || text.length > 20000 || !LOADER_FAILURE_DETAIL.test(text)) return null;
    failureText = text;
    return root;
  }

  function detectDark() {
    try {
      var explicitTheme = document.documentElement.getAttribute("data-boot-guard-theme");
      if (explicitTheme) return explicitTheme === "dark";
      if (document.body && document.body.hasAttribute("data-ds-dark-theme")) return true;
      if (document.documentElement.hasAttribute("data-ds-dark-theme")) return true;
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (_) {
      return false;
    }
  }

  function injectStyles() {
    if (document.getElementById("dsh-boot-guard-styles")) return;
    var style = document.createElement("style");
    style.id = "dsh-boot-guard-styles";
    style.textContent = [
      ".bg-panel{--bg-surface:#fff;--bg-raised:#f6f7f9;--bg-hover:#eef1f4;--bg-border:#dce1e7;--bg-border-strong:#c8d0d9;--bg-text:#1e252d;--bg-muted:#68727e;--bg-faint:#8c96a1;--bg-accent:#d35c3f;--bg-accent-hover:#bd4e34;--bg-accent-ink:#fff;--bg-warn-bg:#fff5e8;--bg-warn-border:#f0c98f;--bg-warn-text:#8c4b16;box-sizing:border-box;width:min(720px,calc(100% - 32px));margin:24px auto 48px;padding:0;color:var(--dsw-alias-label-primary,var(--bg-text));background:var(--dsw-alias-bg-layer-1,var(--bg-surface));border:1px solid var(--dsw-alias-border-l1,var(--bg-border));border-radius:18px;box-shadow:0 18px 50px rgba(12,18,26,.10);font:13px/1.5 Inter,system-ui,-apple-system,'Segoe UI',sans-serif;text-align:left;overflow:hidden;isolation:isolate}",
      ".bg-panel.dark{--bg-surface:#1b1d20;--bg-raised:#23262a;--bg-hover:#2a2e33;--bg-border:#343940;--bg-border-strong:#484f58;--bg-text:#eef1f4;--bg-muted:#a5adb7;--bg-faint:#7d8792;--bg-accent:#e0785f;--bg-accent-hover:#eb876f;--bg-accent-ink:#17191c;--bg-warn-bg:#2b241d;--bg-warn-border:#6c4a28;--bg-warn-text:#f0bd81;box-shadow:0 22px 60px rgba(0,0,0,.32)}",
      ".bg-panel *{box-sizing:border-box}.bg-panel button,.bg-panel input{font:inherit}.bg-panel svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;display:block}",
      ".bg-head{display:flex;gap:14px;padding:20px 22px 17px;border-bottom:1px solid var(--dsw-alias-border-l1,var(--bg-border))}.bg-emblem{width:42px;height:42px;display:grid;place-items:center;flex:0 0 auto;color:var(--dsw-alias-brand-primary,var(--bg-accent));background:var(--dsw-alias-bg-layer-2,var(--bg-raised));border:1px solid var(--dsw-alias-border-l1,var(--bg-border));border-radius:12px}.bg-emblem svg{width:23px;height:23px}.bg-heading{min-width:0;flex:1}.bg-kicker{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.bg-live{display:inline-flex;align-items:center;gap:5px;letter-spacing:0;text-transform:none;font-weight:600}.bg-live:before{content:'';width:6px;height:6px;border-radius:50%;background:#2fa37a;box-shadow:0 0 0 3px rgba(47,163,122,.13)}.bg-live.readonly:before{background:#d28a3e;box-shadow:0 0 0 3px rgba(210,138,62,.15)}.bg-heading h2{font-size:18px;line-height:1.35;margin:3px 0 4px;font-weight:650;letter-spacing:-.01em}.bg-heading p{margin:0;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:12px}.bg-preview-badge{align-self:flex-start;color:var(--bg-warn-text);background:var(--bg-warn-bg);border:1px solid var(--bg-warn-border);border-radius:999px;padding:3px 8px;font-size:10px;font-weight:650;white-space:nowrap}",
      ".bg-diagnosis{display:flex;align-items:center;gap:11px;margin:16px 20px 0;padding:11px 12px;color:var(--bg-warn-text);background:var(--bg-warn-bg);border:1px solid var(--bg-warn-border);border-radius:11px}.bg-diagnosis[hidden]{display:none}.bg-diagnosis>.bg-icon{flex:0 0 auto}.bg-diagnosis-text{min-width:0;flex:1}.bg-diagnosis-text strong{display:block;font-size:12px}.bg-diagnosis-text span{display:block;margin-top:1px;font:11px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bg-diagnosis-note{flex:0 0 auto;font-size:10px;font-weight:650}",
      ".bg-controls{padding:16px 20px 10px}.bg-search-row{display:flex;gap:8px}.bg-search{height:40px;position:relative;display:flex;align-items:center;flex:1;min-width:0}.bg-search>svg{position:absolute;left:12px;width:16px;height:16px;color:var(--dsw-alias-label-secondary,var(--bg-muted));pointer-events:none}.bg-search input{width:100%;height:100%;padding:0 12px 0 38px;color:var(--dsw-alias-label-primary,var(--bg-text));background:var(--dsw-specific-input-major,var(--bg-raised));border:1px solid var(--dsw-alias-border-l2,var(--bg-border-strong));border-radius:10px;outline:none}.bg-search input::placeholder{color:var(--dsw-alias-label-tertiary,var(--bg-faint))}.bg-search input:focus{border-color:var(--dsw-alias-brand-primary,var(--bg-accent));box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,var(--bg-accent)) 15%,transparent)}",
      ".bg-icon-btn,.bg-btn,.bg-tab,.bg-text-btn,.bg-row-action{appearance:none;border:0;cursor:pointer;color:inherit;background:transparent}.bg-icon-btn{width:40px;height:40px;display:grid;place-items:center;flex:0 0 auto;border:1px solid var(--dsw-alias-border-l2,var(--bg-border-strong));border-radius:10px;background:var(--dsw-alias-bg-layer-1,var(--bg-surface))}.bg-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--bg-hover))}.bg-icon-btn[disabled]{cursor:wait;opacity:.55}.bg-icon-btn.busy svg{animation:bg-spin .8s linear infinite}",
      ".bg-tabs{display:flex;align-items:center;gap:3px;margin-top:11px;overflow-x:auto;scrollbar-width:none}.bg-tabs::-webkit-scrollbar{display:none}.bg-tab{min-height:32px;padding:5px 10px;border-radius:8px;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:11px;white-space:nowrap}.bg-tab:hover{background:var(--dsw-alias-interactive-bg-hover,var(--bg-hover))}.bg-tab[aria-selected='true']{color:var(--dsw-alias-label-primary,var(--bg-text));background:var(--dsw-alias-bg-layer-2,var(--bg-raised));font-weight:650}.bg-tab[hidden]{display:none}",
      ".bg-list-meta{min-height:30px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 20px;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:11px}.bg-meta-actions{display:flex;gap:10px}.bg-text-btn{padding:3px 0;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:11px}.bg-text-btn:hover{color:var(--dsw-alias-label-primary,var(--bg-text))}.bg-text-btn[disabled]{opacity:.4;cursor:not-allowed}",
      ".bg-list{max-height:288px;overflow:auto;padding:0 12px 8px;scrollbar-color:var(--dsw-alias-border-l2,var(--bg-border-strong)) transparent}.bg-item{min-height:54px;display:flex;align-items:center;gap:10px;padding:7px 9px;border:1px solid transparent;border-radius:10px}.bg-item+.bg-item{margin-top:3px}.bg-item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--bg-hover))}.bg-item.selected{border-color:var(--dsw-alias-brand-primary,var(--bg-accent));background:var(--dsw-alias-bg-layer-2,var(--bg-raised))}.bg-item.suspect:not(.selected){border-color:var(--bg-warn-border)}.bg-item-main{min-width:0;display:flex;align-items:center;gap:10px;flex:1;cursor:pointer}.bg-item-main.inert{cursor:default}.bg-check{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.bg-checkmark{width:19px;height:19px;display:grid;place-items:center;flex:0 0 auto;color:transparent;border:1.5px solid var(--dsw-alias-border-l2,var(--bg-border-strong));border-radius:6px;background:var(--dsw-alias-bg-layer-1,var(--bg-surface))}.bg-checkmark svg{width:14px;height:14px;stroke-width:2.4}.bg-check:checked+.bg-checkmark{color:var(--dsw-alias-brand-primary-invert,var(--bg-accent-ink));border-color:var(--dsw-alias-brand-primary,var(--bg-accent));background:var(--dsw-alias-brand-primary,var(--bg-accent))}.bg-check:focus-visible+.bg-checkmark{outline:2px solid var(--dsw-alias-brand-primary,var(--bg-accent));outline-offset:2px}.bg-check:disabled+.bg-checkmark{opacity:.38}.bg-plugin{min-width:0;flex:1}.bg-plugin strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}.bg-plugin code{display:block;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary,var(--bg-muted));font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace}.bg-badges{display:flex;align-items:center;gap:5px;flex:0 0 auto}.bg-badge{padding:2px 7px;border-radius:999px;color:var(--dsw-alias-label-secondary,var(--bg-muted));background:var(--dsw-alias-bg-layer-2,var(--bg-raised));font-size:9px;font-weight:650;white-space:nowrap}.bg-badge.warn{color:var(--bg-warn-text);background:var(--bg-warn-bg);border:1px solid var(--bg-warn-border)}.bg-row-action{min-height:30px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l2,var(--bg-border-strong));border-radius:8px;color:var(--dsw-alias-label-primary,var(--bg-text));font-size:10px}.bg-row-action:hover{background:var(--dsw-alias-bg-layer-2,var(--bg-raised))}.bg-empty{padding:34px 16px;text-align:center;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:12px}",
      ".bg-footer{display:flex;align-items:center;gap:14px;padding:14px 20px;border-top:1px solid var(--dsw-alias-border-l1,var(--bg-border));background:var(--dsw-alias-bg-layer-2,var(--bg-raised))}.bg-status{min-width:0;flex:1;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:11px}.bg-status[data-tone='error']{color:#d74f4f}.bg-status[data-tone='success']{color:#2f9a71}.bg-footer-actions{display:flex;gap:8px;flex:0 0 auto}.bg-btn{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:7px 12px;border:1px solid var(--dsw-alias-border-l2,var(--bg-border-strong));border-radius:9px;background:var(--dsw-alias-bg-layer-1,var(--bg-surface));font-size:11px;font-weight:600;white-space:nowrap}.bg-btn svg{width:15px;height:15px}.bg-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--bg-hover))}.bg-btn.primary{color:var(--dsw-alias-brand-primary-invert,var(--bg-accent-ink));border-color:var(--dsw-alias-brand-primary,var(--bg-accent));background:var(--dsw-alias-brand-primary,var(--bg-accent))}.bg-btn.primary:hover{background:var(--dsw-alias-button-primary-hover,var(--bg-accent-hover))}.bg-btn.restore-confirm{color:var(--bg-warn-text);border-color:var(--bg-warn-border);background:var(--bg-warn-bg)}.bg-btn[disabled]{opacity:.45;cursor:not-allowed}.bg-btn.loading{cursor:wait}.bg-btn.loading svg{animation:bg-spin .8s linear infinite}",
      ".bg-fallback{padding:22px}.bg-fallback h2{font-size:16px;margin:0 0 8px}.bg-fallback p{margin:0;color:var(--dsw-alias-label-secondary,var(--bg-muted));font-size:12px}.bg-fallback code{display:inline-block;margin-top:12px;padding:7px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-2,var(--bg-raised));font:11px ui-monospace,Consolas,monospace}",
      ".bg-panel button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,var(--bg-accent));outline-offset:2px}@keyframes bg-spin{to{transform:rotate(360deg)}}",
      "@media(max-width:640px){.bg-panel{width:calc(100% - 20px);margin:14px auto 28px;border-radius:14px}.bg-head{padding:17px 16px}.bg-controls{padding:14px 14px 9px}.bg-diagnosis{margin:14px 14px 0}.bg-list-meta{padding:0 14px}.bg-list{padding-left:7px;padding-right:7px}.bg-footer{align-items:stretch;flex-direction:column;padding:12px 14px}.bg-footer-actions{display:grid;grid-template-columns:1fr 1fr}.bg-btn{min-height:44px}.bg-btn.primary{grid-column:1/-1}.bg-badges .bg-badge:not(.warn){display:none}}",
      "@media(prefers-reduced-motion:reduce){.bg-panel *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}"
    ].join("");
    document.head.appendChild(style);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function uniqueEntries(entries) {
    var byId = {};
    (entries || []).forEach(function (entry) {
      if (!entry || !entry.id) return;
      var existing = byId[entry.id];
      if (!existing) {
        byId[entry.id] = Object.assign({ instances: 1 }, entry);
        return;
      }
      existing.instances = Math.max(existing.instances || 1, entry.instances || 1) + (entry.instances ? 0 : 1);
      existing.disabled = !!existing.disabled && !!entry.disabled;
      existing.protected = !!existing.protected || !!entry.protected;
      if (existing.name === "cordis:group" && entry.name !== "cordis:group") existing.name = entry.name;
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
  }

  function identifySuspects(entries, text) {
    var suspects = {};
    var hints = [];
    var matcher = /failed to import loader entry\s+([^\s(]+)(?:\s+\(([^)]+)\))?/ig;
    var match;
    while ((match = matcher.exec(text))) {
      hints.push(match[1]);
      if (match[2]) hints.push(match[2]);
    }
    var pluginUrl = /\/plugins\/([^/\s?]+)\//ig;
    while ((match = pluginUrl.exec(text))) hints.push(decodeURIComponent(match[1]));
    entries.forEach(function (entry) {
      var name = String(entry.name || "");
      var id = String(entry.id || "");
      if (hints.some(function (hint) { return hint === id || hint === name; })) suspects[id] = true;
      else if (name.length >= 9 && text.indexOf(name) !== -1) suspects[id] = true;
    });
    return suspects;
  }

  function isCustom(entry) {
    var name = String(entry.name || "");
    return !entry.protected && name.indexOf("@deepseek-ai/") !== 0 && name.indexOf("cordis:") !== 0;
  }

  function isGuardSkipped(entry) {
    return !!model.skipped[entry.id];
  }

  function isActionable(entry) {
    return model.writable && !entry.protected && !entry.disabled && !isGuardSkipped(entry);
  }

  function normalizeState(state, preserveSelection) {
    var previous = preserveSelection ? model.selected : {};
    model.version = state.version || model.version || "";
    model.locale = normalizeLocale(state.locale) || model.locale;
    model.entries = uniqueEntries(state.entries || []);
    model.writable = state.writable !== false;
    model.readOnlyReason = state.readOnlyReason || "";
    model.readOnlyReasonCode = state.readOnlyReasonCode || "";
    model.skipped = {};
    (state.skipped || []).forEach(function (id) { model.skipped[id] = true; });
    model.suspects = identifySuspects(model.entries, failureText);
    model.selected = {};
    model.entries.forEach(function (entry) {
      if (!isActionable(entry)) return;
      if (previous[entry.id] || (!preserveSelection && model.suspects[entry.id])) model.selected[entry.id] = true;
    });
    if (Object.keys(model.suspects).length) model.filter = "related";
    else if (model.filter === "related") model.filter = "custom";
  }

  function buildPanel(state) {
    injectStyles();
    normalizeState(state, false);
    var element = document.createElement("section");
    element.className = "bg-panel" + (detectDark() ? " dark" : "");
    element.setAttribute("aria-labelledby", "bg-rescue-title");
    element.setAttribute("lang", model.locale === "en" ? "en" : "zh-CN");
    element.innerHTML = [
      '<header class="bg-head">',
      '<div class="bg-emblem">' + icons.rescue + '</div>',
      '<div class="bg-heading"><div class="bg-kicker">BOOT GUARD <span class="bg-live' + (model.writable ? '' : ' readonly') + '">' + t(model.writable ? "serviceOnline" : "serviceReadOnly") + '</span></div>',
      '<h2 id="bg-rescue-title">' + t("title") + '</h2><p>' + t("subtitle") + '</p></div>',
      isPreview ? '<span class="bg-preview-badge">' + t("previewReadOnly") + '</span>' : (!model.writable ? '<span class="bg-preview-badge">' + t("readOnlyMode") + '</span>' : ''),
      '</header>',
      '<div class="bg-diagnosis" data-role="diagnosis" hidden>' + icons.warning + '<div class="bg-diagnosis-text"><strong>' + t("suspectHeading") + '</strong><span data-role="suspect-name"></span></div><span class="bg-diagnosis-note">' + t("autoSelected") + '</span></div>',
      '<div class="bg-controls"><div class="bg-search-row"><label class="bg-search">' + icons.search + '<input type="search" data-role="search" autocomplete="off" placeholder="' + t("search") + '" aria-label="' + t("search") + '"></label>',
      '<button class="bg-icon-btn" data-act="refresh-state" type="button" title="' + t("refreshState") + '" aria-label="' + t("refreshState") + '">' + icons.refresh + '</button></div>',
      '<div class="bg-tabs" role="tablist" aria-label="' + t("pluginScope") + '">',
      '<button class="bg-tab" data-filter="related" role="tab" type="button">' + t("related") + '</button>',
      '<button class="bg-tab" data-filter="custom" role="tab" type="button">' + t("custom") + '</button>',
      '<button class="bg-tab" data-filter="skipped" role="tab" type="button">' + t("skipped") + '</button>',
      '<button class="bg-tab" data-filter="all" role="tab" type="button">' + t("all") + '</button>',
      '</div></div>',
      '<div class="bg-list-meta"><span data-role="list-summary"></span><span class="bg-meta-actions"><button class="bg-text-btn" data-act="select-visible" type="button">' + t("selectVisible") + '</button><button class="bg-text-btn" data-act="clear" type="button">' + t("clearSelection") + '</button></span></div>',
      '<div class="bg-list" data-role="list" role="list"></div>',
      '<footer class="bg-footer"><div class="bg-status" data-role="status" role="status" aria-live="polite"></div><div class="bg-footer-actions">',
      '<button class="bg-btn" data-act="copy" type="button">' + icons.copy + '<span>' + t("copyDiagnostics") + '</span></button>',
      '<button class="bg-btn" data-act="restore-all" type="button"><span data-role="restore-label">' + t("restoreSkipped") + '</span></button>',
      '<button class="bg-btn primary" data-act="skip" type="button"><span data-role="skip-label">' + t("skipSelected") + '</span>' + icons.arrow + '</button>',
      '</div></footer>'
    ].join("");
    renderAll(element);
    return element;
  }

  function filteredEntries() {
    var query = model.query.trim().toLowerCase();
    return model.entries.filter(function (entry) {
      var matchesQuery = !query || String(entry.name || "").toLowerCase().indexOf(query) !== -1 || String(entry.id).toLowerCase().indexOf(query) !== -1;
      if (!matchesQuery) return false;
      if (query) return true;
      if (model.filter === "related") return !!model.suspects[entry.id];
      if (model.filter === "custom") return isCustom(entry);
      if (model.filter === "skipped") return isGuardSkipped(entry);
      return true;
    }).sort(function (a, b) {
      var suspectDelta = Number(!!model.suspects[b.id]) - Number(!!model.suspects[a.id]);
      if (suspectDelta) return suspectDelta;
      var customDelta = Number(isCustom(b)) - Number(isCustom(a));
      if (customDelta) return customDelta;
      return String(a.name || a.id).localeCompare(String(b.name || b.id), model.locale === "en" ? "en" : "zh-CN");
    });
  }

  function entryMarkup(entry) {
    var skipped = isGuardSkipped(entry);
    var protectedEntry = !!entry.protected;
    var configuredOff = !!entry.disabled && !skipped;
    var actionable = isActionable(entry);
    var selected = !!model.selected[entry.id];
    var badges = [];
    if (model.suspects[entry.id]) badges.push('<span class="bg-badge warn">' + t("related") + '</span>');
    if (skipped) badges.push('<span class="bg-badge">' + t("skipped") + '</span>');
    else if (configuredOff) badges.push('<span class="bg-badge">' + t("configuredOff") + '</span>');
    else if (protectedEntry) badges.push('<span class="bg-badge">' + t("rescueCore") + '</span>');
    if ((entry.instances || 1) > 1) badges.push('<span class="bg-badge">' + t("instances", { count: entry.instances }) + '</span>');
    var control = '<input class="bg-check" type="checkbox" data-id="' + esc(entry.id) + '"' + (selected ? " checked" : "") + (actionable ? "" : " disabled") + ' aria-label="' + esc(t("selectPlugin", { name: entry.name || entry.id })) + '"><span class="bg-checkmark">' + icons.check + '</span>';
    var restore = skipped ? '<button class="bg-row-action" data-act="restore-one" data-id="' + esc(entry.id) + '" type="button">' + t("restore") + '</button>' : '';
    return '<div class="bg-item' + (selected ? " selected" : "") + (model.suspects[entry.id] ? " suspect" : "") + '" role="listitem"><label class="bg-item-main' + (actionable ? "" : " inert") + '">' + control + '<span class="bg-plugin"><strong title="' + esc(entry.name || entry.id) + '">' + esc(entry.name || entry.id) + '</strong><code title="' + esc(entry.id) + '">' + esc(entry.id) + '</code></span></label><span class="bg-badges">' + badges.join("") + '</span>' + restore + '</div>';
  }

  function renderAll(element) {
    var suspectEntries = model.entries.filter(function (entry) { return model.suspects[entry.id]; });
    var diagnosis = element.querySelector('[data-role="diagnosis"]');
    diagnosis.hidden = !suspectEntries.length;
    if (suspectEntries.length) {
      element.querySelector('[data-role="suspect-name"]').textContent = suspectEntries.map(function (entry) { return entry.name || entry.id; }).join(" · ");
    }

    var relatedTab = element.querySelector('[data-filter="related"]');
    relatedTab.hidden = !suspectEntries.length;
    element.querySelectorAll(".bg-tab").forEach(function (tab) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-filter") === model.filter ? "true" : "false");
    });

    var visible = filteredEntries();
    var list = element.querySelector('[data-role="list"]');
    list.innerHTML = visible.length ? visible.map(entryMarkup).join("") : '<div class="bg-empty">' + t("empty") + '</div>';
    var actionableVisible = visible.filter(isActionable).length;
    element.querySelector('[data-role="list-summary"]').textContent = t("listSummary", { visible: visible.length, actionable: actionableVisible });
    element.querySelector('[data-act="select-visible"]').disabled = actionableVisible === 0 || model.busy;
    updateActions(element);
  }

  function updateActions(element) {
    var selectedCount = Object.keys(model.selected).filter(function (id) { return model.selected[id]; }).length;
    var skippedCount = Object.keys(model.skipped).length;
    var skipButton = element.querySelector('[data-act="skip"]');
    var restoreButton = element.querySelector('[data-act="restore-all"]');
    element.querySelector('[data-role="skip-label"]').textContent = selectedCount ? t("skipSelectedCount", { count: selectedCount }) : t("skipSelected");
    element.querySelector('[data-role="restore-label"]').textContent = model.confirmRestore ? t("restoreConfirmCount", { count: skippedCount }) : t("restoreSkippedCount", { count: skippedCount });
    skipButton.disabled = selectedCount === 0 || model.busy || !model.writable;
    restoreButton.disabled = skippedCount === 0 || model.busy || !model.writable;
    restoreButton.classList.toggle("restore-confirm", model.confirmRestore);
    element.querySelector('[data-act="clear"]').disabled = selectedCount === 0 || model.busy;
    if (!model.busy) {
      if (!model.writable) {
        setStatus(localizedReadOnlyReason(), "error", element);
      } else {
        var defaultMessage = selectedCount ? t(selectedCount === 1 ? "statusSelectedOne" : "statusSelected", { count: selectedCount }) : (skippedCount ? t(skippedCount === 1 ? "statusSkippedOne" : "statusSkipped", { count: skippedCount }) : t("statusIdle"));
        setStatus(defaultMessage, "", element);
      }
    }
  }

  function setStatus(message, tone, element) {
    var status = (element || panel).querySelector('[data-role="status"]');
    status.textContent = message;
    status.setAttribute("data-tone", tone || "");
  }

  function setBusy(busy, action, element) {
    model.busy = busy;
    element.querySelectorAll("button").forEach(function (button) { button.disabled = busy; });
    var active = element.querySelector('[data-act="' + action + '"]');
    if (active) active.classList.toggle("loading", busy);
    if (!busy) renderAll(element);
  }

  function post(path, body, pendingMessage, successMessage, action) {
    if (isPreview) {
      setStatus(t("previewNoMutation"), "success", panel);
      return;
    }
    setBusy(true, action, panel);
    setStatus(pendingMessage, "", panel);
    api(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }).then(function () {
      setStatus(t("refreshing", { message: successMessage }), "success", panel);
      window.setTimeout(function () { location.reload(); }, 350);
    }).catch(function (error) {
      setBusy(false, action, panel);
      setStatus(t("operationFailed", { message: error.message }), "error", panel);
    });
  }

  function resetRestoreConfirmation() {
    model.confirmRestore = false;
    if (restoreConfirmTimer) window.clearTimeout(restoreConfirmTimer);
    restoreConfirmTimer = null;
    if (panel) updateActions(panel);
  }

  function copyDiagnostics() {
    var suspectNames = model.entries.filter(function (entry) { return model.suspects[entry.id]; }).map(function (entry) { return entry.name + " [" + entry.id + "]"; });
    var report = [
      t("diagnosticsTitle"),
      t("reportVersion") + ": " + (model.version || "unknown"),
      t("reportTime") + ": " + new Date().toISOString(),
      t("reportWritable") + ": " + t(model.writable ? "yes" : "no"),
      t("reportReadOnlyReason") + ": " + (model.writable ? t("none") : localizedReadOnlyReason()),
      t("reportSuspected") + ": " + (suspectNames.join(", ") || t("notDetected")),
      t("reportSkipped") + ": " + (Object.keys(model.skipped).join(", ") || t("none")),
      t("reportFailure") + ": " + failureText
    ].join("\n");
    function done() { setStatus(t("diagnosticsCopied"), "success", panel); }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = report;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); done(); } catch (_) { setStatus(t("clipboardFailed"), "error", panel); }
      area.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(report).then(done, fallback);
    else fallback();
  }

  function refreshState() {
    var button = panel.querySelector('[data-act="refresh-state"]');
    button.classList.add("busy");
    button.disabled = true;
    setStatus(t("detecting"), "", panel);
    api("/state").then(function (state) {
      normalizeState(state, true);
      renderAll(panel);
      if (model.writable) setStatus(t("stateUpdated"), "success", panel);
      else setStatus(localizedReadOnlyReason(), "error", panel);
    }).catch(function (error) {
      setStatus(t("refreshFailed", { message: error.message }), "error", panel);
    }).finally(function () {
      button.classList.remove("busy");
      button.disabled = false;
    });
  }

  function wireEvents(element) {
    element.addEventListener("input", function (event) {
      var target = event.target;
      if (target.matches('[data-role="search"]')) {
        model.query = target.value;
        renderAll(element);
        target = element.querySelector('[data-role="search"]');
        target.focus();
        target.setSelectionRange(target.value.length, target.value.length);
      } else if (target.matches(".bg-check")) {
        var id = target.getAttribute("data-id");
        if (target.checked) {
          if (Object.keys(model.selected).length >= MAX_SELECTION) {
            target.checked = false;
            setStatus(t("maxSelection", { count: MAX_SELECTION }), "error", element);
            return;
          }
          model.selected[id] = true;
        } else delete model.selected[id];
        renderAll(element);
      }
    });

    element.addEventListener("click", function (event) {
      var button = event.target.closest("button");
      if (!button || button.disabled) return;
      var filter = button.getAttribute("data-filter");
      if (filter) {
        model.filter = filter;
        model.query = "";
        element.querySelector('[data-role="search"]').value = "";
        renderAll(element);
        return;
      }
      var action = button.getAttribute("data-act");
      if (action === "select-visible") {
        var before = Object.keys(model.selected).length;
        var room = Math.max(0, MAX_SELECTION - before);
        var candidates = filteredEntries().filter(isActionable).filter(function (entry) { return !model.selected[entry.id]; });
        candidates.slice(0, room).forEach(function (entry) { model.selected[entry.id] = true; });
        renderAll(element);
        if (candidates.length > room) setStatus(t("selectedFirst", { max: MAX_SELECTION, count: room }), "", element);
      } else if (action === "clear") {
        model.selected = {};
        renderAll(element);
      } else if (action === "refresh-state") {
        refreshState();
      } else if (action === "copy") {
        copyDiagnostics();
      } else if (action === "skip") {
        var ids = Object.keys(model.selected).filter(function (id) { return model.selected[id]; });
        post("/skip", { ids: ids }, t("writeSkipPending"), t(ids.length === 1 ? "skippedSuccessOne" : "skippedSuccess", { count: ids.length }), "skip");
      } else if (action === "restore-one") {
        var restoreId = button.getAttribute("data-id");
        post("/restore", { ids: [restoreId] }, t("restorePending"), t("restoredSuccess"), "restore-one");
      } else if (action === "restore-all") {
        if (!model.confirmRestore) {
          model.confirmRestore = true;
          updateActions(element);
          setStatus(t("confirmRestore"), "", element);
          restoreConfirmTimer = window.setTimeout(resetRestoreConfirmation, 5000);
        } else {
          resetRestoreConfirmation();
          post("/restore", {}, t("restoreAllPending"), t("restoreAllSuccess"), "restore-all");
        }
      }
    });
  }

  function buildFallback(message) {
    injectStyles();
    var element = document.createElement("section");
    element.className = "bg-panel" + (detectDark() ? " dark" : "");
    element.setAttribute("lang", model.locale === "en" ? "en" : "zh-CN");
    element.innerHTML = '<div class="bg-fallback"><h2>' + t("fallbackTitle") + '</h2><p>' + esc(t("fallbackBody", { message: message })) + '</p></div>';
    return element;
  }

  function stopWatching() {
    if (observer) observer.disconnect();
    observer = null;
    if (observerStopTimer) window.clearTimeout(observerStopTimer);
    observerStopTimer = null;
    if (mountDebounceTimer) window.clearTimeout(mountDebounceTimer);
    mountDebounceTimer = null;
  }

  function scheduleMount() {
    if (INSERTED || mountDebounceTimer) return;
    mountDebounceTimer = window.setTimeout(function () {
      mountDebounceTimer = null;
      mount();
    }, 100);
  }

  function startWatching() {
    mount();
    if (INSERTED || observer || typeof MutationObserver === "undefined") return;
    var target = document.documentElement || document.body;
    if (!target) return;
    observer = new MutationObserver(scheduleMount);
    observer.observe(target, { childList: true, characterData: true, subtree: true });
    observerStopTimer = window.setTimeout(stopWatching, 30000);
  }

  function mount() {
    if (INSERTED) return;
    var root = findFailureRoot();
    if (!root) return;
    INSERTED = true;
    isPreview = !!(document.body && document.body.hasAttribute("data-boot-guard-preview"));
    stopWatching();
    api("/state").then(function (state) {
      panel = buildPanel(state);
      root.appendChild(panel);
      wireEvents(panel);
      if (isPreview) setStatus(t("previewStatus"), "", panel);
    }).catch(function (error) {
      panel = buildFallback(error.message);
      root.appendChild(panel);
    });
  }

  if (document.readyState !== "loading") startWatching();
  else document.addEventListener("DOMContentLoaded", startWatching, { once: true });
})();
