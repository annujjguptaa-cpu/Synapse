import { useEffect, useState, useCallback, useRef } from 'react';
import { io } from 'socket.io-client';
import { getBackendUrl } from '../utils/constants';

const MAX_EVENTS = 100;

const DEFAULT_AGENTS = {
  alpha: {
    agentId: 'alpha',
    agentName: 'Data Ingestion Agent',
    model: 'gpt-4o',
    status: 'running',
    currentTask: 'Ingesting customer order stream — batch #2847',
    tokenUsage: { prompt: 1420, completion: 480, total: 1900 },
    cumulativeCostUSD: 1.42,
    latencyMs: 142,
    confidenceScore: 0.98,
    reasoningChain: ['Polling real-time market queue', 'Parsing JSON payload', 'Routing batch to Analysis Agent'],
  },
  beta: {
    agentId: 'beta',
    agentName: 'Analysis Agent',
    model: 'gpt-4o',
    status: 'running',
    currentTask: 'Running anomaly detection on supply chain metrics',
    tokenUsage: { prompt: 2150, completion: 820, total: 2970 },
    cumulativeCostUSD: 2.15,
    latencyMs: 280,
    confidenceScore: 0.94,
    reasoningChain: ['Aggregating ingested vectors', 'Running ARIMA regression', 'Signal variance nominal (z=0.4)'],
  },
  gamma: {
    agentId: 'gamma',
    agentName: 'Decision Agent',
    model: 'gpt-4o',
    status: 'running',
    currentTask: 'Evaluating dynamic order allocation & PO limits',
    tokenUsage: { prompt: 2900, completion: 1100, total: 4000 },
    cumulativeCostUSD: 3.20,
    latencyMs: 410,
    confidenceScore: 0.91,
    reasoningChain: ['Validating threshold constraints', 'Cross-referencing margin rules', 'Committing distribution route'],
  },
  delta: {
    agentId: 'delta',
    agentName: 'Execution Agent',
    model: 'gpt-4o',
    status: 'running',
    currentTask: 'Dispatching inventory replenishment requests',
    tokenUsage: { prompt: 1800, completion: 600, total: 2400 },
    cumulativeCostUSD: 1.85,
    latencyMs: 210,
    confidenceScore: 0.96,
    reasoningChain: ['Signing webhook payload', 'Transmitting to 3PL endpoint', 'Awaiting 200 OK ACK'],
  },
};

const DEFAULT_HRS = {
  alpha: { agentId: 'alpha', hrs: 0.04, level: 'nominal', activeTiers: ['T1'], accuracy: '~99%' },
  beta: { agentId: 'beta', hrs: 0.03, level: 'nominal', activeTiers: ['T1', 'T2'], accuracy: '~98%' },
  gamma: { agentId: 'gamma', hrs: 0.07, level: 'nominal', activeTiers: ['T1', 'T2', 'T3'], accuracy: '~97%' },
  delta: { agentId: 'delta', hrs: 0.02, level: 'nominal', activeTiers: ['T1'], accuracy: '~99%' },
};

const DEFAULT_SYSTEM_STATUS = {
  totalCost: 8.62,
  totalTokens: 11270,
  activeAgents: 4,
  alertCount: 0,
  systemHealth: 'nominal',
  burnRatePerSec: 0.08,
  burnRatePerMin: 4.80,
  uptime: 120,
};

const generateInitialHistory = () => {
  const now = Date.now();
  const points = [];
  for (let i = 9; i >= 0; i--) {
    const t = now - i * 10000;
    points.push({
      time: t,
      timeLabel: new Date(t).toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' }),
      alpha: 1200 + (9 - i) * 70,
      beta: 2100 + (9 - i) * 80,
      gamma: 3100 + (9 - i) * 90,
      delta: 1800 + (9 - i) * 55,
    });
  }
  return points;
};

const INITIAL_EVENTS = [
  { id: 'evt-init-1', timestamp: new Date(Date.now() - 35000).toISOString(), type: 'INFO', agent: 'alpha', agentName: 'Data Ingestion', description: 'Ingestion batch #2847 complete: ERP sync cycle verified' },
  { id: 'evt-init-2', timestamp: new Date(Date.now() - 25000).toISOString(), type: 'INFO', agent: 'beta', agentName: 'Analysis', description: 'Anomaly detection nominal: Demand patterns within 95% CI' },
  { id: 'evt-init-3', timestamp: new Date(Date.now() - 15000).toISOString(), type: 'INFO', agent: 'gamma', agentName: 'Decision', description: 'PO allocation optimized across 7 regional hubs' },
  { id: 'evt-init-4', timestamp: new Date(Date.now() - 5000).toISOString(), type: 'INFO', agent: 'delta', agentName: 'Execution', description: 'Replenishment order dispatched to fulfillment gateway' },
];

