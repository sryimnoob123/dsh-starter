/**
 * DSH 服务探测（架构文档 §4.2，调研 A/B）：
 * - 就绪信号 = 子进程 stdout 的 URL 行 `dsh web: http://127.0.0.1:<port>`
 * - 端口复用判别 = GET / 首页 HTML 含 DSH 特有注入标记 `window.__DSH_BOOT__`
 * - 壳侧探测结果三类：dsh（复用）/ free（可拉起）/ occupied（询问换端口）
 */

export interface ReadyUrl {
  url: string;
  port: number;
}

const READY_URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/i;

export function parseReadyUrlLine(line: string): ReadyUrl | null {
  const match = READY_URL_PATTERN.exec(line);
  if (!match) return null;
  try {
    const u = new URL(match[1]);
    const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    return { url: match[1], port };
  } catch {
    return null;
  }
}

export function isDshHomePage(html: string): boolean {
  return html.includes('__DSH_BOOT__');
}

export type ProbeResult =
  | { status: 'ok'; html: string }
  | { status: 'refused' }
  | { status: 'error' };

export type PortProbe = 'dsh' | 'occupied' | 'free';

export function classifyProbe(result: ProbeResult): PortProbe {
  if (result.status === 'ok') {
    return isDshHomePage(result.html) ? 'dsh' : 'occupied';
  }
  return result.status === 'refused' ? 'free' : 'occupied';
}
