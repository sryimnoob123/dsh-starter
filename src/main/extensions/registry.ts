/**
 * 壳扩展注册中心（架构文档 §6.1，[FR-6.2] 最小接口集）：
 * 托盘项 / 通知类型 / 窗口钩子 / 深链路由 四类注册表共用本实现；
 * 内置项也走注册表（自证"可随意增删改"）。
 */

export interface RegistryItem {
  id: string;
  order?: number;
}

export class Registry<T extends RegistryItem> {
  private readonly items = new Map<string, T>();

  register(item: T): void {
    if (this.items.has(item.id)) {
      throw new Error(`duplicate extension id: ${item.id}`);
    }
    this.items.set(item.id, item);
  }

  list(): T[] {
    return [...this.items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  remove(id: string): boolean {
    return this.items.delete(id);
  }
}