export function useSwarmSocket() {
  const [agents, setAgents] = useState(DEFAULT_AGENTS);
  const [externalAgents, setExternalAgents] = useState({});
  const [events, setEvents] = useState(INITIAL_EVENTS);
  const [alerts, setAlerts] = useState([]);
  const [tokenHistory, setTokenHistory] = useState(generateInitialHistory);
  const [hrsScores, setHrsScores] = useState(DEFAULT_HRS);
  const [systemStatus, setSystemStatus] = useState(DEFAULT_SYSTEM_STATUS);
  const [isConnected, setIsConnected] = useState(false);
  const [activeHandoffs, setActiveHandoffs] = useState([]);
  const [pendingApprovals, setPendingApprovals] = useState([]);

  const socketRef = useRef(null);
  const agentsRef = useRef(agents);
  const externalAgentsRef = useRef(externalAgents);
  const isConnectedRef = useRef(false);

  const activeUrl = getBackendUrl();

  const addEvent = useCallback((type, agentId, agentName, description) => {
    const newEvent = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      type,
      agent: agentId,
      agentName: agentName || agentId,
      description,
    };
    setEvents(prev => [newEvent, ...prev].slice(0, MAX_EVENTS));
  }, []);

  useEffect(() => {
    let socket;
    try {
      socket = io(activeUrl, {
        transports: ['websocket', 'polling'],
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: Infinity,
        timeout: 4000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        setIsConnected(true);
        isConnectedRef.current = true;
      });

      socket.on('disconnect', () => {
        setIsConnected(false);
        isConnectedRef.current = false;
      });

      socket.on('connect_error', (err) => {
        setIsConnected(false);
        isConnectedRef.current = false;
      });

      // ── Main Telemetry Handler ──
      socket.on('agent:update', (data) => {
        if (data.source === 'external') {
          // Store in external agents registry
          const prev = externalAgentsRef.current[data.agentId];
          const updated = {
            ...prev,
            ...data,
            historyHRS: [
              ...(prev?.historyHRS || []),
              { hrs: data.hrs !== undefined ? data.hrs : 0, level: data.hrsLevel || 'nominal', timestamp: data.timestamp }
            ].slice(-30),
          };
          externalAgentsRef.current = { ...externalAgentsRef.current, [data.agentId]: updated };
          setExternalAgents({ ...externalAgentsRef.current });

          // Also register HRS
          if (data.hrs !== undefined) {
            setHrsScores(curr => ({
              ...curr,
              [data.agentId]: {
                agentId: data.agentId,
                hrs: data.hrs,
                level: data.hrsLevel || 'nominal',
                activeTiers: ['T1'],
                accuracy: '~85%'
              }
            }));
          }
        } else {
          // Simulator agents
          const prevAgent = agentsRef.current[data.agentId];
          agentsRef.current = { ...agentsRef.current, [data.agentId]: data };
          setAgents({ ...agentsRef.current });

          if (prevAgent && prevAgent.status !== data.status) {
            const eventType = data.status === 'critical' ? 'CRITICAL'
              : data.status === 'warning' ? 'WARNING'
              : data.status === 'killed' ? 'ERROR'
              : data.status === 'paused' ? 'WARNING'
              : 'INFO';
            addEvent(eventType, data.agentId, data.agentName,
              `Status → ${data.status.toUpperCase()}${data.status === 'killed' ? ' — Agent terminated' : ''}`);
          }
        }

        const now = Date.now();
        setTokenHistory(prev => {
          const twoMinAgo = now - 120000;
          const filtered = prev.filter(p => p.time > twoMinAgo);
          const ags = agentsRef.current;
          const point = {
            time: now,
            timeLabel: new Date(now).toLocaleTimeString('en-US', {
              hour12: false,
              minute: '2-digit',
              second: '2-digit',
            }),
            alpha: ags.alpha?.tokenUsage?.total || 0,
            beta: ags.beta?.tokenUsage?.total || 0,
            gamma: ags.gamma?.tokenUsage?.total || 0,
            delta: ags.delta?.tokenUsage?.total || 0,
          };
          return [...filtered, point];
        });
      });

      // ── External & Simulator Activity Logs ──
      socket.on('activity', (data) => {
        addEvent(
          data.status === 'error' ? 'ERROR' : data.status === 'waiting_approval' ? 'WARNING' : 'INFO',
          data.agentId,
          data.agentName,
          `${data.action}${data.details ? `: ${typeof data.details === 'string' ? data.details.substring(0, 80) : ''}` : ''}`
        );
      });

      // ── Agent Handoffs ──
      socket.on('agent-handoff', (handoff) => {
        setActiveHandoffs(prev => [...prev.slice(-19), handoff]);
        setTimeout(() => {
          setActiveHandoffs(prev => prev.filter(h => h !== handoff));
        }, 4000);
      });

      socket.on('live:agent-handoff', (handoff) => {
        setActiveHandoffs(prev => [...prev.slice(-19), handoff]);
        setTimeout(() => {
          setActiveHandoffs(prev => prev.filter(h => h !== handoff));
        }, 4000);
      });

      // ── Approvals ──
      socket.on('approval-added', (appr) => {
        setPendingApprovals(prev => {
          if (prev.some(a => a.approvalId === appr.approvalId || a.id === appr.id)) return prev;
          return [...prev, appr];
        });
      });

      socket.on('approval-decided', (appr) => {
        setPendingApprovals(prev => prev.filter(a => a.approvalId !== appr.approvalId && a.id !== appr.id));
      });

      socket.on('agent:communication', (data) => {
        const type = data.status === 'corrupted' ? 'ERROR' : 'INFO';
        const prefix = data.status === 'corrupted' ? '⚠ CORRUPTED: ' : '';
        addEvent(type, data.from, data.fromName, `${data.fromName} → ${data.toName}: ${prefix}${data.message}`);
      });

      socket.on('alert:hallucination', (data) => {
        setAlerts(prev => [...prev, {
          id: `alert-hall-${Date.now()}`,
          type: 'hallucination',
          agentId: data.agentId,
          agentName: data.agentName,
          message: data.message,
          confidence: data.confidence,
          timestamp: data.timestamp,
          dismissed: false,
        }]);
        addEvent('CRITICAL', data.agentId, data.agentName, `🚨 HALLUCINATION: ${data.message}`);
      });

      socket.on('alert:cost-spike', (data) => {
        setAlerts(prev => [...prev, {
          id: `alert-cost-${Date.now()}`,
          type: 'cost-spike',
          agentId: data.agentId,
          agentName: data.agentName,
          message: data.message,
          currentRate: data.currentRate,
          timestamp: data.timestamp,
          dismissed: false,
        }]);
        addEvent('CRITICAL', data.agentId, data.agentName, `💰 COST SPIKE: ${data.message}`);
      });

      socket.on('alert:cascade', (data) => {
        setAlerts(prev => [...prev, {
          id: `alert-cascade-${Date.now()}`,
          type: 'cascade',
          agentId: data.agentId,
          agentName: data.agentName,
          source: data.source,
          sourceName: data.sourceName,
          message: data.message,
          timestamp: data.timestamp,
          dismissed: false,
        }]);
        addEvent('CRITICAL', data.agentId, data.agentName, `🔗 CASCADE: ${data.message}`);
      });

      socket.on('alert:safeguard', (data) => {
        addEvent('WARNING', 'SYSTEM', 'Auto-Safeguard', `🛡️ ${data.message}`);
      });

      socket.on('system:status', (data) => {
        setSystemStatus(data);
      });

      socket.on('hallucination:score', (data) => {
        setHrsScores(prev => ({
          ...prev,
          [data.agentId]: data,
        }));
      });
    } catch (err) {
      console.warn('[Swarm Socket] Error initializing client:', err);
    }

    return () => {
      if (socket) socket.disconnect();
    };
  }, [activeUrl, addEvent]);

  // Fallback simulation loop for demo mode when backend is offline
  useEffect(() => {
    const autonomousInterval = setInterval(() => {
      if (isConnectedRef.current) return;

      setAgents(prev => {
        const next = { ...prev };
        let activeCount = 0;
        let totalCostInc = 0;
        let totalTokInc = 0;

        ['alpha', 'beta', 'gamma', 'delta'].forEach(id => {
          const a = next[id];
          if (!a || a.status === 'killed') return;

          activeCount++;
          const tokInc = Math.floor(15 + Math.random() * 35);
          totalTokInc += tokInc;
          const costInc = (tokInc * 0.00003);
          totalCostInc += costInc;

          const latencyJitter = Math.floor(Math.sin(Date.now() / 2000) * 15);
          const baseLat = id === 'alpha' ? 140 : id === 'beta' ? 260 : id === 'gamma' ? 380 : 210;

          next[id] = {
            ...a,
            tokenUsage: {
              ...a.tokenUsage,
              total: (a.tokenUsage?.total || 2000) + tokInc,
            },
            cumulativeCostUSD: Number(((a.cumulativeCostUSD || 1) + costInc).toFixed(2)),
            latencyMs: Math.max(80, baseLat + latencyJitter),
          };
        });

        agentsRef.current = next;

        setSystemStatus(curr => ({
          ...curr,
          totalTokens: curr.totalTokens + totalTokInc,
          totalCost: Number((curr.totalCost + totalCostInc).toFixed(2)),
          activeAgents: activeCount,
        }));

        return next;
      });
    }, 2800);

    return () => clearInterval(autonomousInterval);
  }, []);

  // ── Actions ──

  const killAgent = useCallback(async (agentId) => {
    setAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'killed' };
      agentsRef.current = next;
      return next;
    });
    setExternalAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'killed', controlState: 'killed' };
      externalAgentsRef.current = next;
      return next;
    });

    setAlerts(prev => prev.filter(a => a.agentId !== agentId));
    addEvent('ERROR', agentId, agentId.toUpperCase(), `Agent ${agentId.toUpperCase()} killed by operator`);

    try {
      await fetch(`${getBackendUrl()}/api/kill/${agentId}`, { method: 'POST' });
    } catch (err) {
      console.debug('[Swarm Local] Backend kill completed locally');
    }
  }, [addEvent]);

  const pauseAgent = useCallback(async (agentId) => {
    setExternalAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'paused', controlState: 'paused' };
      externalAgentsRef.current = next;
      return next;
    });
    try {
      await fetch(`${getBackendUrl()}/api/pause/${agentId}`, { method: 'POST' });
    } catch (err) {
      console.debug('[Swarm Local] Backend pause completed');
    }
  }, []);

  const resumeAgent = useCallback(async (agentId) => {
    setAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'running', pauseReason: null };
      agentsRef.current = next;
      return next;
    });
    setExternalAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'idle', controlState: 'running' };
      externalAgentsRef.current = next;
      return next;
    });
    addEvent('INFO', agentId, agentId.toUpperCase(), `Agent ${agentId.toUpperCase()} resumed`);

    try {
      await fetch(`${getBackendUrl()}/api/resume/${agentId}`, { method: 'POST' });
    } catch (err) {
      console.debug('[Swarm Local] Resume completed locally');
    }
  }, [addEvent]);

  const killAll = useCallback(async () => {
    setAgents(prev => {
      const next = {};
      Object.keys(prev).forEach(k => { next[k] = { ...prev[k], status: 'killed' }; });
      agentsRef.current = next;
      return next;
    });
    setExternalAgents(prev => {
      const next = {};
      Object.keys(prev).forEach(k => { next[k] = { ...prev[k], status: 'killed', controlState: 'killed' }; });
      externalAgentsRef.current = next;
      return next;
    });
    try {
      await fetch(`${getBackendUrl()}/api/kill-all`, { method: 'POST' });
    } catch (err) {}
  }, []);

  const restartAgent = useCallback(async (agentId) => {
    setAgents(prev => {
      const next = { ...prev };
      if (next[agentId]) next[agentId] = { ...next[agentId], status: 'running', pauseReason: null };
      agentsRef.current = next;
      return next;
    });
    try {
      await fetch(`${getBackendUrl()}/api/restart/${agentId}`, { method: 'POST' });
    } catch (err) {}
  }, []);

  const restartAll = useCallback(async () => {
    setAgents(DEFAULT_AGENTS);
    agentsRef.current = DEFAULT_AGENTS;
    try {
      await fetch(`${getBackendUrl()}/api/restart-all`, { method: 'POST' });
    } catch (err) {}
  }, []);

  const triggerRogue = useCallback(async () => {
    try {
      await fetch(`${getBackendUrl()}/api/demo/trigger-rogue`, { method: 'POST' });
    } catch (err) {}
  }, []);

  const decideApproval = useCallback(async (approvalId, decision) => {
    setPendingApprovals(prev => prev.filter(a => a.approvalId !== approvalId && a.id !== approvalId));
    try {
      await fetch(`${getBackendUrl()}/api/v1/approvals/${approvalId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision })
      });
    } catch (err) {
      console.warn('Failed to post approval decision:', err);
    }
  }, []);

  return {
    agents,
    externalAgents,
    events,
    alerts,
    tokenHistory,
    hrsScores,
    systemStatus,
    isConnected,
    activeHandoffs,
    pendingApprovals,
    backendUrl: activeUrl,
    killAgent,
    pauseAgent,
    resumeAgent,
    killAll,
    restartAgent,
    restartAll,
    triggerRogue,
    decideApproval,
    dismissAlert: (id) => setAlerts(p => p.filter(a => a.id !== id)),
    clearAlerts: () => setAlerts([]),
  };
}
