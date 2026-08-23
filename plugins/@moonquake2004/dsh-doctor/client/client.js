window.__ModuleLoader__.load({ id: "@moonquake2004/dsh-doctor", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
'use strict'

/**
 * dsh-doctor client: registers a "诊断 / Doctor" settings section that runs
 * the offline checks via /dsh-doctor/run and renders the results.
 * Hand-authored CJS bundle (no build step); the only external is the loader
 * module table's `react`.
 */

const React = require('react')
const h = React.createElement
const { useState, useEffect, useCallback } = React

const NS = 'dsh-doctor'
const zh = {
  nav: '诊断',
  run: '运行诊断',
  running: '诊断中…',
  ok: '全部通过',
  bad: '发现 {n} 个问题',
  sectionEnv: '环境',
  sectionProfile: 'Profile',
  sectionSession: '会话',
  sectionSecurity: '🔒 安全',
  fix: '修复',
  quarantineHint: '隔离建议（手动执行，勿自动）',
  error: '诊断失败：{msg}',
  loading: '加载中…',
}
const en = {
  nav: 'Doctor',
  run: 'Run checks',
  running: 'Running…',
  ok: 'All checks passed',
  bad: '{n} problem(s) found',
  sectionEnv: 'Environment',
  sectionProfile: 'Profile',
  sectionSession: 'Session',
  sectionSecurity: '🔒 Security',
  fix: 'Fix',
  quarantineHint: 'Quarantine suggestion (run manually, never auto)',
  error: 'Doctor failed: {msg}',
  loading: 'Loading…',
}

function injectStyles() {
  if (document.getElementById('dsh-doctor-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-doctor-style'
  style.textContent = `
.dshd-wrap { font-size: 13px; line-height: 1.6; max-width: 760px; }
.dshd-sum { padding: 10px 14px; border-radius: 8px; margin: 8px 0; font-weight: 600; }
.dshd-sum.ok { background: rgba(61,220,151,.12); color: #2fb47e; }
.dshd-sum.bad { background: rgba(255,93,93,.12); color: #e05656; }
.dshd-sec { margin-top: 12px; font-weight: 700; opacity: .85; }
.dshd-row { padding: 6px 10px; border-radius: 6px; margin: 4px 0; background: rgba(128,128,128,.07); }
.dshd-row .mark { font-weight: 700; margin-right: 6px; }
.dshd-row.ok .mark { color: #2fb47e; }
.dshd-row.bad .mark { color: #e05656; }
.dshd-row .det { word-break: break-all; }
.dshd-row .fix { color: #ff9d5d; margin-top: 2px; font-size: 12px; word-break: break-all; }
.dshd-btn { padding: 6px 14px; border-radius: 6px; border: 1px solid currentColor; background: transparent; cursor: pointer; }
.dshd-btn:disabled { opacity: .5; cursor: wait; }
`
  document.head.appendChild(style)
}

function DoctorSection(props) {
  const t = props.t
  const localeSnap = React.useSyncExternalStore(
    (cb) => props.locale.subscribe(cb),
    () => props.locale.getSnapshot(),
  )
  const lang = String(localeSnap.active).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const L = lang === 'zh' ? zh : en
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [running, setRunning] = useState(false)
  const run = useCallback(async () => {
    setRunning(true); setError(null)
    try {
      const res = await fetch('/dsh-doctor/run', { cache: 'no-store' })
      const json = await res.json()
      setData(json)
    } catch (e) { setError(String(e.message || e)) }
    finally { setRunning(false) }
  }, [])
  useEffect(() => { injectStyles(); run() }, [run])
  const sectionName = (s) => ({ env: L.sectionEnv, profile: L.sectionProfile, session: L.sectionSession, security: L.sectionSecurity }[s] || s)
  return h('div', { className: 'dshd-wrap' },
    h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center' } },
      h('button', { className: 'dshd-btn', onClick: run, disabled: running }, running ? L.running : L.run)),
    error ? h('div', { className: 'dshd-sum bad' }, L.error.replace('{msg}', error))
      : data ? h('div', null,
          h('div', { className: 'dshd-sum ' + (data.ok ? 'ok' : 'bad') },
            data.ok ? L.ok : L.bad.replace('{n}', String((data.checks || []).filter((c) => !c.ok).length))),
          (data.checks || []).reduce((acc, c) => {
            const prev = acc[acc.length - 1]
            if (!prev || prev.section !== c.section) acc.push({ section: c.section, rows: [c] })
            else prev.rows.push(c)
            return acc
          }, []).map((group) =>
            h('div', { key: group.section },
              h('div', { className: 'dshd-sec' }, sectionName(group.section)),
              group.rows.map((c) =>
                h('div', { key: c.id, className: 'dshd-row ' + (c.ok ? 'ok' : 'bad') },
                  h('span', { className: 'mark' }, c.ok ? '✓' : '✗'),
                  h('span', null, `[${c.id}] `),
                  h('span', { className: 'det' }, c.detail),
                  !c.ok && c.fix ? h('div', { className: 'fix' }, `↳ ${L.fix}: ${c.fix}`) : null)))))
      : h('div', null, L.loading))
}

exports.name = 'dsh-doctor'
exports.inject = ['slots', 'locale']
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-doctor: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-doctor',
    order: 50,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ t }),
  }, () => h(DoctorSection, { t, locale: ctx.locale })))
}

return module.exports; } });
