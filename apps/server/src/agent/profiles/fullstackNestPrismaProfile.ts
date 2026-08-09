import path from 'node:path';
import type {
  ProjectFile,
  ProjectSnapshotPackageJson,
  ValidationErrorCategory
} from '../types';
import { normalizeProjectPath } from '../fileOperations';
import { fullstackNestPrismaPathPolicy } from './fullstackNestPrismaPolicy';
import type {
  ProfilePackageInput,
  ProfileRef,
  ProfileStructureResult,
  ProjectProfile
} from './types';
import fullstackNestPrismaPackageLock from './fullstackNestPrismaPackageLock.json';

export const FULLSTACK_NEST_PRISMA_PROFILE_REF = {
  id: 'fullstack-nestjs-prisma-postgres',
  version: 1
} as const satisfies ProfileRef;

const fixedDependencies = {
  '@nestjs/common': '^10.4.0',
  '@nestjs/core': '^10.4.0',
  '@nestjs/platform-express': '^10.4.0',
  '@prisma/client': '^6.0.0',
  'class-transformer': '^0.5.1',
  'class-validator': '^0.14.1',
  'reflect-metadata': '^0.2.2',
  react: '^18.3.0',
  'react-dom': '^18.3.0',
  rxjs: '^7.8.1'
};

const fixedDevDependencies = {
  '@nestjs/testing': '^10.4.0',
  '@types/node': '^22.0.0',
  '@types/react': '^18.3.0',
  '@types/react-dom': '^18.3.0',
  '@types/supertest': '^6.0.2',
  '@vitejs/plugin-react': '^4.3.0',
  prisma: '^6.0.0',
  supertest: '^7.0.0',
  tsx: '^4.19.0',
  typescript: '^5.6.0',
  vite: '^5.4.0'
};

const fixedScripts = {
  dev: 'npm run dev:web',
  'dev:api': 'tsx apps/api/src/main.ts',
  'dev:web': 'vite --config apps/web/vite.config.ts',
  'prisma:validate': 'prisma validate',
  'prisma:generate': 'prisma generate',
  'migration:check': 'tsx apps/api/test/check-migrations.ts',
  'migration:replay': 'tsx apps/api/test/replay-migrations.ts',
  'test:api': 'tsx --test apps/api/test/health.test.ts',
  'type-check': 'tsc --noEmit',
  'build:api': 'tsc -p apps/api/tsconfig.app.json',
  'build:web': 'vite build --config apps/web/vite.config.ts',
  build: 'npm run build:api && npm run build:web',
  'runtime:smoke': 'tsx apps/api/test/runtime-smoke.ts'
};

const allowedGeneratedDependencies = new Set([
  '@hookform/resolvers',
  '@tanstack/react-query',
  'date-fns',
  'react-hook-form',
  'zod'
]);

const allowedGeneratedDevDependencies = new Set<string>([]);

const recordFrom = (
  value: Record<string, string> | Map<string, string> | undefined
): Record<string, string> => value instanceof Map
  ? Object.fromEntries(value)
  : value ?? {};

const selectAllowed = (
  values: Array<Record<string, string> | Map<string, string> | undefined>,
  allowed: ReadonlySet<string>
): Record<string, string> => {
  const selected: Record<string, string> = {};
  for (const value of values) {
    for (const [name, version] of Object.entries(recordFrom(value))) {
      if (allowed.has(name)) selected[name] = version;
    }
  }
  return selected;
};

const sortRecord = (value: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  );

const mergePackageJson = (
  input: ProfilePackageInput
): ProjectSnapshotPackageJson => ({
  dependencies: sortRecord({
    ...fixedDependencies,
    ...selectAllowed(
      [input.base?.dependencies, input.generated.dependencies],
      allowedGeneratedDependencies
    )
  }),
  devDependencies: sortRecord({
    ...fixedDevDependencies,
    ...selectAllowed(
      [input.base?.devDependencies, input.generated.devDependencies],
      allowedGeneratedDevDependencies
    )
  }),
  scripts: { ...fixedScripts }
});

const file = (
  filePath: string,
  language: ProjectFile['language'],
  content: string
): ProjectFile => ({ path: filePath, language, content });

