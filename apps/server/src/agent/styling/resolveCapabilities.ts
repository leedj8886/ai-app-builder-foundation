import type { ProjectFile } from '../types';
import type {
  StylingCapability,
  StylingIssue,
  StylingResolution
} from './types';

const capabilityOrder: StylingCapability[] = [
  'plain-css',
  'tailwind',
  'css-modules',
  'styled-components'
];

const packageMaps = (files: ProjectFile[]): Record<string, string> => {
  const packageFile = files.find(file => file.path === 'package.json');
  if (!packageFile) return {};
  try {
    const parsed = JSON.parse(packageFile.content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      ...parsed.dependencies,
      ...parsed.devDependencies
    };
  } catch {
    return {};
  }
};

export const resolveStylingCapabilities = (
  files: ProjectFile[],
  hint?: string
): StylingResolution => {
  const evidence: StylingResolution['evidence'] = {};
  const addEvidence = (
    capability: StylingCapability,
    description: string
  ): void => {
    (evidence[capability] ??= []).push(description);
  };
  const dependencies = packageMaps(files);

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (file.path.endsWith('.css')) {
      addEvidence('plain-css', `${file.path} is a CSS stylesheet`);
    }
    if (file.path.endsWith('.module.css')) {
      addEvidence('css-modules', `${file.path} is a CSS Module`);
    }
    if (/@tailwind\s+(?:base|components|utilities)\s*;/.test(file.content)) {
      addEvidence('tailwind', `${file.path} contains @tailwind directives`);
    }
    if (/^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(file.path)) {
      addEvidence('tailwind', `${file.path} configures Tailwind`);
    }
    if (
      /(?:from\s+|require\()['"]styled-components['"]/.test(file.content)
    ) {
      addEvidence(
        'styled-components',
        `${file.path} imports styled-components`
      );
    }
  }

  if (dependencies.tailwindcss) {
    addEvidence('tailwind', 'package.json includes tailwindcss');
  }
  if (dependencies['styled-components']) {
    addEvidence(
      'styled-components',
      'package.json includes styled-components'
    );
  }

  const detected = capabilityOrder.filter(capability =>
    (evidence[capability]?.length ?? 0) > 0
  );
  if (detected.length === 0) {
    addEvidence('plain-css', 'plain CSS is the default styling capability');
    detected.push('plain-css');
  }

  const issues: StylingIssue[] = [];
  if (
    hint
    && capabilityOrder.includes(hint as StylingCapability)
    && !detected.includes(hint as StylingCapability)
    && detected.some(capability => capability !== 'plain-css')
  ) {
    issues.push({
      capability: hint as StylingCapability,
      code: 'METADATA_CONFLICT',
      phase: 'source-contract',
      message: `Project styling hint ${hint} conflicts with source evidence`,
      previewRecoverable: true
    });
  }

  return {
    capabilities: detected,
    evidence,
    issues
  };
};
