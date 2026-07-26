import type { ProjectFile } from '../types';
import type { StylingAdapter, StylingIssue } from './types';

export const tailwindVersions = {
  tailwindcss: '^3.4.17',
  postcss: '^8.4.49',
  autoprefixer: '^10.4.20'
} as const;

export const createTailwindConfig = (): string =>
  `/** @type {import('tailwindcss').Config} */\n` +
  `module.exports = {\n` +
  `  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n` +
  `  theme: { extend: {} },\n` +
  `  plugins: []\n` +
  `};\n`;

export const createPostcssConfig = (): string =>
  `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`;

const configNames = new Set([
  'tailwind.config.js',
  'tailwind.config.cjs',
  'tailwind.config.mjs',
  'tailwind.config.ts'
]);

const tailwindUtilityPattern =
  /^(?:[a-z-]+:)*(?:bg|text|font|border|rounded|shadow|opacity|flex|grid|block|inline|hidden|items|justify|content|self|place|gap|space-[xy]|p[trblxy]?|m[trblxy]?|w|min-w|max-w|h|min-h|max-h|top|right|bottom|left|inset|z|overflow|object|cursor|select|transition|duration|ease|animate|scale|rotate|translate-[xy]|origin)-/;

const escapeCssClass = (name: string): string =>
  name.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');

export const tailwindAdapter: StylingAdapter & {
  previewCompatibility(files: ProjectFile[]): {
    files: Record<string, string>;
    dependencies: Record<string, string>;
  };
} = {
  capability: 'tailwind',
  validateSource: files => {
    const issues: StylingIssue[] = [];
    const hasTailwindConfig = files.some(file => configNames.has(file.path));
    const hasPostcssConfig = files.some(file =>
      /^postcss\.config\.(?:js|cjs|mjs)$/.test(file.path)
      && /tailwindcss/.test(file.content)
    );
    if (!hasTailwindConfig || !hasPostcssConfig) {
      issues.push({
        capability: 'tailwind',
        code: 'MISSING_CONFIGURATION',
        phase: 'source-contract',
        message: 'Tailwind directives require Tailwind and PostCSS configuration',
        previewRecoverable: true
      });
    }
    const cssFiles = files.filter(file => /@tailwind\s/.test(file.content));
    const entry = files.find(file =>
      file.path === 'src/main.tsx' || file.path === 'src/index.tsx'
    );
    if (
      cssFiles.length > 0
      && (!entry || !cssFiles.some(css =>
        entry.content.includes(`./${css.path.replace(/^src\//, '')}`)
      ))
    ) {
      issues.push({
        capability: 'tailwind',
        code: 'MISSING_ENTRY_IMPORT',
        phase: 'source-contract',
        message: 'The application entry does not import the Tailwind stylesheet',
        file: entry?.path,
        previewRecoverable: false
      });
    }
    return issues;
  },
  validateBuild: ({ files, cssAssets }) => {
    if (cssAssets.length === 0) {
      return [{
        capability: 'tailwind',
        code: 'MISSING_BUILD_OUTPUT',
        phase: 'build-evidence',
        message: 'The production build emitted no CSS assets',
        previewRecoverable: false
      }];
    }
    const css = cssAssets.map(asset => asset.content).join('\n');
    if (/@tailwind\s+(?:base|components|utilities)\s*;/.test(css)) {
      return [{
        capability: 'tailwind',
        code: 'UNEXPANDED_DIRECTIVE',
        phase: 'build-evidence',
        message: 'The emitted CSS still contains unexpanded Tailwind directives',
        previewRecoverable: false
      }];
    }
    const usedClasses = files.flatMap(file =>
      [...file.content.matchAll(/className=["']([^"']+)["']/g)]
        .flatMap(match => match[1]!.split(/\s+/))
        .filter(name => tailwindUtilityPattern.test(name))
    );
    const missing = usedClasses.find(name =>
      !css.includes(`.${escapeCssClass(name)}`)
    );
    return missing ? [{
      capability: 'tailwind',
      code: 'MISSING_BUILD_OUTPUT',
      phase: 'build-evidence',
      message: `Tailwind utility ${missing} was not emitted`,
      previewRecoverable: false
    }] : [];
  },
  previewCompatibility: files => {
    const paths = new Set(files.map(file => file.path));
    return {
      files: {
        ...(!paths.has('tailwind.config.js')
          ? { 'tailwind.config.js': createTailwindConfig() }
          : {}),
        ...(![...paths].some(path => /^postcss\.config\./.test(path))
          ? { 'postcss.config.cjs': createPostcssConfig() }
          : {})
      },
      dependencies: { ...tailwindVersions }
    };
  }
};
