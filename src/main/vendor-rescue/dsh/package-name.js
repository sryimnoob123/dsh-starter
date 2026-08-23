/**
 * 合法 npm 包名校验（DSH 配方层共享）。
 * 崩溃 stderr 是外部可控输入：提取出的"包名"必须先过此关才能进入任何
 * 文件系统操作，防止伪造 `../../../../victim` 之类的路径穿越直达 rmSync。
 */
const NPM_PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
export function isValidNpmPackageName(name) {
    return NPM_PACKAGE_NAME.test(name);
}
