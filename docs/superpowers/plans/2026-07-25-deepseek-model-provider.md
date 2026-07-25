# DeepSeek Model Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route both the production Agent worker and the legacy chat service through the official DeepSeek API, defaulting to `deepseek-v4-flash`.

**Architecture:** Keep the OpenAI SDK as the OpenAI-compatible transport and add a focused DeepSeek provider module that owns environment parsing, credential validation, and SDK construction. The Agent retains its existing `ModelClient` boundary, while the legacy AI service receives a small injectable completion dependency so tests never call the network.

**Tech Stack:** TypeScript, Node.js test runner, OpenAI Node SDK, Zod, Express, BullMQ

---

## File Map

- Create `apps/server/src/services/modelProvider.ts`: parse shared DeepSeek configuration and construct the OpenAI-compatible SDK client.
- Create `apps/server/src/services/modelProvider.test.ts`: verify defaults, overrides, credentials, Base URL propagation, and sanitized configuration failures.
- Modify `apps/server/src/agent/config.ts`: make Agent model selection fall back to the shared DeepSeek model.
- Modify `apps/server/src/agent/config.test.ts`: verify `AGENT_MODEL` precedence and the DeepSeek default.
- Modify `apps/server/src/agent/modelClient.ts`: create the production Agent adapter from the shared DeepSeek client.
- Modify `apps/server/src/agent/modelClient.test.ts`: verify production configuration is passed to the provider boundary.
- Modify `apps/server/src/worker.ts`: bootstrap the production worker from DeepSeek environment configuration.
- Create `apps/server/src/services/aiService.test.ts`: verify legacy code and title generation use the injected DeepSeek completion client and configured model.
- Modify `apps/server/src/services/aiService.ts`: remove the module-level OpenAI client and lazily use the shared provider.
- Modify `README.md`: document DeepSeek environment variables and the real-versus-smoke worker distinction.

### Task 1: Shared DeepSeek Provider Configuration

**Files:**
- Create: `apps/server/src/services/modelProvider.ts`
- Create: `apps/server/src/services/modelProvider.test.ts`

- [x] **Step 1: Write failing configuration and client-factory tests**

Create `apps/server/src/services/modelProvider.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import {
  createDeepSeekClient,
  getDeepSeekConfig
} from './modelProvider';

test('getDeepSeekConfig uses official API defaults', () => {
  const config = getDeepSeekConfig({});

  assert.deepEqual(config, {
    apiKey: undefined,
    baseURL: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash'
  });
});

test('getDeepSeekConfig reads provider overrides', () => {
  const config = getDeepSeekConfig({
    DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_BASE_URL: 'https://deepseek.example.test',
    DEEPSEEK_MODEL: 'deepseek-v4-pro'
  });

  assert.deepEqual(config, {
    apiKey: 'test-key',
    baseURL: 'https://deepseek.example.test',
    model: 'deepseek-v4-pro'
  });
});

test('createDeepSeekClient passes credentials and base URL to the SDK', () => {
  let received: OpenAI.ClientOptions | undefined;
  const fakeClient = {} as OpenAI;

  const client = createDeepSeekClient(
    {
      apiKey: 'test-key',
      baseURL: 'https://deepseek.example.test',
      model: 'deepseek-v4-flash'
    },
    options => {
      received = options;
      return fakeClient;
    }
  );

  assert.equal(client, fakeClient);
  assert.deepEqual(received, {
    apiKey: 'test-key',
    baseURL: 'https://deepseek.example.test'
  });
});

test('createDeepSeekClient rejects missing credentials without leaking values', () => {
  assert.throws(
    () => createDeepSeekClient({
      apiKey: undefined,
      baseURL: 'https://api.deepseek.com',
      model: 'deepseek-v4-flash'
    }),
    (error: Error & { code?: string }) =>
      error.code === 'MODEL_CONFIGURATION_ERROR' &&
      error.message === 'DEEPSEEK_API_KEY is required'
  );
});
```

- [x] **Step 2: Run the provider test to verify it fails**

