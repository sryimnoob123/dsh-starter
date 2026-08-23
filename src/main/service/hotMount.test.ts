import { describe, expect, it } from 'vitest';
import { scanHotMountLine } from './hotMount.js';

describe('scanHotMountLine（stderr 热路径扩展，缺口 2）', () => {
  it('原有形态：hot mount of <pkg> failed → 归因包名', () => {
    const hit = scanHotMountLine('[dsh-market] hot mount of dsh-usage-stats failed, restart required: boom');
    expect(hit).toEqual({ packageName: 'dsh-usage-stats' });
  });

  it('原有形态：scoped 包名', () => {
    const hit = scanHotMountLine('[dsh-market] hot mount of @dsh-desktop/plugin-global-prompt failed, restart required');
    expect(hit).toEqual({ packageName: '@dsh-desktop/plugin-global-prompt' });
  });

  it('缺口2形态：client-modules loaded without registering "<id>"（id 是包名）', () => {
    const hit = scanHotMountLine(
      'Error: client-modules: bundle https://127.0.0.1:3081/bundle/deepseek-harness-zh_pro.js loaded without registering "deepseek-harness-zh_pro" via __ModuleLoader__.load',
    );
    expect(hit).toEqual({ packageName: 'deepseek-harness-zh_pro' });
  });

  it('缺口2形态：id 带 /client 后缀 → 剥离后仍命中', () => {
    const hit = scanHotMountLine(
      'Error: client-modules: bundle https://x/foo.js loaded without registering "@dsh-desktop/plugin-global-prompt/client" via __ModuleLoader__.load',
    );
    expect(hit).toEqual({ packageName: '@dsh-desktop/plugin-global-prompt' });
  });

  it('缺口2形态：非包名模块 id → 不归因包名（返回 null，防误隔离）', () => {
    const hit = scanHotMountLine(
      'Error: client-modules: bundle https://x/runtime.js loaded without registering "runtime/cordis" via __ModuleLoader__.load',
    );
    expect(hit).toBeNull();
  });

  it('非热路径行 → null', () => {
    expect(scanHotMountLine('Error: listen EADDRINUSE')).toBeNull();
    expect(scanHotMountLine('')).toBeNull();
  });

  it('loader entry 热路径形态（缺口2补充：failed to apply/import loader entry）', () => {
    const hit = scanHotMountLine(
      'hot mount of dsh-usage-stats failed, restart required: failed to apply loader entry mkt-usage-stats (dsh-usage-stats): webserver: duplicate exact route',
    );
    expect(hit).toEqual({ packageName: 'dsh-usage-stats' });
  });
});

describe('版本后缀与边界（回归）', () => {
  it('loader entry 带 @version 尾巴 → 剥离后归因', () => {
    const hit = scanHotMountLine(
      'hot mount of dsh-mobile failed, restart required: failed to apply loader entry mobile-access (dsh-mobile@0.1.0-rc.5): unsupported version',
    );
    expect(hit).toEqual({ packageName: 'dsh-mobile' });
  });

  it('scoped 包带版本尾巴不误剥（@scope/name@x.y.z）', () => {
    const hit = scanHotMountLine(
      'failed to import loader entry x (@dsh-desktop/plugin-global-prompt@1.2.3): boom',
    );
    expect(hit).toEqual({ packageName: '@dsh-desktop/plugin-global-prompt' });
  });
});

describe('对抗审查回归（C2 嵌套/I2 版本尾巴/M1 文件名）', () => {
  it('嵌套 loader：外层 cordis:include 冒号模块，内层才是权威包名（审查 C2）', () => {
    const hit = scanHotMountLine(
      'failed to apply loader entry include (cordis:include): failed to import loader entry desktop-background (@dsh-desktop/plugin-background): Cannot find package',
    );
    expect(hit).toEqual({ packageName: '@dsh-desktop/plugin-background' });
  });

  it('hot mount 带版本尾巴 → 剥离后归因（审查 I2 形态1）', () => {
    const hit = scanHotMountLine('hot mount of dsh-usage-stats@0.2.10 failed, restart required');
    expect(hit).toEqual({ packageName: 'dsh-usage-stats' });
  });

  it('client-modules 未注册带版本尾巴 → 剥离后归因（审查 I2 形态2）', () => {
    const hit = scanHotMountLine(
      'Error: client-modules: bundle https://x.js loaded without registering "deepseek-harness-zh_pro@0.7.0" via __ModuleLoader__.load',
    );
    expect(hit).toEqual({ packageName: 'deepseek-harness-zh_pro' });
  });

  it('loader 入口是文件名 → 不归因（审查 M1）', () => {
    const hit = scanHotMountLine('failed to apply loader entry loader (foo.js): boom');
    expect(hit).toBeNull();
  });
});
