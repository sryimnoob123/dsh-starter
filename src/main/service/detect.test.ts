import { describe, expect, it } from 'vitest';
import { classifyProbe, isDshHomePage, parseReadyUrlLine } from './detect.js';

describe('parseReadyUrlLine', () => {
  it('parses the official readiness URL line (架构文档 §4.2)', () => {
    const line = 'dsh web: http://127.0.0.1:3080';
    expect(parseReadyUrlLine(line)).toEqual({ url: 'http://127.0.0.1:3080', port: 3080 });
  });

  it('parses a non-default port', () => {
    expect(parseReadyUrlLine('dsh web: http://127.0.0.1:4210')).toEqual({
      url: 'http://127.0.0.1:4210',
      port: 4210,
    });
  });

  it('ignores unrelated log lines', () => {
    expect(parseReadyUrlLine('some log output')).toBeNull();
    expect(parseReadyUrlLine('http://127.0.0.1:3080')).toBeNull();
  });

  it('rejects malformed URLs without throwing', () => {
    expect(parseReadyUrlLine('dsh web: http://[invalid')).toBeNull();
  });
});

describe('isDshHomePage', () => {
  it('detects the DSH SPA boot marker (window.__DSH_BOOT__)', () => {
    expect(isDshHomePage('<html><script>window.__DSH_BOOT__ = {}</script></html>')).toBe(true);
  });

  it('rejects other services serving on the port', () => {
    expect(isDshHomePage('<html><title>Some Other App</title></html>')).toBe(false);
  });
});

describe('classifyProbe', () => {
  it('classifies dsh by home page marker', () => {
    expect(
      classifyProbe({ status: 'ok', html: '<html>window.__DSH_BOOT__</html>' }),
    ).toBe('dsh');
  });

  it('classifies a foreign HTTP service as occupied', () => {
    expect(classifyProbe({ status: 'ok', html: '<html>nginx</html>' })).toBe('occupied');
  });

  it('classifies connection-refused as free', () => {
    expect(classifyProbe({ status: 'refused' })).toBe('free');
  });

  it('treats unknown errors as occupied (never steal a port we cannot see)', () => {
    expect(classifyProbe({ status: 'error' })).toBe('occupied');
  });
});