Run:

```bash
node --import tsx --test --test-name-pattern="DeepSeek|deepseek" apps/server/src/services/modelProvider.test.ts
```

Expected: FAIL because `./modelProvider` does not exist.

- [x] **Step 3: Implement the shared provider module**

Create `apps/server/src/services/modelProvider.ts`:

```ts
import OpenAI from 'openai';

type EnvLike = Record<string, string | undefined>;

export interface DeepSeekConfig {
  apiKey: string | undefined;
  baseURL: string;
  model: string;
}

type ClientFactory = (options: OpenAI.ClientOptions) => OpenAI;

const configurationError = (): Error & { code: string } =>
  Object.assign(
    new Error('DEEPSEEK_API_KEY is required'),
    { code: 'MODEL_CONFIGURATION_ERROR' }
  );

export const getDeepSeekConfig = (
  env: EnvLike = process.env
): DeepSeekConfig => ({
  apiKey: env.DEEPSEEK_API_KEY,
  baseURL: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
});

export const createDeepSeekClient = (
  config: DeepSeekConfig,
  createClient: ClientFactory = options => new OpenAI(options)
): OpenAI => {
  if (!config.apiKey) {
    throw configurationError();
  }

  return createClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL
  });
};
```

- [x] **Step 4: Run focused tests and type-check**

Run:

```bash
node --import tsx --test --test-name-pattern="DeepSeek|deepseek" apps/server/src/services/modelProvider.test.ts
npm run type-check --workspace @v0/server
```

Expected: provider tests PASS and TypeScript exits with code 0.

- [x] **Step 5: Commit the provider boundary**

```bash
git add apps/server/src/services/modelProvider.ts apps/server/src/services/modelProvider.test.ts
git commit -m "feat: add DeepSeek provider configuration"
```

### Task 2: Agent Worker DeepSeek Adapter

**Files:**
- Modify: `apps/server/src/agent/config.ts`
- Modify: `apps/server/src/agent/config.test.ts`
- Modify: `apps/server/src/agent/modelClient.ts`
- Modify: `apps/server/src/agent/modelClient.test.ts`
- Modify: `apps/server/src/worker.ts`

- [x] **Step 1: Write failing Agent model-selection tests**

Update the default assertion in `apps/server/src/agent/config.test.ts` and add the precedence test:

```ts
test('getAgentConfig uses stable defaults', () => {
  const config = getAgentConfig({});

  assert.equal(config.redisUrl, 'redis://localhost:6379');
  assert.equal(config.queueName, 'v0-agent-runs');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.maxRepairAttempts, 2);
  assert.equal(config.workspaceRoot, '/tmp/v0-agent-runs');
  assert.equal(config.contextCharLimit, 120000);
  assert.equal(config.commandTimeoutMs, 120000);
  assert.equal(config.maxValidationOutputChars, 12000);
});

test('getAgentConfig gives AGENT_MODEL precedence over DEEPSEEK_MODEL', () => {
  assert.equal(
    getAgentConfig({
      AGENT_MODEL: 'agent-model',
      DEEPSEEK_MODEL: 'shared-model'
    }).model,
    'agent-model'
  );
  assert.equal(
    getAgentConfig({ DEEPSEEK_MODEL: 'shared-model' }).model,
    'shared-model'
  );
});
```

- [x] **Step 2: Run the Agent config tests to verify they fail**

Run:

```bash
node --import tsx --test apps/server/src/agent/config.test.ts
```

Expected: FAIL because the current default is `gpt-4.1` and
`DEEPSEEK_MODEL` is ignored.

- [x] **Step 3: Implement Agent model precedence**

Replace the model property in `apps/server/src/agent/config.ts`:

```ts
model:
  env.AGENT_MODEL ||
  env.DEEPSEEK_MODEL ||
  'deepseek-v4-flash',
```

- [x] **Step 4: Add a failing production-adapter test**

Change the import in `apps/server/src/agent/modelClient.test.ts`:

