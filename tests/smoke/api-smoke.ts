import assert from 'node:assert/strict';

const apiUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:43001';

const requestJson = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`${apiUrl}${path}`, init);
  const body = await response.json() as unknown;
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} failed ${response.status}: ${JSON.stringify(body)}`
    );
  }
  return body as T;
};

const jsonRequest = (
  method: string,
  body: unknown,
  token?: string
): RequestInit => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  body: JSON.stringify(body)
});

interface RunDetail {
  run: {
    _id: string;
    status: string;
    resultSnapshotId?: string;
  };
}

const waitForTerminalRun = async (
  runId: string,
  token: string
): Promise<RunDetail> => {
  const deadline = Date.now() + 30_000;
  let detail = await requestJson<RunDetail>(
    `/api/agent/runs/${runId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  while (
    Date.now() < deadline &&
    !['completed', 'failed', 'cancelled'].includes(detail.run.status)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    detail = await requestJson<RunDetail>(
      `/api/agent/runs/${runId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  return detail;
};

const main = async (): Promise<void> => {
  const unique = `${Date.now()}-${crypto.randomUUID()}`;
  const registered = await requestJson<{ token: string }>('/api/auth/register', jsonRequest(
    'POST',
    {
      email: `phase6-${unique}@v0.local`,
      password: 'phase6-password',
      name: 'Phase 6 Smoke'
    }
  ));
  const token = registered.token;
  const projectResponse = await requestJson<{ project: { _id: string } }>(
    '/api/projects',
    jsonRequest('POST', {
      name: `Phase 6 ${unique}`,
      settings: {
        framework: 'react',
        styling: 'tailwind',
        uiLibrary: 'shadcn'
      }
    }, token)
  );
  const projectId = projectResponse.project._id;
  const chatResponse = await requestJson<{ chat: { _id: string } }>(
    '/api/chat',
    jsonRequest('POST', {
      projectId,
      titleSeed: `Build deterministic smoke dashboard ${unique}`
    }, token)
  );
  const chatId = chatResponse.chat._id;
  const created = await requestJson<RunDetail>(
    '/api/agent/runs',
    jsonRequest('POST', {
      projectId,
      chatId,
      prompt: `Build deterministic smoke dashboard ${unique}`,
      mode: 'create'
    }, token)
  );

  const detail = await waitForTerminalRun(created.run._id, token);
  if (detail.run.status !== 'completed') {
    throw new Error(`Agent Run did not complete: ${JSON.stringify(detail)}`);
  }

  assert.ok(detail.run.resultSnapshotId, 'completed Run must reference a result Snapshot');
  const snapshotId = detail.run.resultSnapshotId;
  const snapshotResponse = await requestJson<{
    snapshot: {
      _id: string;
      files: Array<{ path: string }>;
      validation: { status: string };
    };
  }>(
    `/api/projects/${projectId}/snapshots/${snapshotId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const listed = await requestJson<{
    snapshots: Array<{ id: string; isActive: boolean }>;
  }>(
    `/api/projects/${projectId}/snapshots`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  assert.equal(snapshotResponse.snapshot.validation.status, 'passed');
  assert.ok(snapshotResponse.snapshot.files.some((file) => file.path === 'src/App.tsx'));
  assert.ok(listed.snapshots.some((snapshot) =>
    snapshot.id === snapshotId && snapshot.isActive
  ));

  const edited = await requestJson<RunDetail>(
    '/api/agent/runs',
    jsonRequest('POST', {
      projectId,
      chatId,
      prompt: `Add deterministic activity section ${unique}`,
      mode: 'edit'
    }, token)
  );
  const editedDetail = await waitForTerminalRun(edited.run._id, token);
  assert.equal(editedDetail.run.status, 'completed');

  const persistedChat = await requestJson<{
    chat: { messages: Array<{ role: string }> };
  }>(
    `/api/chat/${chatId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.deepEqual(
    persistedChat.chat.messages.map((message) => message.role),
    ['user', 'assistant', 'user', 'assistant']
  );

  console.log(JSON.stringify({
    ok: true,
    projectId,
    chatId,
    runId: created.run._id,
    snapshotId,
    editRunId: edited.run._id,
    editSnapshotId: editedDetail.run.resultSnapshotId
  }));
};

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
