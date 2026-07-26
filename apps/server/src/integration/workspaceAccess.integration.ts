import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import request from 'supertest';
import { createApp } from '../app';
import { generateToken } from '../middleware/auth';
import { User } from '../models/User';
import { Workspace } from '../models/Workspace';
import { WorkspaceMember } from '../models/WorkspaceMember';
import {
  createIntegrationEnvironment,
  type IntegrationEnvironment
} from '../testing/integrationEnvironment';

let environment: IntegrationEnvironment;
const app = createApp();

before(async () => {
  environment = await createIntegrationEnvironment();
});

beforeEach(async () => {
  await environment.reset();
});

after(async () => {
  await environment.close();
});

test('registration creates one default Workspace and an owner membership', async () => {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      email: 'owner@example.test',
      password: 'password',
      name: 'Owner'
    })
    .expect(201);

  const [workspace, membership] = await Promise.all([
    Workspace.findOne({ slug: 'default' }),
    WorkspaceMember.findOne({ userId: response.body.user.id })
  ]);

  assert.ok(workspace);
  assert.equal(membership?.workspaceId.toString(), workspace._id.toString());
  assert.equal(membership?.role, 'owner');
});

test('later users join the same default Workspace as members', async () => {
  for (const email of ['owner@example.test', 'member@example.test']) {
    await request(app)
      .post('/api/auth/register')
      .send({ email, password: 'password', name: 'User' })
      .expect(201);
  }

  assert.equal(await Workspace.countDocuments({ slug: 'default' }), 1);
  assert.deepEqual(
    (await WorkspaceMember.find().sort({ createdAt: 1 }))
      .map(member => member.role),
    ['owner', 'member']
  );
});

test('new Projects carry the authenticated users Workspace', async () => {
  const user = await User.create({
    email: 'project-owner@example.test',
    password: 'password',
    name: 'Owner'
  });
  const token = generateToken(user._id.toString());

  const response = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Workspace project' })
    .expect(201);

  const membership = await WorkspaceMember.findOne({ userId: user._id });
  assert.ok(membership);
  assert.equal(
    response.body.project.workspaceId,
    membership.workspaceId.toString()
  );
});

test('Project access requires both ownership and active membership', async () => {
  const user = await User.create({
    email: 'removed@example.test',
    password: 'password',
    name: 'Removed'
  });
  const token = generateToken(user._id.toString());
  const created = await request(app)
    .post('/api/projects')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Private project' })
    .expect(201);

  await WorkspaceMember.deleteOne({ userId: user._id });

  await request(app)
    .get(`/api/projects/${created.body.project._id}`)
    .set('Authorization', `Bearer ${token}`)
    .expect(404);
});
