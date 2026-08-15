import { describe, expect, it } from 'vitest';
import { buildNpmInstallArgs, dshBinPath, dshEntryJsPath, DSH_NPM_REGISTRY, DSH_PACKAGE, findGlobalDsh, npmCommand, parseNpmFetchLine } from './dshPackage.js';

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

describe('parseNpmFetchLine（解析 npm --loglevel=http 的真实下载行 → 进度来源）', () => {
  it('tarball 下载行 → 包名 + tarball=true', () => {
    expect(parseNpmFetchLine('npm http fetch GET 200 https://registry.npmjs.org/lodash/-/lodash-4.18.1.tgz 1160ms (cache miss)')).toEqual({
      name: 'lodash',
      tarball: true,
    });
  });

  it('元数据（manifest）请求 → tarball=false', () => {
    expect(parseNpmFetchLine('npm http fetch GET 200 https://registry.npmjs.org/lodash 1437ms (cache miss)')).toEqual({
      name: 'lodash',
      tarball: false,
    });
  });

  it('scoped 包（%2f 编码）→ 解码为 @scope/name', () => {
    expect(parseNpmFetchLine('npm http fetch GET 200 https://registry.npmjs.org/@deepseek-ai%2fdsh/-/dsh-0.1.0-rc.6.tgz 853ms (cache miss)')).toEqual({
      name: '@deepseek-ai/dsh',
      tarball: true,
    });
  });

  it('命中缓存（cache hit）→ 不算下载，返回 null', () => {
    expect(parseNpmFetchLine('npm http cache lodash@https://registry.npmjs.org/lodash/-/lodash-4.18.1.tgz 0ms (cache hit)')).toBeNull();
  });

  it('304 未变化 / 非下载行 → null', () => {
    expect(parseNpmFetchLine('npm http fetch GET 304 https://registry.npmjs.org/lodash 12ms')).toBeNull();
    expect(parseNpmFetchLine('added 528 packages in 45s')).toBeNull();
    expect(parseNpmFetchLine('')).toBeNull();
  });
});