```ts
import OpenAI from 'openai';
import {
  createOpenAIModelClient,
  createProductionModelClient
} from './modelClient';
```

Add:

```ts
test('production model client uses DeepSeek configuration', async () => {
  const requests: Array<{ model: string }> = [];
  const client = createProductionModelClient(
    {
      apiKey: 'test-key',
      baseURL: 'https://deepseek.example.test',
      model: 'deepseek-v4-pro'
    },
    {
      createClient: config => {
        assert.equal(config.apiKey, 'test-key');
        assert.equal(config.baseURL, 'https://deepseek.example.test');
        return {
          chat: {
            completions: {
              create: async (request: { model: string }) => {
                requests.push(request);
                return {
                  choices: [{
                    message: {
                      content: JSON.stringify({
                        summary: 'Plan',
                        steps: [],
                        assumptions: []
                      })
                    }
                  }]
                };
              }
            }
          }
        } as unknown as OpenAI;
      }
    }
  );

  await client.generatePlan({ context });

  assert.equal(requests[0].model, 'deepseek-v4-pro');
});
```

- [x] **Step 5: Run the production-adapter test to verify it fails**

Run:

```bash
node --import tsx --test --test-name-pattern="production model client" apps/server/src/agent/modelClient.test.ts
```

Expected: FAIL because `createProductionModelClient` still accepts
`apiKey, model` and constructs an OpenAI client directly.

- [x] **Step 6: Connect the Agent adapter to the shared provider**

In `apps/server/src/agent/modelClient.ts`, import:

```ts
import {
  createDeepSeekClient,
  DeepSeekConfig
} from '../services/modelProvider';
```

Replace the production creator with a config-based creator:

```ts
interface ProductionModelClientDependencies {
  createClient?: Parameters<typeof createDeepSeekClient>[1];
}

export const createProductionModelClient = (
  config: DeepSeekConfig,
  dependencies: ProductionModelClientDependencies = {}
): ModelClient => {
  const client = createDeepSeekClient(config, dependencies.createClient);

  return createOpenAIModelClient({
    model: config.model,
    createCompletion: async request =>
      client.chat.completions.create(request) as Promise<CompletionResponse>
  });
};
```

Do not widen the orchestration-facing `ModelClient` interface.

- [x] **Step 7: Update the production worker bootstrap**

In `apps/server/src/worker.ts`, import:

```ts
import { getDeepSeekConfig } from './services/modelProvider';
```

Replace the current production-client construction with:

```ts
const providerConfig = getDeepSeekConfig();
const modelClient = createProductionModelClient({
  ...providerConfig,
  model: config.model
});
```

The smoke worker remains unchanged.

- [x] **Step 8: Run Agent tests, type-check, and build**

Run:

```bash
node --import tsx --test apps/server/src/agent/config.test.ts apps/server/src/agent/modelClient.test.ts
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: all focused tests PASS; type-check and build exit with code 0.

- [x] **Step 9: Commit the Agent integration**

```bash
git add apps/server/src/agent/config.ts apps/server/src/agent/config.test.ts apps/server/src/agent/modelClient.ts apps/server/src/agent/modelClient.test.ts apps/server/src/worker.ts
git commit -m "feat: run agent worker with DeepSeek"
```

### Task 3: Legacy Chat DeepSeek Integration

**Files:**
- Create: `apps/server/src/services/aiService.test.ts`
- Modify: `apps/server/src/services/aiService.ts`

- [x] **Step 1: Write failing legacy-service tests**

Create `apps/server/src/services/aiService.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateChatTitle,
  generateCode,
  AIServiceDependencies
} from './aiService';

const createDependencies = (
  responses: string[]
): {
  dependencies: AIServiceDependencies;
  requests: Array<Record<string, unknown>>;
} => {
  const requests: Array<Record<string, unknown>> = [];

  return {
    requests,
    dependencies: {
      model: 'deepseek-v4-flash',
      createCompletion: async request => {
        requests.push(request);
        return {
          choices: [{
            message: { content: responses.shift() || '' }
          }]
        };
      }
    }
  };
};

