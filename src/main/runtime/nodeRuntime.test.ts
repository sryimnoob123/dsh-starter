import { describe, expect, it } from 'vitest';
import {
  buildNodeDownloadUrl,
  localNodeExe,
  localNpmCli,
  localNpmCmd,
  nodeDistFileName,
  nodeDistName,
  nodeRuntimeDir,
} from './nodeRuntime.js';

describe('nodeDistName / nodeDistFileName', () => {
  it('win64 → node-v22.21.0-win-x64(.zip)', () => {
    expect(nodeDistName({ version: 'v22.21.0', platform: 'win32', arch: 'x64' })).toBe(
      'node-v22.21.0-win-x64',
    );
    expect(nodeDistFileName({ version: 'v22.21.0', platform: 'win32', arch: 'x64' })).toBe(
      'node-v22.21.0-win-x64.zip',
    );
  });

  it('darwin arm64 → tar.gz', () => {
    expect(nodeDistFileName({ version: 'v22.21.0', platform: 'darwin', arch: 'arm64' })).toBe(
      'node-v22.21.0-darwin-arm64.tar.gz',
    );
  });

  it('linux x64 → tar.gz', () => {
    expect(nodeDistFileName({ version: 'v22.21.0', platform: 'linux', arch: 'x64' })).toBe(
      'node-v22.21.0-linux-x64.tar.gz',
    );
  });
});

describe('buildNodeDownloadUrl', () => {
  it('默认走 npmmirror 镜像', () => {
    expect(buildNodeDownloadUrl({ version: 'v22.21.0', platform: 'win32', arch: 'x64' })).toBe(
      'https://npmmirror.com/mirrors/node/v22.21.0/node-v22.21.0-win-x64.zip',
    );
  });

  it('官方镜像 + 去掉尾部斜杠', () => {
    expect(
      buildNodeDownloadUrl({
        version: 'v22.21.0',
        platform: 'win32',
        arch: 'x64',
        mirror: 'https://nodejs.org/dist/',
      }),
    ).toBe('https://nodejs.org/dist/v22.21.0/node-v22.21.0-win-x64.zip');
  });
});

describe('本地路径', () => {
  it('nodeRuntimeDir → <userData>/runtime/node', () => {
    expect(nodeRuntimeDir('C:\\Users\\me\\AppData\\Roaming\\dsh-desktop')).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\dsh-desktop\\runtime\\node',
    );
  });

  it('win32 → node.exe / npm.cmd（同目录）', () => {
    expect(localNodeExe('C:\\x\\node', 'win32')).toBe('C:\\x\\node\\node.exe');
    expect(localNpmCmd('C:\\x\\node', 'win32')).toBe('C:\\x\\node\\npm.cmd');
  });

  it('非 win32 → bin/node / bin/npm', () => {
    expect(localNodeExe('/x/node', 'linux')).toBe('/x/node/bin/node');
    expect(localNpmCmd('/x/node', 'linux')).toBe('/x/node/bin/npm');
  });

  it('localNpmCli → node_modules/npm/bin/npm-cli.js（node 直跑，中文路径安全）', () => {
    expect(localNpmCli('C:\\x\\node')).toBe('C:\\x\\node\\node_modules\\npm\\bin\\npm-cli.js');
  });
});
