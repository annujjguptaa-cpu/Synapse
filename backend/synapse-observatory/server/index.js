// ═══════════════════════════════════════════════════════════
// SYNAPSE OBSERVATORY — Backend Server
// Express + Socket.IO on port 4000
// Multi-mode: Simulation (ambient), Real AI, and External Agent Swarm Ingestion
// ═══════════════════════════════════════════════════════════

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');
const AgentSimulator = require('./agentSimulator');
const AIAgentOrchestrator = require('./AIAgentOrchestrator');
const { HallucinationScorer } = require('./HallucinationDetector');
const { logAgentEventToSupabase } = require('./supabase');

require('dotenv').config();

const PORT = process.env.PORT || 4000;
const app = express();
const server = http.createServer(app);

// ── Allowed Origins for CORS ──
const rawOrigins = process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000';
const allowedOrigins = rawOrigins.split(',').map(o => o.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. curl, Python SDK, server-to-server) or matched origins
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

app.use(cors(corsOptions));
// Body size limit for security
app.use(express.json({ limit: '1mb' }));

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by Socket.IO CORS`));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// ── Initialize All Engines ──
const scorer = new HallucinationScorer(io); // 3-Tier Hallucination Detection
// Load default behavioral contracts for the demo (Tier 2)
scorer.contracts.loadContracts([
  { agent: '*', rule: 'forbidden_words', words: ['test_error', 'unauthorized'], description: 'Must not leak system keywords' },
  { agent: 'beta', rule: 'range_check', field: 'confidence', min: 0, max: 100, description: 'Confidence must be percentage' }
]);
// Enable the Sandboxed Verifier (Tier 3) with configurable token
const verifierToken = process.env.SYNAPSE_VERIFIER_TOKEN || 'synapse-verifier-secret-token';
scorer.verifier.enable(verifierToken);

const simulator = new AgentSimulator(io, scorer); // Ambient simulation
const orchestrator = new AIAgentOrchestrator(io, scorer); // Real AI-powered scenarios

// ═══════════════════════════════════════════════════════════
// External Swarms State & In-Memory Registry
// ═══════════════════════════════════════════════════════════

/**
 * externalAgents: Map of compositeKey ("projectId:agentId") or agentId -> Agent Object
 */
const externalAgents = new Map();

/**
 * externalApprovals: Map of approvalId -> Approval Object
 */
const externalApprovals = new Map();

/**
 * Rate Limiter for Ingestion: sliding window per API key (100 req/min)
 */
const rateLimitWindowMs = 60 * 1000;
const rateLimitMax = 100;
const rateLimitTracker = new Map(); // apiKey -> array of timestamps

function checkRateLimit(key) {
  const now = Date.now();
  let timestamps = rateLimitTracker.get(key) || [];
  timestamps = timestamps.filter(ts => now - ts < rateLimitWindowMs);
  if (timestamps.length >= rateLimitMax) {
    rateLimitTracker.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimitTracker.set(key, timestamps);
  return true;
}

// ── API Key Authentication Middleware ──
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-synapse-key'];
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Missing x-synapse-key header' });
  }

  const rawConfigKeys = process.env.SYNAPSE_API_KEYS || 'synapse-test-key,default:demo-agent-key';
  const configuredKeys = rawConfigKeys.split(',').map(k => k.trim()).filter(Boolean);

  let isAuthorized = false;
  let keyProjectId = null;

  for (const entry of configuredKeys) {
    if (entry.includes(':')) {
      const colonIdx = entry.indexOf(':');
      const pId = entry.slice(0, colonIdx);
      const keyPart = entry.slice(colonIdx + 1);
      // Accept both "just-the-key" and "projectId:key" formats from the client
      if (keyPart === apiKey || entry === apiKey) {
        isAuthorized = true;
        keyProjectId = pId;
        break;
      }
    } else if (entry === apiKey) {
      isAuthorized = true;
      break;
    }
  }

  if (!isAuthorized) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid API key' });
  }

  if (!checkRateLimit(apiKey)) {
    return res.status(429).json({ ok: false, error: 'Too Many Requests: Rate limit exceeded (100 req/min)' });
  }

  req.authProjectId = keyProjectId;
  next();
}

// ── Dashboard Operator Authentication Middleware (Simple & Safe Option) ──
function authenticateDashboard(req, res, next) {
  const expectedToken = process.env.DASHBOARD_AUTH_TOKEN || 'synapse-dashboard-admin-token';
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : req.headers['x-dashboard-token'];

  // If no token requirement set or matches default in local development/demo
  if (!process.env.DASHBOARD_AUTH_REQUIRED || process.env.DASHBOARD_AUTH_REQUIRED === 'false') {
    return next();
  }

  if (!token || token !== expectedToken) {
    return res.status(401).json({ success: false, error: 'Unauthorized: Invalid dashboard credentials' });
  }
  next();
}

// ═══════════════════════════════════════════════════════════
// REST Endpoints — EXTERNAL AGENT API (v1)
// ═══════════════════════════════════════════════════════════

/**
 * 4) GET /api/v1/health -> { ok: true, version }
 */
app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0' });
});

/**
 * 1) POST /api/v1/events (header x-synapse-key required)
 */
app.post('/api/v1/events', authenticateApiKey, async (req, res) => {
  try {
    const {
      projectId,
      agentId,
      agentName,
      role,
      status,
      handoffTo,
      task,
      input,
      output,
      model,
      tokensIn,
      tokensOut,
      costUsd,
      latencyMs,
      confidence,
      metadata,
      timestamp,
    } = req.body;

    // Strict validation
    if (!projectId || typeof projectId !== 'string' || !projectId.trim()) {
      return res.status(400).json({ ok: false, error: 'Bad Request: "projectId" is required and must be a non-empty string' });
    }
    if (!agentId || typeof agentId !== 'string' || !agentId.trim()) {
      return res.status(400).json({ ok: false, error: 'Bad Request: "agentId" is required and must be a non-empty string' });
    }

    const VALID_STATUSES = ['IDLE', 'PROCESSING', 'COMPLETED', 'ERROR', 'WAITING_APPROVAL'];
    const normalizedStatus = typeof status === 'string' ? status.toUpperCase().trim() : 'PROCESSING';
    if (!VALID_STATUSES.includes(normalizedStatus)) {
      return res.status(400).json({
        ok: false,
        error: `Bad Request: "status" must be one of ${VALID_STATUSES.join(', ')}`,
      });
    }

    const compositeKey = `${projectId}:${agentId}`;
    let agent = externalAgents.get(compositeKey);
    const nowIso = timestamp || new Date().toISOString();

    if (!agent) {
      agent = {
        projectId,
        agentId,
        agentName: agentName || agentId,
        role: role || 'Agent',
        model: model || 'custom',
        status: normalizedStatus.toLowerCase(),
        controlState: 'running',
        totalTokensIn: 0,
        totalTokensOut: 0,
        totalCostUSD: 0,
        callCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        lastHRS: 0,
        lastHRSLevel: 'nominal',
        currentTask: task || '',
        lastInput: input || '',
        lastOutput: output || '',
        events: [],
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      externalAgents.set(compositeKey, agent);
    }

    // Update agent identity / metadata if provided
    if (agentName) agent.agentName = agentName;
    if (role) agent.role = role;
    if (model) agent.model = model;
    agent.status = normalizedStatus.toLowerCase();
    agent.currentTask = task || agent.currentTask;
    if (input !== undefined) agent.lastInput = input;
    if (output !== undefined) agent.lastOutput = output;
    agent.updatedAt = nowIso;

    const tIn = typeof tokensIn === 'number' && !isNaN(tokensIn) ? Math.max(0, tokensIn) : 0;
    const tOut = typeof tokensOut === 'number' && !isNaN(tokensOut) ? Math.max(0, tokensOut) : 0;
    const callCost = typeof costUsd === 'number' && !isNaN(costUsd) ? Math.max(0, costUsd) : 0;
    const callLatency = typeof latencyMs === 'number' && !isNaN(latencyMs) ? Math.max(0, latencyMs) : 0;
    const callConfidence = typeof confidence === 'number' && !isNaN(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.95;

    agent.totalTokensIn += tIn;
    agent.totalTokensOut += tOut;
    agent.totalCostUSD += callCost;
    agent.callCount += 1;
    agent.totalLatencyMs += callLatency;
    agent.avgLatencyMs = parseFloat((agent.totalLatencyMs / agent.callCount).toFixed(2));

    // Run HallucinationDetector (Tier 1 on telemetry, Tier 2 if contracts exist, Tier 3 if verifier verdict)
    const telemetryObj = {
      latencyMs: callLatency,
      costUSD: callCost,
      confidence: callConfidence,
      tokenCount: tIn + tOut,
    };
    const scoreResult = scorer.score(agentId, output || '', telemetryObj);
    const hrsScore = scoreResult.hrs;
    agent.lastHRS = hrsScore;
    agent.lastHRSLevel = scoreResult.level;

    // Auto-pause the agent if HRS exceeds the auto-pause threshold
    if (scoreResult.shouldPause || hrsScore >= scorer.THRESHOLD_AUTO_PAUSE) {
      agent.controlState = 'paused';
      agent.pauseReason = `Auto-pause: Hallucination Risk Score (${hrsScore}) exceeded threshold (${scorer.THRESHOLD_AUTO_PAUSE})`;
      console.warn(`[SAFETY] External Agent ${agentId} auto-paused! HRS: ${hrsScore}`);
    }

    // Store in per-agent event history (capped at last 200)
    const eventRecord = {
      id: `evt-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      projectId,
      agentId,
      agentName: agent.agentName,
      role: agent.role,
      status: normalizedStatus,
      task: task || '',
      input: input || '',
      output: output || '',
      model: agent.model,
      tokensIn: tIn,
      tokensOut: tOut,
      costUsd: callCost,
      latencyMs: callLatency,
      confidence: callConfidence,
      hrs: hrsScore,
      hrsLevel: scoreResult.level,
      handoffTo: handoffTo || null,
      metadata: metadata || null,
      timestamp: nowIso,
    };

    agent.events.push(eventRecord);
    if (agent.events.length > 200) {
      agent.events = agent.events.slice(-200);
    }

    // Emit to UI using existing socket event names with source: "external"
    // 1. agent:update
    const socketAgentUpdate = {
      agentId: agent.agentId,
      agentName: agent.agentName,
      role: agent.role,
      status: agent.controlState === 'killed' ? 'killed' : agent.controlState === 'paused' ? 'paused' : agent.status,
      controlState: agent.controlState,
      tokenUsage: {
        prompt: tIn,
        completion: tOut,
        total: tIn + tOut,
      },
      tokens: {
        in: agent.totalTokensIn,
        out: agent.totalTokensOut,
        total: agent.totalTokensIn + agent.totalTokensOut,
      },
      costUSD: callCost,
      cumulativeCostUSD: parseFloat(agent.totalCostUSD.toFixed(6)),
      currentTask: agent.currentTask,
      model: agent.model,
      latencyMs: callLatency,
      avgLatencyMs: agent.avgLatencyMs,
      confidenceScore: callConfidence,
      hrs: hrsScore,
      hrsLevel: scoreResult.level,
      reasoningChain: output ? [output.substring(0, 160)] : ['External telemetry event received'],
      timestamp: nowIso,
      source: 'external',
      projectId: agent.projectId,
      actions: agent.callCount,
    };
    io.emit('agent:update', socketAgentUpdate);

    // 2. activity event
    const activityPayload = {
      id: eventRecord.id,
      agentId: agent.agentId,
      agentName: agent.agentName,
      action: task || `Agent ${normalizedStatus}`,
      details: output || input || `Telemetry processed: ${tIn + tOut} tokens`,
      status: normalizedStatus.toLowerCase(),
      latencyMs: callLatency,
      costUSD: callCost,
      hrs: hrsScore,
      timestamp: nowIso,
      source: 'external',
      projectId: agent.projectId,
    };
    io.emit('activity', activityPayload);
    io.emit('live:activity', activityPayload);

    // 3. agent-handoff event if handoffTo provided
    if (handoffTo) {
      const handoffPayload = {
        from: agentId,
        fromName: agent.agentName,
        to: handoffTo,
        toName: externalAgents.get(`${projectId}:${handoffTo}`)?.agentName || handoffTo,
        reason: task || 'Handoff to downstream agent',
        timestamp: nowIso,
        source: 'external',
        projectId,
      };
      io.emit('agent-handoff', handoffPayload);
      io.emit('live:agent-handoff', handoffPayload);
    }

    // 4. If status is WAITING_APPROVAL, emit approval notification if not already handled
    if (normalizedStatus === 'WAITING_APPROVAL') {
      io.emit('agent:waiting-approval', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        projectId,
        task: agent.currentTask,
        timestamp: nowIso,
      });
    }

    // Persist to Supabase asynchronously if configured
    logAgentEventToSupabase({
      projectId,
      agentId,
      agentName: agent.agentName,
      role: agent.role,
      status: normalizedStatus,
      handoffTo,
      task,
      input,
      output,
      model: agent.model,
      tokensIn: tIn,
      tokensOut: tOut,
      costUsd: callCost,
      latencyMs: callLatency,
      confidence: callConfidence,
      hrs: hrsScore,
      metadata,
      timestamp: nowIso,
    }).catch(err => console.warn('[SUPABASE] Async persist error:', err.message));

    // Return 202 Accepted as specified
    return res.status(202).json({
      ok: true,
      hrs: hrsScore,
      control: agent.controlState,
    });
  } catch (err) {
    console.error('[API/EVENTS] Internal error:', err);
    return res.status(500).json({ ok: false, error: 'Internal Server Error' });
  }
});

