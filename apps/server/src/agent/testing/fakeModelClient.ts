import type {
  AgentPlan,
  FileOperation,
  GenerationResult,
  ModelClient
} from '../types';

export interface FakeModelClient extends ModelClient {
  calls: {
    plan: number;
    generate: number;
    repair: number;
  };
}

const deterministicPlan: AgentPlan = {
  summary: 'Build a deterministic React application',
  steps: [{
    title: 'Create application files',
    intent: 'Create a minimal runnable React application',
    filesLikelyTouched: ['index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css']
  }],
  assumptions: []
};

const deterministicGeneration: GenerationResult = {
  message: 'Created the deterministic application',
  operations: [
    {
      type: 'create',
      path: 'index.html',
      content: '<div id="root"></div><script type="module" src="/src/main.tsx"></script>'
    },
    {
      type: 'create',
      path: 'src/main.tsx',
      content: "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\ncreateRoot(document.getElementById('root')!).render(<App />);"
    },
    {
      type: 'create',
      path: 'src/App.tsx',
      content: "export default function App() { return <main data-testid=\"generated-app\">Generated app</main>; }"
    },
    {
      type: 'create',
      path: 'src/index.css',
      content: 'body { margin: 0; font-family: sans-serif; }'
    }
  ],
  dependencies: {},
  devDependencies: {}
};

const deterministicRepair: GenerationResult = {
  message: 'Repaired the deterministic application',
  operations: [{
    type: 'update',
    path: 'src/App.tsx',
    content: "export default function App() { return <main data-testid=\"generated-app\">Repaired app</main>; }"
  }],
  dependencies: {},
  devDependencies: {}
};

const fullstackTodoPlan: AgentPlan = {
  summary: 'Build a Todo CRUD application with NestJS, Prisma, PostgreSQL, and React',
  steps: [{
    title: 'Add Todo persistence and API',
    intent: 'Create the Todo Prisma model, migration, and NestJS business module',
    filesLikelyTouched: [
      'prisma/schema.prisma',
      'prisma/migrations/20260808000000_add_todo/migration.sql',
      'apps/api/src/modules/app.module.ts',
      'apps/api/src/modules/todo/todo.module.ts',
      'apps/api/src/modules/todo/todo.controller.ts',
      'apps/api/src/modules/todo/todo.service.ts'
    ]
  }, {
    title: 'Add Todo web client',
    intent: 'Render and mutate Todos through the REST API',
    filesLikelyTouched: ['apps/web/src/App.tsx']
  }],
  assumptions: ['The platform provides DATABASE_URL and authenticated user context']
};

