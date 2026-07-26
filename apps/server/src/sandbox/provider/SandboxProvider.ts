import type {
  SandboxDestroyReceipt,
  SandboxHandle,
  SandboxInspection,
  SandboxListFilter,
  SandboxProviderDescriptor,
  SandboxRef,
  SandboxSpec
} from '../types';

export interface SandboxProvider {
  readonly kind: string;
  describe(): Promise<SandboxProviderDescriptor>;
  create(spec: SandboxSpec): Promise<SandboxRef>;
  connect(ref: SandboxRef): Promise<SandboxHandle>;
  inspect(ref: SandboxRef): Promise<SandboxInspection>;
  list(filter: SandboxListFilter): Promise<SandboxRef[]>;
  destroy(
    ref: SandboxRef,
    options?: { wait?: boolean }
  ): Promise<SandboxDestroyReceipt>;
}