/**
 * 2) GET /api/v1/agents/:agentId/control?projectId=...
 */
app.get('/api/v1/agents/:agentId/control', (req, res) => {
  const { agentId } = req.params;
  const { projectId } = req.query;

  let agent = null;
  if (projectId) {
    agent = externalAgents.get(`${projectId}:${agentId}`);
  } else {
    // Search across any matching agentId
    for (const [key, ag] of externalAgents.entries()) {
      if (ag.agentId === agentId) {
        agent = ag;
        break;
      }
    }
  }

  // Fallback to simulator if it is a simulated agent
  if (!agent && simulator.agents[agentId]) {
    const simStatus = simulator.agents[agentId].status;
    const state = simStatus === 'killed' ? 'killed' : simStatus === 'paused' ? 'paused' : 'running';
    return res.json({ state });
  }

  const state = agent ? agent.controlState : 'running';
  return res.json({ state });
});

/**
 * 3) POST /api/v1/approvals
 * Body: { projectId, agentId, action, amount, reason, details }
 */
app.post('/api/v1/approvals', authenticateApiKey, (req, res) => {
  const { projectId, agentId, action, amount, reason, details } = req.body;

  if (!projectId || !agentId || !action) {
    return res.status(400).json({ ok: false, error: 'Bad Request: projectId, agentId, and action are required' });
  }

  const approvalId = `appr-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const nowIso = new Date().toISOString();

  const approval = {
    id: approvalId,
    approvalId,
    projectId,
    agent: agentId,
    agentId,
    agentName: externalAgents.get(`${projectId}:${agentId}`)?.agentName || agentId,
    action,
    amount: amount || 0,
    reason: reason || action,
    details: details || {},
    status: 'pending',
    createdAt: nowIso,
    decidedAt: null,
    source: 'external',
  };

  externalApprovals.set(approvalId, approval);

  // Set agent status to WAITING_APPROVAL in registry & emit update
  const compositeKey = `${projectId}:${agentId}`;
  const agent = externalAgents.get(compositeKey);
  if (agent) {
    agent.status = 'waiting_approval';
    io.emit('agent:update', {
      agentId: agent.agentId,
      agentName: agent.agentName,
      status: 'waiting_approval',
      controlState: agent.controlState,
      currentTask: `Waiting for approval: ${action}`,
      timestamp: nowIso,
      source: 'external',
      projectId: agent.projectId,
    });
  }

  // Emit to UI
  io.emit('approval-added', approval);
  io.emit('live:approval-added', approval);

  return res.status(201).json({ approvalId, status: 'pending' });
});

/**
 * GET /api/v1/approvals/:id
 */
app.get('/api/v1/approvals/:id', (req, res) => {
  const { id } = req.params;
  const approval = externalApprovals.get(id);

  if (!approval) {
    return res.status(404).json({ ok: false, error: `Approval with id "${id}" not found` });
  }

  return res.json({
    status: approval.status,
    decidedAt: approval.decidedAt,
  });
});

/**
 * POST /api/v1/approvals/:id/decision
 * Operator approval/rejection endpoint called from dashboard UI
 */
app.post('/api/v1/approvals/:id/decision', authenticateDashboard, (req, res) => {
  const { id } = req.params;
  const { decision } = req.body; // 'approved' | 'rejected'

  const approval = externalApprovals.get(id);
  if (!approval) {
    return res.status(404).json({ ok: false, error: `Approval "${id}" not found` });
  }

  const normalizedDecision = decision === 'approved' ? 'approved' : 'rejected';
  approval.status = normalizedDecision;
  approval.decidedAt = new Date().toISOString();

  // Resume agent status if waiting
  const compositeKey = `${approval.projectId}:${approval.agentId}`;
  const agent = externalAgents.get(compositeKey);
  if (agent && agent.status === 'waiting_approval') {
    agent.status = 'processing';
    io.emit('agent:update', {
      agentId: agent.agentId,
      agentName: agent.agentName,
      status: 'processing',
      controlState: agent.controlState,
      currentTask: `Approval ${normalizedDecision}. Resuming operations.`,
      timestamp: approval.decidedAt,
      source: 'external',
      projectId: agent.projectId,
    });
  }

  io.emit('approval-decided', approval);
  io.emit('live:approval-decided', approval);

  return res.json({ ok: true, approval });
});

/**
 * 5) GET /api/v1/agents
 * List of known external agents with latest status, totals, and last HRS
 */
app.get('/api/v1/agents', (req, res) => {
  const { projectId } = req.query;
  const agentsList = [];

  for (const agent of externalAgents.values()) {
    if (!projectId || agent.projectId === projectId) {
      agentsList.push({
        projectId: agent.projectId,
        agentId: agent.agentId,
        agentName: agent.agentName,
        role: agent.role,
        model: agent.model,
        status: agent.status,
        controlState: agent.controlState,
        totalTokens: agent.totalTokensIn + agent.totalTokensOut,
        totalCostUSD: parseFloat(agent.totalCostUSD.toFixed(6)),
        callCount: agent.callCount,
        avgLatencyMs: agent.avgLatencyMs,
        lastHRS: agent.lastHRS,
        lastHRSLevel: agent.lastHRSLevel,
        currentTask: agent.currentTask,
        updatedAt: agent.updatedAt,
      });
    }
  }

  return res.json({ agents: agentsList, count: agentsList.length });
});

// ═══════════════════════════════════════════════════════════
// Operator Control Endpoints (Simulator + External Agents)
// ═══════════════════════════════════════════════════════════

app.post('/api/kill/:agentId', authenticateDashboard, (req, res) => {
  const { agentId } = req.params;
  let handled = false;

  // 1. Check simulator
  if (simulator.killAgent(agentId)) {
    handled = true;
  }

  // 2. Check external agents
  for (const agent of externalAgents.values()) {
    if (agent.agentId === agentId) {
      agent.controlState = 'killed';
      agent.status = 'killed';
      io.emit('agent:update', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: 'killed',
        controlState: 'killed',
        currentTask: 'TERMINATED by operator switch',
        source: 'external',
        projectId: agent.projectId,
        timestamp: new Date().toISOString(),
      });
      handled = true;
    }
  }

  if (handled) {
    res.json({ success: true, message: `Agent ${agentId} terminated.` });
  } else {
    res.status(404).json({ success: false, message: `Agent ${agentId} not found.` });
  }
});

app.post('/api/pause/:agentId', authenticateDashboard, (req, res) => {
  const { agentId } = req.params;
  let handled = false;

  if (simulator.pauseAgent(agentId, 'Paused by operator')) {
    handled = true;
  }

  for (const agent of externalAgents.values()) {
    if (agent.agentId === agentId) {
      agent.controlState = 'paused';
      agent.status = 'paused';
      io.emit('agent:update', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: 'paused',
        controlState: 'paused',
        currentTask: 'PAUSED by operator',
        source: 'external',
        projectId: agent.projectId,
        timestamp: new Date().toISOString(),
      });
      handled = true;
    }
  }

  if (handled) {
    res.json({ success: true, message: `Agent ${agentId} paused.` });
  } else {
    res.status(404).json({ success: false, message: `Agent ${agentId} not found.` });
  }
});

app.post('/api/resume/:agentId', authenticateDashboard, (req, res) => {
  const { agentId } = req.params;
  let handled = false;

  if (simulator.resumeAgent(agentId)) {
    handled = true;
  }

  for (const agent of externalAgents.values()) {
    if (agent.agentId === agentId) {
      agent.controlState = 'running';
      agent.status = 'idle';
      io.emit('agent:update', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: 'idle',
        controlState: 'running',
        currentTask: 'Resuming operations...',
        source: 'external',
        projectId: agent.projectId,
        timestamp: new Date().toISOString(),
      });
      handled = true;
    }
  }

  if (handled) {
    res.json({ success: true, message: `Agent ${agentId} resumed.` });
  } else {
    res.status(404).json({ success: false, message: `Agent ${agentId} not found or not paused.` });
  }
});

app.post('/api/restart/:agentId', authenticateDashboard, (req, res) => {
  const { agentId } = req.params;
  let handled = false;

  if (simulator.restartAgent(agentId)) {
    handled = true;
  }

  for (const agent of externalAgents.values()) {
    if (agent.agentId === agentId) {
      agent.controlState = 'running';
      agent.status = 'idle';
      io.emit('agent:update', {
        agentId: agent.agentId,
        agentName: agent.agentName,
        status: 'idle',
        controlState: 'running',
        currentTask: 'Reinitialized by operator',
        source: 'external',
        projectId: agent.projectId,
        timestamp: new Date().toISOString(),
      });
      handled = true;
    }
  }

  if (handled) {
    res.json({ success: true, message: `Agent ${agentId} restarted.` });
  } else {
    res.status(404).json({ success: false, message: `Agent ${agentId} not found.` });
  }
});

app.post('/api/kill-all', authenticateDashboard, (req, res) => {
  simulator.killAll();
  for (const agent of externalAgents.values()) {
    agent.controlState = 'killed';
    agent.status = 'killed';
    io.emit('agent:update', {
      agentId: agent.agentId,
      agentName: agent.agentName,
      status: 'killed',
      controlState: 'killed',
      source: 'external',
      projectId: agent.projectId,
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ success: true, message: 'All agents terminated. Swarm offline.' });
});

app.post('/api/restart-all', authenticateDashboard, (req, res) => {
  simulator.restartAll();
  for (const agent of externalAgents.values()) {
    agent.controlState = 'running';
    agent.status = 'idle';
    io.emit('agent:update', {
      agentId: agent.agentId,
      agentName: agent.agentName,
      status: 'idle',
      controlState: 'running',
      source: 'external',
      projectId: agent.projectId,
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ success: true, message: 'Full system restart initiated.' });
});

app.post('/api/demo/trigger-rogue', (req, res) => {
  simulator.triggerRogue();
  res.json({ success: true, message: 'Demo rogue event triggered.' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json(simulator.getStatus());
});

// ═══════════════════════════════════════════════════════════
// REST Endpoints — Hallucination Detection (3-Tier)
// ═══════════════════════════════════════════════════════════

app.get('/api/hallucination/config', (req, res) => {
  res.json({
    tiers: {
      t1: { name: 'Mathematical Reasoning', active: true, accuracy: '~75-85%', description: 'Telemetry-only analysis. Always on. Zero company data needed.' },
      t2: { name: 'Behavioral Contracts', active: scorer.contracts.enabled, accuracy: '~92-95%', description: 'Company-defined validation rules. No raw data shared.' },
      t3: { name: 'Sandboxed Verifier', active: scorer.verifier.enabled, accuracy: '~99%+', description: 'Verifier runs on company infra. Only pass/fail verdicts sent.' },
    },
    thresholds: {
      warning: scorer.THRESHOLD_WARNING,
      critical: scorer.THRESHOLD_CRITICAL,
      autoPause: scorer.THRESHOLD_AUTO_PAUSE,
    },
    contracts: scorer.contracts.getContracts(),
  });
});

app.post('/api/hallucination/contracts', authenticateDashboard, (req, res) => {
  const { contracts } = req.body;
  if (!Array.isArray(contracts)) {
    return res.status(400).json({ success: false, error: 'contracts must be an array' });
  }
  scorer.contracts.loadContracts(contracts);
  res.json({ success: true, loaded: contracts.length, message: `Loaded ${contracts.length} behavioral contracts.` });
});

app.post('/api/hallucination/verifier/enable', authenticateDashboard, (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, error: 'Token is required to enable the verifier.' });
  }
  scorer.verifier.enable(token);
  res.json({ success: true, message: 'Verifier receiver enabled. Awaiting verdicts from your local Verifier Agent.' });
});

app.post('/api/hallucination/verdict', (req, res) => {
  const token = req.headers['x-verifier-token'];
  const result = scorer.verifier.receiveVerdict(token, req.body);
  if (!result.accepted) {
    return res.status(result.error === 'Invalid verifier token' ? 401 : 400).json(result);
  }
  const agentId = req.body.agentId;
  const rescored = scorer.score(agentId, '', { latencyMs: 0, costUSD: 0, confidence: 0.9, tokenCount: 0 });
  res.json({ accepted: true, hrs: rescored.hrs, level: rescored.level });
});

app.get('/api/hallucination/history/:agentId', (req, res) => {
  res.json({ history: scorer.getHistory(req.params.agentId) });
});

// ═══════════════════════════════════════════════════════════
// REST Endpoints — REAL AI Scenarios
// ═══════════════════════════════════════════════════════════

app.post('/api/ai/scenario', async (req, res) => {
  let { scenarioId, apiKey } = req.body;
  if (!apiKey) apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ success: false, error: 'Gemini API key is required. Set it in Settings.' });
  if (!scenarioId) return res.status(400).json({ success: false, error: 'scenarioId is required.' });

  if (orchestrator.isRunning) {
    return res.status(409).json({ success: false, error: 'A scenario is already running. Wait for it to complete.' });
  }

  try {
    const result = await orchestrator.runScenario(scenarioId, apiKey);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/ai/custom', async (req, res) => {
  let { prompt, apiKey } = req.body;
  if (!apiKey) apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ success: false, error: 'Gemini API key is required. Set it in Settings.' });
  if (!prompt || prompt.trim().length === 0) return res.status(400).json({ success: false, error: 'Prompt is required.' });

  if (orchestrator.isRunning) {
    return res.status(409).json({ success: false, error: 'A scenario is already running. Wait for it to complete.' });
  }

  try {
    const result = await orchestrator.runCustomPrompt(prompt, apiKey);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/ai/scenarios', (req, res) => {
  res.json(orchestrator.getScenarios());
});

// ── WebSocket Connection ──

io.on('connection', (socket) => {
  // Send initial statuses for simulation agents
  const status = simulator.getStatus();
  for (const agent of Object.values(status.agents)) {
    socket.emit('agent:update', agent);
  }

  // Also send known external agents
  for (const agent of externalAgents.values()) {
    socket.emit('agent:update', {
      agentId: agent.agentId,
      agentName: agent.agentName,
      role: agent.role,
      status: agent.status,
      controlState: agent.controlState,
      tokenUsage: { prompt: agent.totalTokensIn, completion: agent.totalTokensOut, total: agent.totalTokensIn + agent.totalTokensOut },
      tokens: { in: agent.totalTokensIn, out: agent.totalTokensOut, total: agent.totalTokensIn + agent.totalTokensOut },
      costUSD: 0,
      cumulativeCostUSD: parseFloat(agent.totalCostUSD.toFixed(6)),
      currentTask: agent.currentTask,
      model: agent.model,
      latencyMs: agent.avgLatencyMs,
      avgLatencyMs: agent.avgLatencyMs,
      confidenceScore: 0.95,
      hrs: agent.lastHRS,
      hrsLevel: agent.lastHRSLevel,
      reasoningChain: agent.lastOutput ? [agent.lastOutput.substring(0, 160)] : [],
      timestamp: agent.updatedAt,
      source: 'external',
      projectId: agent.projectId,
      actions: agent.callCount,
    });
  }

  // Send pending external approvals
  for (const appr of externalApprovals.values()) {
    if (appr.status === 'pending') {
      socket.emit('approval-added', appr);
    }
  }

  socket.on('disconnect', () => {});
});

// ── Start Server ──

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════╗');
    console.log('  ║                                                   ║');
    console.log('  ║        🧠  SYNAPSE OBSERVATORY — SERVER           ║');
    console.log('  ║                                                   ║');
    console.log(`  ║        API:       http://localhost:${PORT}            ║`);
    console.log('  ║        WebSocket: ws://localhost:4000              ║');
    console.log('  ║                                                   ║');
    console.log('  ║        🔴 Simulation Engine: ACTIVE               ║');
    console.log('  ║        🌐 External Ingest:   READY (/api/v1)      ║');
    console.log('  ╚═══════════════════════════════════════════════════╝');
    console.log('');

    simulator.start();
  });
}

module.exports = { app, server, io, scorer, externalAgents, externalApprovals };