test('generateCode uses the configured DeepSeek model', async () => {
  const { dependencies, requests } = createDependencies([
    '```tsx:src/App.tsx\nexport default function App() { return <main />; }\n```'
  ]);

  const result = await generateCode(
    [{
      id: 'message-1',
      role: 'user',
      content: 'Build an app',
      createdAt: new Date()
    }],
    {},
    dependencies
  );

  assert.equal(requests[0].model, 'deepseek-v4-flash');
  assert.equal(result.codeBlocks[0].fileName, 'src/App.tsx');
});

test('generateChatTitle uses the configured DeepSeek model', async () => {
  const { dependencies, requests } = createDependencies(['Task Dashboard']);

  const title = await generateChatTitle('Build tasks', dependencies);

  assert.equal(title, 'Task Dashboard');
  assert.equal(requests[0].model, 'deepseek-v4-flash');
});

test('generateChatTitle preserves the fallback on provider failure', async () => {
  const title = await generateChatTitle('Build tasks', {
    model: 'deepseek-v4-flash',
    createCompletion: async () => {
      throw new Error('provider detail');
    }
  });

  assert.equal(title, 'New Chat');
});
```

- [x] **Step 2: Run the legacy-service tests to verify they fail**

Run:

```bash
node --import tsx --test apps/server/src/services/aiService.test.ts
```

Expected: FAIL because `AIServiceDependencies` and dependency parameters do not
exist.

- [x] **Step 3: Replace the module-level client with lazy DeepSeek dependencies**

In `apps/server/src/services/aiService.ts`, remove the direct `OpenAI` import
and module-level `openai` instance. Add:

```ts
import {
  createDeepSeekClient,
  getDeepSeekConfig
} from './modelProvider';

interface CompletionResponse {
  choices: Array<{
    message: { content: string | null };
  }>;
}

export interface AIServiceDependencies {
  model: string;
  createCompletion(
    request: Record<string, unknown>
  ): Promise<CompletionResponse>;
}

