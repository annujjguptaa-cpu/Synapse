import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Set test environment variables before requiring server
process.env.PORT = '4005';
process.env.SYNAPSE_API_KEYS = 'test-valid-key,test-proj:scoped-key';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://localhost:3000';
process.env.DASHBOARD_AUTH_REQUIRED = 'false';

const { app, server, externalAgents, externalApprovals } = await import('../backend/synapse-observatory/server/index.js');

let baseUrl;

describe('Synapse External Agent API & Security', () => {
  before(async () => {
    await new Promise((resolve) => {
      server.listen(4005, () => {
        baseUrl = 'http://localhost:4005';
        resolve();
      });
    });
  });

  after(() => {
    server.close();
  });

  it('GET /api/v1/health should return 200 with version and ok: true', async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.version, 'string');
  });

  it('POST /api/v1/events rejects requests without x-synapse-key with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'test', agentId: 'agent1', status: 'PROCESSING' })
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/v1/events rejects invalid API key with 401', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-synapse-key': 'wrong-key-value'
      },
      body: JSON.stringify({ projectId: 'test', agentId: 'agent1', status: 'PROCESSING' })
    });
    assert.equal(res.status, 401);
  });

  it('POST /api/v1/events rejects invalid body missing agentId with 400', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-synapse-key': 'test-valid-key'
      },
      body: JSON.stringify({ projectId: 'test' })
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/v1/events accepts valid event, returns 202 with ok, hrs, and control', async () => {
    const res = await fetch(`${baseUrl}/api/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-synapse-key': 'test-valid-key'
      },
      body: JSON.stringify({
        projectId: 'proj_alpha',
        agentId: 'ext_search_1',
        agentName: 'Searcher',
        role: 'Researcher',
        status: 'PROCESSING',
        task: 'Scraping web articles',
        tokensIn: 500,
        tokensOut: 200,
        costUsd: 0.004,
        latencyMs: 150,
        confidence: 0.95,
        output: 'Processed 5 articles cleanly'
      })
    });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.hrs, 'number');
    assert.equal(body.control, 'running');
  });

  it('GET /api/v1/agents returns the registered external agent', async () => {
    const res = await fetch(`${baseUrl}/api/v1/agents?projectId=proj_alpha`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.agents));
    const found = body.agents.find(a => a.agentId === 'ext_search_1');
    assert.ok(found, 'Should find ext_search_1');
    assert.equal(found.role, 'Researcher');
  });

  it('GET /api/v1/agents/:agentId/control returns current state', async () => {
    const res = await fetch(`${baseUrl}/api/v1/agents/ext_search_1/control?projectId=proj_alpha`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.state, 'running');
  });

  it('POST /api/kill/:agentId updates external agent control state to killed', async () => {
    const res = await fetch(`${baseUrl}/api/kill/ext_search_1`, { method: 'POST' });
    assert.equal(res.status, 200);

    const controlRes = await fetch(`${baseUrl}/api/v1/agents/ext_search_1/control?projectId=proj_alpha`);
    const controlBody = await controlRes.json();
    assert.equal(controlBody.state, 'killed');
  });

  it('POST /api/resume/:agentId resumes external agent to running', async () => {
    // First pause it
    await fetch(`${baseUrl}/api/pause/ext_search_1`, { method: 'POST' });
    let controlRes = await fetch(`${baseUrl}/api/v1/agents/ext_search_1/control?projectId=proj_alpha`);
    let controlBody = await controlRes.json();
    assert.equal(controlBody.state, 'paused');

    // Now resume
    const res = await fetch(`${baseUrl}/api/resume/ext_search_1`, { method: 'POST' });
    assert.equal(res.status, 200);
    controlRes = await fetch(`${baseUrl}/api/v1/agents/ext_search_1/control?projectId=proj_alpha`);
    controlBody = await controlRes.json();
    assert.equal(controlBody.state, 'running');
  });

  it('POST /api/v1/approvals creates a pending approval and allows decision', async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/approvals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-synapse-key': 'test-valid-key'
      },
      body: JSON.stringify({
        projectId: 'proj_alpha',
        agentId: 'ext_search_1',
        action: 'Execute Wire Transfer',
        amount: 5000,
        reason: 'Payment to vendor'
      })
    });
    assert.equal(createRes.status, 201);
    const createBody = await createRes.json();
    assert.ok(createBody.approvalId);
    assert.equal(createBody.status, 'pending');

    // Check GET approval
    const getRes = await fetch(`${baseUrl}/api/v1/approvals/${createBody.approvalId}`);
    assert.equal(getRes.status, 200);
    const getBody = await getRes.json();
    assert.equal(getBody.status, 'pending');

    // Operator approves it
    const decideRes = await fetch(`${baseUrl}/api/v1/approvals/${createBody.approvalId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved' })
    });
    assert.equal(decideRes.status, 200);

    // Verify updated status
    const verifiedRes = await fetch(`${baseUrl}/api/v1/approvals/${createBody.approvalId}`);
    const verifiedBody = await verifiedRes.json();
    assert.equal(verifiedBody.status, 'approved');
  });
});