const fullstackTodoGeneration: GenerationResult = {
  message: 'Created the deterministic full-stack Todo application',
  operations: [
    {
      type: 'update',
      path: 'apps/api/src/modules/app.module.ts',
      content: `import { Module } from '@nestjs/common';
import { TodoModule } from './todo/todo.module';

@Module({ imports: [TodoModule] })
export class BusinessAppModule {}
`
    },
    {
      type: 'create',
      path: 'apps/api/src/modules/todo/todo.module.ts',
      content: `import { Module } from '@nestjs/common';
import { TodoController } from './todo.controller';
import { TodoService } from './todo.service';

@Module({ controllers: [TodoController], providers: [TodoService] })
export class TodoModule {}
`
    },
    {
      type: 'create',
      path: 'apps/api/src/modules/todo/todo.service.ts',
      content: `import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';

@Injectable()
export class TodoService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}
  list(ownerId: string) { return this.prisma.todo.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } }); }
  create(ownerId: string, title: string) { return this.prisma.todo.create({ data: { ownerId, title } }); }
  update(ownerId: string, id: number, completed: boolean) { return this.prisma.todo.updateMany({ where: { id, ownerId }, data: { completed } }); }
  remove(ownerId: string, id: number) { return this.prisma.todo.deleteMany({ where: { id, ownerId } }); }
}
`
    },
    {
      type: 'create',
      path: 'apps/api/src/modules/todo/todo.controller.ts',
      content: `import { Body, Controller, Delete, Get, Headers, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformAuthGuard } from '../../platform/auth/platform-auth.guard';
import { TodoService } from './todo.service';

@UseGuards(PlatformAuthGuard)
@Controller('api/todos')
export class TodoController {
  constructor(@Inject(TodoService) private readonly todos: TodoService) {}
  @Get() list(@Headers('x-platform-user-id') ownerId: string) { return this.todos.list(ownerId); }
  @Post() create(@Headers('x-platform-user-id') ownerId: string, @Body() body: { title: string }) { return this.todos.create(ownerId, body.title); }
  @Patch(':id') update(@Headers('x-platform-user-id') ownerId: string, @Param('id') id: string, @Body() body: { completed: boolean }) { return this.todos.update(ownerId, Number(id), body.completed); }
  @Delete(':id') remove(@Headers('x-platform-user-id') ownerId: string, @Param('id') id: string) { return this.todos.remove(ownerId, Number(id)); }
}
`
    },
    {
      type: 'update',
      path: 'apps/web/src/App.tsx',
      content: `import { useEffect, useState } from 'react';

interface Todo { id: number; title: string; completed: boolean }

export default function App() {
  const [todos, setTodos] = useState<Todo[]>([]);
  useEffect(() => { void fetch('/api/todos', { headers: { 'x-platform-user-id': 'preview-user' } }).then(response => response.json()).then(setTodos); }, []);
  return <main><h1>Todos</h1><ul>{todos.map(todo => <li key={todo.id}>{todo.title}</li>)}</ul></main>;
}
`
    },
    {
      type: 'update',
      path: 'prisma/schema.prisma',
      content: `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Todo {
  id        Int      @id @default(autoincrement())
  ownerId   String
  title     String
  completed Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([ownerId, createdAt])
}
`
    },
    {
      type: 'create',
      path: 'prisma/migrations/20260808000000_add_todo/migration.sql',
      content: `CREATE TABLE "Todo" (
  "id" SERIAL PRIMARY KEY,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Todo_ownerId_createdAt_idx" ON "Todo"("ownerId", "createdAt");
`
    }
  ],
  dependencies: {},
  devDependencies: {}
};

const hasFileContent = (
  operation: FileOperation
): operation is Extract<FileOperation, { content: string }> =>
  operation.type !== 'delete';

export const createFakeModelClient = (): FakeModelClient => {
  const calls = { plan: 0, generate: 0, repair: 0 };
  return {
    calls,
    generatePlan: async input => {
      calls.plan += 1;
      return {
        value: input.context.project.profile?.id === 'fullstack-nestjs-prisma-postgres'
          ? fullstackTodoPlan
          : deterministicPlan
      };
    },
    generateFiles: async input => {
      calls.generate += 1;
      if (input.context.project.profile?.id === 'fullstack-nestjs-prisma-postgres') {
        return { value: fullstackTodoGeneration };
      }
      if (input.context.mode === 'edit') {
        const currentApp = input.context.files.find(
          file => file.path === 'src/App.tsx'
        )?.content ?? deterministicGeneration.operations.filter(
          hasFileContent
        ).find(
          operation => operation.path === 'src/App.tsx'
        )?.content ?? '';

        return {
          value: {
            message: 'Updated the deterministic application',
            operations: [{
              type: 'update',
              path: 'src/App.tsx',
              content: `${currentApp}\n// deterministic edit`
            }],
            dependencies: {},
            devDependencies: {}
          }
        };
      }
      return { value: deterministicGeneration };
    },
    repairFiles: async input => {
      calls.repair += 1;
      return {
        value: input.context.project.profile?.id === 'fullstack-nestjs-prisma-postgres'
          ? {
              message: 'Repaired the full-stack Todo web client',
              operations: [{
                type: 'update',
                path: 'apps/web/src/App.tsx',
                content: 'export default function App() { return <main>Repaired Todos</main>; }'
              }],
              dependencies: {},
              devDependencies: {}
            }
          : deterministicRepair
      };
    }
  };
};
