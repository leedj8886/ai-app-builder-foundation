import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectFile } from '../types';
import { ProfileError } from './errors';
import {
  applyProfileFileOperations,
  assertProfilePlatformFilesUnchanged,
  pathMatchesProfilePattern
} from './filePolicy';
import { fullstackNestPrismaPathPolicy } from './fullstackNestPrismaPolicy';
import { staticReactProfile } from './staticReactProfile';
import type { ProjectProfile } from './types';

const fullstackProfile: ProjectProfile = {
  ...staticReactProfile,
  ref: { id: 'fullstack-nestjs-prisma-postgres', version: 1 },
  editablePathPolicy: fullstackNestPrismaPathPolicy
};

const expectProfileError = (
  code: ProfileError['code']
): ((error: unknown) => boolean) => error =>
  error instanceof ProfileError && error.code === code;

test('Profile patterns cover static files and bounded full-stack directories', () => {
  assert.equal(pathMatchesProfilePattern('src/App.tsx', '**/*'), true);
  assert.equal(
    pathMatchesProfilePattern(
      'prisma/migrations/20260808_init/migration.sql',
      'prisma/migrations/*/**'
    ),
    true
  );
  assert.equal(
    pathMatchesProfilePattern('prisma/migrations/a/b/c.sql', 'prisma/migrations/*/**'),
    true
  );
  assert.equal(
    pathMatchesProfilePattern('prisma/migrations/migration.sql', 'prisma/migrations/*/**'),
    false
  );
});

test('static Profile preserves editable files and protected delete constraints', () => {
  const baseFiles: ProjectFile[] = [{
    path: 'src/App.tsx',
    content: 'export default function App() { return null; }',
    language: 'tsx'
  }];
  const files = applyProfileFileOperations(staticReactProfile, baseFiles, [{
    type: 'update',
    path: 'src/App.tsx',
    content: 'export default function App() { return <main />; }'
  }]);
  assert.match(files[0].content, /main/);

  assert.throws(
    () => applyProfileFileOperations(staticReactProfile, [{
      path: 'src/main.tsx',
      content: 'bootstrap();',
      language: 'tsx'
    }], [{ type: 'delete', path: 'src/main.tsx' }]),
    expectProfileError('PROFILE_PATH_DENIED')
  );
});

test('Profile validation rejects an entire operation batch before applying it', () => {
  const baseFiles: ProjectFile[] = [{
    path: 'apps/web/src/App.tsx',
    content: 'before',
    language: 'tsx'
  }];
  assert.throws(
    () => applyProfileFileOperations(fullstackProfile, baseFiles, [
      { type: 'update', path: 'apps/web/src/App.tsx', content: 'after' },
      { type: 'update', path: 'apps/api/src/main.ts', content: 'hijack();' }
    ]),
    expectProfileError('PROFILE_PLATFORM_FILE_MODIFIED')
  );
  assert.equal(baseFiles[0].content, 'before');
});

test('full-stack Profile allows business files and append-only migrations', () => {
  const baseFiles: ProjectFile[] = [{
    path: 'prisma/migrations/20260808_init/migration.sql',
    content: 'CREATE TABLE "Todo" ();',
    language: 'sql'
  }];
  const files = applyProfileFileOperations(fullstackProfile, baseFiles, [
    {
      type: 'create',
      path: 'apps/api/src/modules/todo/todo.service.ts',
      content: 'export class TodoService {}'
    },
    {
      type: 'create',
      path: 'apps/web/src/features/todo.tsx',
      content: 'export const Todo = () => null;'
    },
    {
      type: 'create',
      path: 'prisma/schema.prisma',
      content: 'datasource db { provider = "postgresql" }'
    },
    {
      type: 'create',
      path: 'prisma/migrations/20260809_add_todo/migration.sql',
      content: 'ALTER TABLE "Todo" ADD COLUMN title TEXT;'
    }
  ]);

  assert.equal(files.some(file => file.language === 'prisma'), true);
  assert.equal(files.some(file => file.language === 'sql'), true);
});

test('full-stack Profile blocks path, platform, script, migration and file-type violations', () => {
  const baseFiles: ProjectFile[] = [
    {
      path: 'apps/api/src/main.ts',
      content: 'bootstrap();',
      language: 'ts'
    },
    {
      path: 'prisma/migrations/20260808_init/migration.sql',
      content: 'CREATE TABLE "Todo" ();',
      language: 'sql'
    }
  ];
  const violations = [
    {
      operation: { type: 'create', path: 'apps/api/src/unsafe.ts', content: '' } as const,
      code: 'PROFILE_PATH_DENIED' as const
    },
    {
      operation: { type: 'update', path: 'apps/api/src/main.ts', content: '' } as const,
      code: 'PROFILE_PLATFORM_FILE_MODIFIED' as const
    },
    {
      operation: { type: 'update', path: 'package.json', content: '{}' } as const,
      code: 'PROFILE_SCRIPT_MODIFIED' as const
    },
    {
      operation: {
        type: 'update',
        path: 'prisma/migrations/20260808_init/migration.sql',
        content: '-- rewritten'
      } as const,
      code: 'PROFILE_PLATFORM_FILE_MODIFIED' as const
    },
    {
      operation: { type: 'create', path: 'apps/web/src/logo.png', content: '' } as const,
      code: 'PROFILE_UNSUPPORTED_FILE_TYPE' as const
    }
  ];

  for (const violation of violations) {
    assert.throws(
      () => applyProfileFileOperations(
        fullstackProfile,
        baseFiles,
        [violation.operation]
      ),
      expectProfileError(violation.code)
    );
  }
});

test('platform content digest detects an indirect candidate modification', () => {
  const baseFiles: ProjectFile[] = [{
    path: 'apps/api/src/main.ts',
    content: 'bootstrap();',
    language: 'ts'
  }];
  assert.throws(
    () => assertProfilePlatformFilesUnchanged(fullstackProfile, baseFiles, [{
      ...baseFiles[0],
      content: 'compromised();'
    }]),
    expectProfileError('PROFILE_PLATFORM_FILE_MODIFIED')
  );
});
