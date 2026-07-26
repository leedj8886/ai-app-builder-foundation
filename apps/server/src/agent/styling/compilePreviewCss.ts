import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type { ProjectFile } from '../types';
import { resolveStylingCapabilities } from './resolveCapabilities';

export const compilePreviewCss = async (
  files: ProjectFile[]
): Promise<string | undefined> => {
  const resolution = resolveStylingCapabilities(files);
  if (!resolution.capabilities.includes('tailwind')) return undefined;
  const hasTailwindConfig = files.some(file =>
    /^tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(file.path)
  );
  const hasPostcssConfig = files.some(file =>
    /^postcss\.config\.(?:js|cjs|mjs)$/.test(file.path)
  );
  if (hasTailwindConfig && hasPostcssConfig) return undefined;

  const raw = files
    .filter(file => /^(?:src\/)?.*\.(?:js|ts|jsx|tsx|html)$/.test(file.path))
    .map(file => file.content)
    .join('\n');
  const result = await postcss([
    tailwindcss({
      content: [{ raw, extension: 'tsx' }],
      corePlugins: { preflight: false }
    })
  ]).process('@tailwind utilities;', { from: undefined });
  return result.css;
};
