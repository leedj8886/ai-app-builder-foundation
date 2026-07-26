import type { SandboxConfig } from './config';
import { SandboxError } from './errors';
import type { SandboxCommand, SandboxSpec } from './types';

export type BuildCommandName = 'install' | 'type-check' | 'build';

export interface SandboxPolicy {
  assertProviderAllowed(
    provider: string,
    context: { production: boolean }
  ): void;
  assertSpecAllowed(spec: SandboxSpec): void;
  requiredCapabilities(spec: SandboxSpec): string[];
  buildCommand(
    name: BuildCommandName,
    input: { hasPackageLock: boolean; maxOutputBytes: number }
  ): SandboxCommand;
}

const PLATFORM_MAX_OUTPUT_BYTES = 1024 * 1024;

const deny = (message: string): never => {
  throw new SandboxError('SANDBOX_POLICY_DENIED', message);
};

export const createSandboxPolicy = (
  config: SandboxConfig
): SandboxPolicy => ({
  assertProviderAllowed(provider, context) {
    if (provider.length === 0) deny('Sandbox provider is required');
    if (provider === 'local' && (context.production || !config.localEnabled)) {
      deny('LocalProcessProvider is not allowed');
    }
  },

  assertSpecAllowed(spec) {
    if (!config.allowedBuildImages.includes(spec.runtime.image)) {
      deny('Sandbox runtime image is not allowed');
    }
    if (spec.runtime.workingDirectory !== '/workspace') {
      deny('Sandbox working directory is not allowed');
    }
    if (
      !Number.isFinite(spec.resources.cpu) ||
      spec.resources.cpu <= 0 ||
      !Number.isSafeInteger(spec.resources.memoryMiB) ||
      spec.resources.memoryMiB <= 0 ||
      !Number.isSafeInteger(spec.resources.diskMiB) ||
      spec.resources.diskMiB <= 0
    ) {
      deny('Sandbox resource profile is invalid');
    }
    if (
      !Number.isSafeInteger(spec.lifecycle.leaseSeconds) ||
      spec.lifecycle.leaseSeconds <= 0 ||
      !Number.isSafeInteger(spec.lifecycle.autoDeleteSeconds) ||
      spec.lifecycle.autoDeleteSeconds <= 0
    ) {
      deny('Sandbox lifecycle is invalid');
    }
  },

  requiredCapabilities(spec) {
    const capabilities = ['files', 'processes', 'lifecycle'];
    if (spec.ownership.purpose === 'preview') capabilities.push('preview');
    if (
      spec.networkPolicy.defaultAction === 'deny' ||
      spec.networkPolicy.allowedDomains.length > 0 ||
      spec.networkPolicy.allowedCidrs.length > 0
    ) {
      capabilities.push('networkPolicy');
    }
    return capabilities;
  },

  buildCommand(name, input) {
    if (
      !Number.isSafeInteger(input.maxOutputBytes) ||
      input.maxOutputBytes <= 0
    ) {
      deny('Command output limit must be a positive safe integer');
    }

    const args =
      name === 'install'
        ? [input.hasPackageLock ? 'ci' : 'install']
        : ['run', name];
    const timeoutMs =
      name === 'install'
        ? config.commandTimeouts.install
        : name === 'type-check'
          ? config.commandTimeouts.typeCheck
          : config.commandTimeouts.build;

    return {
      executable: 'npm',
      args,
      cwd: '/workspace',
      env: { CI: 'true' },
      timeoutMs,
      maxOutputBytes: Math.min(
        input.maxOutputBytes,
        PLATFORM_MAX_OUTPUT_BYTES
      )
    };
  }
});
