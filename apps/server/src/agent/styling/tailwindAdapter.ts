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
