import type { EditablePathPolicy } from './types';

export const fullstackNestPrismaPathPolicy = (): EditablePathPolicy => ({
  editablePathPatterns: [
    'apps/api/src/modules/**',
    'apps/web/src/**',
    'prisma/schema.prisma',
    'prisma/migrations/*/**'
  ],
  platformManagedPathPatterns: [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'nest-cli.json',
    'apps/api/tsconfig.app.json',
    'apps/api/src/main.ts',
    'apps/api/src/app.module.ts',
    'apps/api/src/platform/**',
    'apps/api/test/**',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'apps/web/src/main.tsx'
  ],
  protectedDeletePaths: [],
  immutableExistingDirectoryPatterns: ['prisma/migrations/*']
});