const createTemplate = (): ProjectFile[] => [
  file(
    'package-lock.json',
    'json',
    `${JSON.stringify(fullstackNestPrismaPackageLock, null, 2)}\n`
  ),
  file('nest-cli.json', 'json', `{
  "sourceRoot": "apps/api/src"
}
`),
  file('tsconfig.json', 'json', `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["apps/**/*.ts", "apps/**/*.tsx"]
}
`),
  file('apps/api/tsconfig.app.json', 'json', `{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": "src",
    "outDir": "../../dist/apps/api",
    "noEmit": false
  },
  "include": ["src/**/*.ts"]
}
`),
  file('apps/api/src/main.ts', 'ts', `import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
`),
  file('apps/api/src/app.module.ts', 'ts', `import { Module } from '@nestjs/common';
import { BusinessAppModule } from './modules/app.module';
import { PlatformModule } from './platform/platform.module';

@Module({ imports: [PlatformModule, BusinessAppModule] })
export class AppModule {}
`),
  file('apps/api/src/modules/app.module.ts', 'ts', `import { Module } from '@nestjs/common';

@Module({})
export class BusinessAppModule {}
`),
  file('apps/api/src/platform/platform.module.ts', 'ts', `import { Global, Module } from '@nestjs/common';
import { PlatformAuthGuard } from './auth/platform-auth.guard';
import { HealthController } from './health/health.controller';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  controllers: [HealthController],
  providers: [PrismaService, PlatformAuthGuard],
  exports: [PrismaService, PlatformAuthGuard]
})
export class PlatformModule {}
`),
  file('apps/api/src/platform/prisma/prisma.service.ts', 'ts', `import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
`),
  file('apps/api/src/platform/auth/platform-auth.guard.ts', 'ts', `import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined>; user?: { id: string } }>();
    const value = request.headers['x-platform-user-id'];
    const userId = Array.isArray(value) ? value[0] : value;
    if (!userId) throw new UnauthorizedException('Missing platform user context');
    request.user = { id: userId };
    return true;
  }
}
`),
  file('apps/api/src/platform/health/health.controller.ts', 'ts', `import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return { status: 'ok' };
  }
}
`),
  file('apps/api/test/check-migrations.ts', 'ts', `import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const migrationsRoot = path.resolve('prisma/migrations');

async function checkMigrations() {
  const entries = await readdir(migrationsRoot, { withFileTypes: true }).catch(error => {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === 'ENOENT') return [];
    throw error;
  });
  const names = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const checksums = new Set<string>();
  for (const name of names) {
    if (!/^\\d{14}_[a-z0-9_]+$/.test(name)) {
      throw new Error(\`Invalid migration directory name: \${name}\`);
    }
    const sql = await readFile(path.join(migrationsRoot, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    if (checksums.has(checksum)) {
      throw new Error(\`Duplicate migration content detected: \${name}\`);
    }
    checksums.add(checksum);
  }
  process.stdout.write(\`Validated \${names.length} migration(s)\\n\`);
}

void checkMigrations();
`),
  file('apps/api/test/health.test.ts', 'ts', `import { strict as assert } from 'node:assert';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

test('API health and generated Todo CRUD contract', async t => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  try {
    await t.test('GET /health reports readiness', async () => {
      const response = await request(app.getHttpServer()).get('/health').expect(200);
      assert.deepEqual(response.body, { status: 'ok' });
    });
    const hasTodo = Prisma.dmmf.datamodel.models.some(model => model.name === 'Todo');
    await t.test('Todo endpoints create, read, update and delete', {
      skip: !hasTodo
    }, async () => {
      const client = request(app.getHttpServer());
      const user = { 'x-platform-user-id': 'validation-user' };
      const created = await client
        .post('/api/todos')
        .set(user)
        .send({ title: 'Validate persistence' })
        .expect(201);
      assert.equal(created.body.title, 'Validate persistence');
      assert.equal(created.body.completed, false);
      const id = created.body.id as number;

      const listed = await client.get('/api/todos').set(user).expect(200);
      assert.equal(listed.body.some((todo: { id: number }) => todo.id === id), true);

      const updated = await client
        .patch(\`/api/todos/\${id}\`)
        .set(user)
        .send({ completed: true })
        .expect(200);
      assert.equal(updated.body.count, 1);

      const removed = await client.delete(\`/api/todos/\${id}\`).set(user).expect(200);
      assert.equal(removed.body.count, 1);
      const empty = await client.get('/api/todos').set(user).expect(200);
      assert.equal(empty.body.some((todo: { id: number }) => todo.id === id), false);
    });
  } finally {
    await app.close();
  }
});
`),
  file('apps/api/test/replay-migrations.ts', 'ts', `import { spawn } from 'node:child_process';

const run = (databaseUrl: string) => new Promise<void>((resolve, reject) => {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const child = spawn(executable, ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
    shell: false
  });
  child.once('error', reject);
  child.once('exit', code => {
    if (code === 0) resolve();
    else reject(new Error('Migration replay failed'));
  });
});

async function replay() {
  const primary = process.env.DATABASE_URL;
  const shadow = process.env.SHADOW_DATABASE_URL;
  if (!primary || !shadow) throw new Error('Validation database is unavailable');
  await run(primary);
  await run(shadow);
}

void replay();
`),
  file('apps/api/test/runtime-smoke.ts', 'ts', `import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

async function smoke() {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(\`\${await app.getUrl()}/health\`);
    if (!response.ok) throw new Error(\`Health check failed with status \${response.status}\`);
    const body = await response.json() as { status?: string };
    if (body.status !== 'ok') throw new Error('Health check returned an unexpected response');
  } finally {
    await app.close();
  }
}

void smoke();
`),
  file('apps/web/index.html', 'html', `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Generated App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`),
  file('apps/web/vite.config.ts', 'ts', `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'apps/web',
  plugins: [react()],
  build: { outDir: '../../dist/apps/web', emptyOutDir: true },
  server: {
    proxy: {
      '/api': {
        target: process.env.FULLSTACK_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        configure: proxy => {
          proxy.on('proxyReq', proxyReq => {
            if (!proxyReq.getHeader('x-platform-user-id')) {
              proxyReq.setHeader(
                'x-platform-user-id',
                process.env.FULLSTACK_PREVIEW_USER_ID || 'preview-user'
              );
            }
          });
        }
      }
    }
  }
});
`),
  file('apps/web/src/main.tsx', 'tsx', `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);
`),
  file('apps/web/src/App.tsx', 'tsx', `export default function App() {
  return <main>Start building your full-stack application.</main>;
}
`),
  file('apps/web/src/index.css', 'css', `:root { font-family: Inter, system-ui, sans-serif; }
body { margin: 0; min-width: 320px; min-height: 100vh; }
* { box-sizing: border-box; }
`),
  file('prisma/schema.prisma', 'prisma', `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`)
].sort((left, right) => left.path.localeCompare(right.path));

