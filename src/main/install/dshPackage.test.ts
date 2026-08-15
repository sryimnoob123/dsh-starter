import { describe, expect, it } from 'vitest';
import { buildNpmInstallArgs, dshBinPath, dshEntryJsPath, DSH_NPM_REGISTRY, DSH_PACKAGE, findGlobalDsh, npmCommand } from './dshPackage.js';

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

describe('findGlobalDsh（检测 PATH 里的全局 dsh 命令，managed 模式优先复用本机已装）', () => {
  it('win32：PATH 里任一目录有 dsh.cmd → true', () => {
    const exists = (p: string) => p === 'C:\\tools\\node\\dsh.cmd';
    expect(findGlobalDsh('win32', 'C:\\a;C:\\tools\\node;C:\\b', exists)).toBe(true);
  });

  it('win32：PATH 里只有目录没有 dsh.cmd → false', () => {
    const exists = () => false;
    expect(findGlobalDsh('win32', 'C:\\a;C:\\b', exists)).toBe(false);
  });

  it('非 win32：PATH 里任一目录有 dsh（无后缀）→ true', () => {
    const exists = (p: string) => p === '/usr/local/bin/dsh';
    expect(findGlobalDsh('linux', '/bin:/usr/local/bin:/usr/bin', exists)).toBe(true);
  });

  it('空 PATH / 空目录 → false，不抛错', () => {
    expect(findGlobalDsh('win32', '', () => false)).toBe(false);
    expect(findGlobalDsh('linux', '::', () => false)).toBe(false);
  });
});
