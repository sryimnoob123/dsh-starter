export interface GlobalPromptConfig {
  enabled: boolean;
  globalPrompt?: string;
  includeHarnessIdentity?: boolean;
  personaEnabled?: boolean;
  persona?: string;
  includeRuntimeContext?: boolean;
  notifyResult?: boolean;
  migrated?: boolean;
}
export declare function effectiveAgentsText(config: GlobalPromptConfig): string;
export declare function validatePromptConfig(config: unknown): string | null;
export declare function validateProjectText(text: unknown): string | null;
export declare function registeredWorkspacePath(registry: { get(id: string): { path?: unknown } | undefined }, workspaceId: string): string | null;
