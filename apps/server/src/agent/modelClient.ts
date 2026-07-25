import OpenAI from 'openai';
import { z } from 'zod';
import {
  AgentPlan,
  GenerateInput,
  GenerationResult,
  ModelClient,
  ModelResult,
  ModelUsage,
  PlanInput,
  RepairInput
} from './types';
import { agentPlanSchema, generationResultSchema } from './schemas';
import {
  createDeepSeekClient,
  DeepSeekConfig
} from '../services/modelProvider';

interface CompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user';
    content: string;
  }>;
  response_format: { type: 'json_object' };
  temperature: number;
}

interface CompletionResponse {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAIModelClientOptions {
  model: string;
  createCompletion(request: CompletionRequest): Promise<CompletionResponse>;
}

const sharedSystemInstruction = `You are the generation engine for a React application builder.
Only produce React functional components written in TypeScript/TSX and styled with Tailwind CSS.
The target is a Vite browser application. Never produce Vue, Svelte, JavaScript-only, binary, or server files.
Return one JSON object only. Do not wrap JSON in markdown.`;

const planSystemInstruction = `${sharedSystemInstruction}
Plan the smallest coherent implementation. Return:
{"summary":"...","steps":[{"title":"...","intent":"...","filesLikelyTouched":["src/App.tsx"]}],"assumptions":["..."]}`;

const generationSystemInstruction = `${sharedSystemInstruction}
Generate complete file contents using relative project paths with extensions ts, tsx, css, json, html, or md.
Do not return scripts or shell commands. Return:
{"message":"...","operations":[{"type":"create|update","path":"src/App.tsx","content":"..."}],"dependencies":{},"devDependencies":{}}`;

const repairSystemInstruction = `${sharedSystemInstruction}
Repair the provided validation failures with the smallest set of complete-file operations.
Use the diagnostics as evidence. Do not return commands or change server-owned scripts. Return:
{"message":"...","operations":[{"type":"update","path":"src/App.tsx","content":"..."}],"dependencies":{},"devDependencies":{}}`;

const modelError = (code: string, message: string): Error & { code: string } =>
  Object.assign(new Error(message), { code });

const normalizeUsage = (response: CompletionResponse): ModelUsage | undefined =>
  response.usage ? {
    inputTokens: response.usage.prompt_tokens,
    outputTokens: response.usage.completion_tokens,
    totalTokens: response.usage.total_tokens
  } : undefined;

const parseResponse = <T>(
  response: CompletionResponse,
  schema: z.ZodType<T>
): ModelResult<T> => {
  const content = response.choices[0]?.message.content;

  if (!content) {
    throw modelError('INVALID_MODEL_OUTPUT', 'Model returned an empty response');
  }

  try {
    return {
      value: schema.parse(JSON.parse(content)),
      usage: normalizeUsage(response)
    };
  } catch {
    throw modelError('INVALID_MODEL_OUTPUT', 'Model returned invalid structured output');
  }
};

export const createOpenAIModelClient = (
  options: OpenAIModelClientOptions
): ModelClient => {
  const request = async <T>(
    systemInstruction: string,
    input: unknown,
    schema: z.ZodType<T>
  ): Promise<ModelResult<T>> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: CompletionResponse;

      try {
        response = await options.createCompletion({
          model: options.model,
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: JSON.stringify(input) }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2
        });
      } catch {
        throw modelError('MODEL_REQUEST_FAILED', 'Model request failed');
      }

      try {
        return parseResponse(response, schema);
      } catch (error) {
        if (attempt === 1) {
          throw error;
        }
      }
    }

    throw modelError('INVALID_MODEL_OUTPUT', 'Model returned invalid structured output');
  };

  return {
    generatePlan: (input: PlanInput): Promise<ModelResult<AgentPlan>> =>
      request(planSystemInstruction, input, agentPlanSchema),
    generateFiles: (input: GenerateInput): Promise<ModelResult<GenerationResult>> =>
      request(generationSystemInstruction, input, generationResultSchema),
    repairFiles: (input: RepairInput): Promise<ModelResult<GenerationResult>> =>
      request(repairSystemInstruction, input, generationResultSchema)
  };
};

export const createProductionModelClient = (
  config: DeepSeekConfig,
  dependencies: {
    createClient?: Parameters<typeof createDeepSeekClient>[1];
  } = {}
): ModelClient => {
  const client = createDeepSeekClient(config, dependencies.createClient);

  return createOpenAIModelClient({
    model: config.model,
    createCompletion: async request =>
      client.chat.completions.create(request) as Promise<CompletionResponse>
  });
};
