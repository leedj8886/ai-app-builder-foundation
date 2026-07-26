export type StylingCapability =
  | 'plain-css'
  | 'tailwind'
  | 'css-modules'
  | 'styled-components';

export interface StylingIssue {
  capability: StylingCapability;
  code:
    | 'MISSING_DEPENDENCY'
    | 'MISSING_CONFIGURATION'
    | 'MISSING_ENTRY_IMPORT'
    | 'UNEXPANDED_DIRECTIVE'
    | 'MISSING_BUILD_OUTPUT'
    | 'METADATA_CONFLICT';
  phase: 'source-contract' | 'build-evidence';
  message: string;
  file?: string;
  previewRecoverable: boolean;
}

export interface StylingResolution {
  capabilities: StylingCapability[];
  evidence: Partial<Record<StylingCapability, string[]>>;
  issues: StylingIssue[];
}