const structureFailure = (
  category: ValidationErrorCategory,
  stderr: string
): ProfileStructureResult => ({ status: 'failed', category, stdout: '', stderr });

const requiredPaths = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'apps/api/src/main.ts',
  'apps/api/src/app.module.ts',
  'apps/api/src/modules/app.module.ts',
  'apps/api/src/platform/prisma/prisma.service.ts',
  'apps/api/src/platform/health/health.controller.ts',
  'apps/api/test/check-migrations.ts',
  'apps/api/test/health.test.ts',
  'apps/api/test/replay-migrations.ts',
  'apps/api/test/runtime-smoke.ts',
  'apps/web/index.html',
  'apps/web/src/main.tsx',
  'apps/web/src/App.tsx',
  'prisma/schema.prisma'
];

const validateStructure = (files: ProjectFile[]): ProfileStructureResult => {
  const paths = new Set<string>();
  try {
    for (const projectFile of files) {
      const normalized = normalizeProjectPath(projectFile.path);
      if (paths.has(normalized)) {
        return structureFailure('CODE_ERROR', `Duplicate project file path: ${normalized}`);
      }
      paths.add(normalized);
    }
  } catch (error) {
    return structureFailure(
      'CODE_ERROR',
      error instanceof Error ? error.message : 'Unsafe project file path'
    );
  }

  const missing = requiredPaths.find(required => !paths.has(required));
  if (missing) {
    return structureFailure('CODE_ERROR', `Required project file is missing: ${missing}`);
  }
  const packageFile = files.find(projectFile =>
    path.posix.normalize(projectFile.path) === 'package.json'
  )!;
  try {
    const packageJson = JSON.parse(packageFile.content) as {
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
    };
    for (const [name, value] of Object.entries(fixedScripts)) {
      if (packageJson.scripts?.[name] !== value) {
        return structureFailure('DEPENDENCY_ERROR', `package.json has an invalid ${name} script`);
      }
    }
    for (const name of Object.keys(fixedDependencies)) {
      if (typeof packageJson.dependencies?.[name] !== 'string') {
        return structureFailure('DEPENDENCY_ERROR', `package.json is missing ${name}`);
      }
    }
  } catch {
    return structureFailure('DEPENDENCY_ERROR', 'package.json is not valid JSON');
  }
  return { status: 'passed', stdout: 'Full-stack project structure is valid', stderr: '' };
};

export const fullstackNestPrismaProfile: ProjectProfile = {
  ref: FULLSTACK_NEST_PRISMA_PROFILE_REF,
  createTemplate,
  editablePathPolicy: fullstackNestPrismaPathPolicy,
  mergePackageJson,
  generationDescriptor: () => ({
    capabilities: [
      'NestJS REST API business modules',
      'Prisma schema and append-only PostgreSQL migrations',
      'React and Vite web client',
      'Platform-provided authentication context and health endpoint'
    ],
    instructions: [
      'Generate only business modules under apps/api/src/modules, web source under apps/web/src, the Prisma schema, and newly appended migration directories.',
      'Use the provided PrismaService and PlatformAuthGuard; do not replace bootstrap, AppModule, platform adapters, root configuration, or scripts.',
      'Use explicit @Inject(...) constructor parameters in NestJS business modules so validation through the TypeScript runtime preserves dependency injection.',
      'Return complete TypeScript, TSX, Prisma, CSS, and SQL file contents without shell commands.'
    ].join(' ')
  }),
  validateStructure,
  validationPipeline: () => [
    { id: 'structure', phase: 'structure' },
    { id: 'install', phase: 'dependencies' },
    { id: 'prisma-validate', phase: 'prisma' },
    { id: 'prisma-generate', phase: 'prisma' },
    { id: 'migration-history', phase: 'migration' },
    { id: 'migration-replay', phase: 'migration' },
    { id: 'nest-type-check', phase: 'type-check' },
    { id: 'api-test', phase: 'api-test' },
    { id: 'web-api-build', phase: 'build' },
    { id: 'runtime-smoke', phase: 'runtime-smoke' }
  ],
  runtimeDescriptor: () => ({
    kind: 'server',
    buildOutputDirectory: 'dist',
    entryPath: 'dist/apps/api/main.js'
  })
};
