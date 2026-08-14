import { describe, expect, it } from 'vitest';
import { buildNpmInstallArgs, defaultInstallDir, dshBinPath, dshEntryJsPath, DSH_NPM_REGISTRY, DSH_PACKAGE, npmCommand } from './dshPackage.js';

describe('buildNpmInstallArgs', () => {
  it('锁定 npm install --prefix <目录> --registry <镜像> <包名> 顺序', () => {
    expect(buildNpmInstallArgs('C:\\Apps\\dsh-desktop')).toEqual([
      'install',
      '--prefix',
      'C:\\Apps\\dsh-desktop',
      '--registry',
      DSH_NPM_REGISTRY,
      DSH_PACKAGE,
    ]);
  });

  it('包名锁定为官方 npm 包 @deepseek-ai/dsh', () => {
    expect(DSH_PACKAGE).toBe('@deepseek-ai/dsh');
  });
});

describe('dshBinPath', () => {
  it('win32 → node_modules\\.bin\\dsh.cmd', () => {
    expect(dshBinPath('C:\\Apps\\dsh-desktop', 'win32')).toBe(
      'C:\\Apps\\dsh-desktop\\node_modules\\.bin\\dsh.cmd',
    );
  });

  it('非 win32 → node_modules/.bin/dsh', () => {
    expect(dshBinPath('/opt/dsh-desktop', 'linux')).toBe('/opt/dsh-desktop/node_modules/.bin/dsh');
  });
});

describe('dshEntryJsPath（自备 Node 直跑 CLI 入口）', () => {
  it('win32 → node_modules/@deepseek-ai/dsh/lib/bin.js', () => {
    expect(dshEntryJsPath('C:\\Apps\\dsh-desktop', 'win32')).toBe(
      'C:\\Apps\\dsh-desktop\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js',
    );
  });

  it('非 win32 → POSIX 拼接', () => {
    expect(dshEntryJsPath('/opt/dsh-desktop', 'linux')).toBe(
      '/opt/dsh-desktop/node_modules/@deepseek-ai/dsh/lib/bin.js',
    );
  });
});

describe('npmCommand', () => {
  it('win32 → npm.cmd', () => {
    expect(npmCommand('win32')).toBe('npm.cmd');
  });

  it('非 win32 → npm', () => {
    expect(npmCommand('linux')).toBe('npm');
  });
});

describe('defaultInstallDir（安装向导默认目录，交付页文案"用默认目录就好"的落地）', () => {
  it('win32 + LOCALAPPDATA → %LOCALAPPDATA%\\deepseekharness\\dsh', () => {
    expect(
      defaultInstallDir('win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, '/fallback'),
    ).toBe('C:\\Users\\me\\AppData\\Local\\deepseekharness\\dsh');
  });

  it('win32 缺 LOCALAPPDATA → fallback 下 dsh', () => {
    expect(defaultInstallDir('win32', {}, 'C:\\Users\\me')).toBe('C:\\Users\\me\\dsh');
  });

  it('非 win32 → ~/.dsh-desktop/dsh（POSIX 拼接）', () => {
    expect(defaultInstallDir('linux', {}, '/home/me')).toBe('/home/me/.dsh-desktop/dsh');
  });
});