const createDefaultDependencies = (): AIServiceDependencies => {
  const config = getDeepSeekConfig();
  const client = createDeepSeekClient(config);

  return {
    model: config.model,
    createCompletion: async request =>
      client.chat.completions.create(
        request as Parameters<typeof client.chat.completions.create>[0]
      ) as unknown as Promise<CompletionResponse>
  };
};
```

Change the `generateCode` signature:

```ts
export const generateCode = async (
  messages: IMessage[],
  options: GenerateCodeOptions = {},
  dependencies: AIServiceDependencies = createDefaultDependencies()
): Promise<{ content: string; codeBlocks: ICodeBlock[] }> => {
```

Replace its completion call with:

```ts
const response = await dependencies.createCompletion({
  model: dependencies.model,
  messages: formattedMessages,
  temperature: 0.7,
  max_tokens: 4000
});
```

Change the title signature:

```ts
export const generateChatTitle = async (
  firstMessage: string,
  dependencies: AIServiceDependencies = createDefaultDependencies()
): Promise<string> => {
```

Replace its completion call with:

```ts
const response = await dependencies.createCompletion({
  model: dependencies.model,
  messages: [
    {
      role: 'system',
      content: 'Generate a short, concise title (max 5 words) for a chat based on the user input. Return only the title.'
    },
    { role: 'user', content: firstMessage }
  ],
  temperature: 0.7,
  max_tokens: 20
});
```

Keep the existing code-block extraction, dependency extraction, error mapping,
and `New Chat` fallback.

- [x] **Step 4: Run service tests and all server unit tests**

Run:

```bash
node --import tsx --test apps/server/src/services/aiService.test.ts
npm test --workspace @v0/server
npm run type-check --workspace @v0/server
```

Expected: legacy-service tests PASS, all server unit tests PASS, and type-check
exits with code 0. No network request is made because tests inject completions.

- [x] **Step 5: Commit the legacy integration**

```bash
git add apps/server/src/services/aiService.ts apps/server/src/services/aiService.test.ts
git commit -m "feat: run legacy chat with DeepSeek"
```

### Task 4: Operating Documentation

**Files:**
- Modify: `README.md`

- [x] **Step 1: Update provider naming and environment variables**

Replace `OpenAI API / Claude API (AI 代码生成)` with:

```markdown
- DeepSeek API（AI 代码生成）
```

Replace the backend environment example with:

```dotenv
# 后端 (.env)
PORT=3001
MONGODB_URI=mongodb://localhost:27017/v0-by-kimi
JWT_SECRET=your-secret-key
DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
# 可选：只覆盖 Agent Worker 使用的模型
AGENT_MODEL=
```

- [x] **Step 2: Document real and deterministic workers**

Add after the environment section:

````markdown
## Agent Worker

生产 Worker 使用真实 DeepSeek API 和真实项目校验：

```bash
npm run build --workspace @v0/server
npm run start:worker --workspace @v0/server
```

`DEEPSEEK_MODEL` 默认是 `deepseek-v4-flash`。如需更高质量，可设置为
`deepseek-v4-pro`；`AGENT_MODEL` 只覆盖 Agent Worker。

Smoke Worker 使用确定性的 FakeModelClient，不调用 DeepSeek，也不会产生模型费用：

```bash
npm run build --workspace @v0/server
npm run start:smoke-worker --workspace @v0/server
```

不要把 `DEEPSEEK_API_KEY` 提交到 Git。
````

- [x] **Step 3: Check documentation and stale OpenAI configuration**

Run:

```bash
rg -n "OPENAI_API_KEY|gpt-4|OpenAI API|Claude API" README.md apps/server/src
git diff --check
```

Expected: `rg` returns no stale production configuration or model names;
`git diff --check` exits with code 0.

- [x] **Step 4: Commit the documentation**

```bash
git add README.md
git commit -m "docs: document DeepSeek worker configuration"
```

### Task 5: Full Verification and Optional Real-API Check

**Files:**
- Modify only if verification exposes an implementation defect.

- [x] **Step 1: Run the complete server verification suite**

Run:

```bash
npm test --workspace @v0/server
npm run test:integration --workspace @v0/server
npm run type-check --workspace @v0/server
npm run build --workspace @v0/server
```

Expected: all unit and integration tests PASS; type-check and build exit with
code 0.

- [x] **Step 2: Run the deterministic end-to-end smoke test**

Run:

```bash
npm run test:smoke
```

Expected: API and browser smoke checks PASS using `start:smoke-worker`; no
DeepSeek request is made.

- [x] **Step 3: Review the final diff and history**

Run:

```bash
git status --short
git diff --check
git log -5 --oneline
rg -n "OPENAI_API_KEY|gpt-4|gpt-3\\.5" README.md apps/server/src
```

Expected: worktree is clean after task commits, diff check passes, and no stale
OpenAI credentials or model names remain in production paths.

- [x] **Step 4: Optionally verify the official API with user-provided credentials**

Only when `DEEPSEEK_API_KEY` is already available in the local environment,
start the real worker without printing the key:

```bash
npm run start:worker --workspace @v0/server
```

Submit one generation from the browser and verify:

- the Run reaches `completed`;
- the active snapshot contains generated files;
- the Sandpack preview renders the generated application;
- the worker log contains completion and no provider error.

Do not run this step when credentials are absent, do not echo the environment,
and do not commit any `.env` file.

## Execution Results

- Tasks 1–4 were implemented and committed locally.
- Server verification passed: 79 unit tests, 4 integration tests, type-check,
  and production build.
- The API and Playwright browser smoke passed with the deterministic Smoke
  Worker on alternate ports because the retained manual stack owns the default
  smoke ports.
- Compose configuration discovered during smoke verification was updated to
  pass DeepSeek variables to both Server and Worker.
- The optional real-API check was safely skipped because
  `DEEPSEEK_API_KEY` was not present in the local process environment.
