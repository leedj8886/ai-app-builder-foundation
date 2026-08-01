import type { SnapshotPackageJson } from './appBuilderWorkspace'

export type StylingCapability =
  | 'plain-css'
  | 'tailwind'
  | 'css-modules'
  | 'styled-components'

const tailwindConfig =
  `/** @type {import('tailwindcss').Config} */\n` +
  `module.exports = {\n` +
  `  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n` +
  `  theme: { extend: {} },\n` +
  `  plugins: []\n` +
  `};\n`

const postcssConfig =
  `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n`

export const augmentPreviewStyling = (
  sourceFiles: Record<string, string>,
  packageJson: SnapshotPackageJson,
): {
  files: Record<string, string>
  dependencies: Record<string, string>
  capabilities: StylingCapability[]
} => {
  const files = { ...sourceFiles }
  const dependencies = { ...packageJson.dependencies }
  const declaredPackages = {
    ...dependencies,
    ...packageJson.devDependencies,
  }
  const entries = Object.entries(files)
  const capabilities: StylingCapability[] = []
  const hasCss = entries.some(([path]) => path.endsWith('.css'))
  const hasTailwind = Boolean(declaredPackages.tailwindcss)
    || entries.some(([path, content]) =>
      /\/tailwind\.config\.(?:js|cjs|mjs|ts)$/.test(path)
      || /@tailwind\s+(?:base|components|utilities)\s*;/.test(content))
  const hasModules = entries.some(([path]) => path.endsWith('.module.css'))
  const hasStyled = Boolean(declaredPackages['styled-components'])
    || entries.some(([, content]) =>
      /(?:from\s+|require\()['"]styled-components['"]/.test(content))

  if (hasCss || (!hasTailwind && !hasModules && !hasStyled)) {
    capabilities.push('plain-css')
  }
  if (hasTailwind) {
    capabilities.push('tailwind')
    if (!entries.some(([path]) => /\/tailwind\.config\./.test(path))) {
      files['/tailwind.config.js'] = tailwindConfig
    }
    if (!entries.some(([path]) => /\/postcss\.config\./.test(path))) {
      files['/postcss.config.cjs'] = postcssConfig
    }
    Object.assign(dependencies, {
      tailwindcss: declaredPackages.tailwindcss ?? '^3.4.17',
      postcss: declaredPackages.postcss ?? '^8.4.49',
      autoprefixer: declaredPackages.autoprefixer ?? '^10.4.20',
    })
  }
  if (hasModules) capabilities.push('css-modules')
  if (hasStyled) capabilities.push('styled-components')

  return { files, dependencies, capabilities }
}
