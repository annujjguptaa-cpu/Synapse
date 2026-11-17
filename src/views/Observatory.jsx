import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { useSynapse } from '../context/SynapseContext';
import { useSwarmSocket } from '../hooks/useSwarmSocket';
import { 
  Play, X, Eye, Activity, Clock, DollarSign, 
  CheckCircle2, AlertTriangle, Zap, ChevronDown, 
  ChevronUp, RotateCcw, Cpu, Send, Sparkles,
  Radio, Bot, Layers, Shield
} from 'lucide-react';
import styles from './Observatory.module.css';

import LiveSwarmView from '../components/liveswarm/LiveSwarmView';
import { AgentNode } from '../components/observatory/AgentNode';
import { TimelinePanel } from '../components/observatory/TimelinePanel';
import { AgentDetailPanel } from '../components/observatory/AgentDetailPanel';

const nodeTypes = { agentNode: AgentNode };

// Simulator default edges & layout
const AGENT_EDGES = [
  { source: 'inventory', target: 'procurement', label: 'Low Stock Alert' },
  { source: 'procurement', target: 'finance', label: 'PO Validation' },
  { source: 'inventory', target: 'pricing', label: 'Demand Signal' },
  { source: 'logistics', target: 'procurement', label: 'Route Alert' },
  { source: 'logistics', target: 'finance', label: 'Cost Analysis' },
  { source: 'pricing', target: 'finance', label: 'Revenue Data' },
  { source: 'finance', target: 'inventory', label: 'Budget Approval' },
  { source: 'pricing', target: 'logistics', label: 'Priority Signal' },
];

const AGENT_POSITIONS = {
  inventory:   { x: 400, y: 80 },
  procurement: { x: 100, y: 300 },
  finance:     { x: 700, y: 300 },
  logistics:   { x: 200, y: 550 },
  pricing:     { x: 600, y: 550 },
};

// Dagre layout helper for external agents graph
const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction, ranksep: 80, nodesep: 60 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 200, height: 110 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition ? nodeWithPosition.x - 100 : Math.random() * 400,
        y: nodeWithPosition ? nodeWithPosition.y - 55 : Math.random() * 400,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

export default function Observatory() {
  const {
    simulator,
    scenarios,
    agentStatuses: simAgentStatuses,
    activityLog: simActivityLog,
    pendingApprovals: simPendingApprovals,
    scenarioRunning,
    demoSteps,
    activeHandoffs: simActiveHandoffs,
    runScenario,
    runLiveScenario,
    runCustomPrompt,
    liveMode,
    liveTelemetry,
    approveRequest: simApproveRequest,
    rejectRequest: simRejectRequest,
  } = useSynapse();

  // Swarm socket hook (receives external agents & approvals)
  const {
    externalAgents,
    events: externalEvents,
    activeHandoffs: externalHandoffs,
    pendingApprovals: externalApprovalsList,
    killAgent,
    pauseAgent,
    resumeAgent,
    decideApproval,
  } = useSwarmSocket();

  // Mode state: 'demo' (built-in simulator) or 'live' (only external agents)
  const [dataMode, setDataMode] = useState('demo'); // 'demo' | 'live'
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [activeEdges, setActiveEdges] = useState(new Set());
  const [viewMode, setViewMode] = useState('flow'); // 'flow' (ReactFlow) or 'grid' (LiveSwarmView)
  const [engineMode, setEngineMode] = useState('ai');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [externalEdgesList, setExternalEdgesList] = useState([]);
  const logEndRef = useRef(null);
  const customInputRef = useRef(null);

  // Track handoffs for external agents and dynamically create edges
  useEffect(() => {
    if (externalHandoffs.length > 0) {
      setExternalEdgesList(prev => {
        const next = [...prev];
        externalHandoffs.forEach(h => {
          const edgeId = `${h.from}-${h.to}`;
          if (!next.some(e => e.id === edgeId)) {
            next.push({
              id: edgeId,
              source: h.from,
              target: h.to,
              label: h.reason || 'Handoff',
            });
          }
        });
        return next;
      });
    }
  }, [externalHandoffs]);

  // Combine or filter agent statuses based on Demo / Live toggle
  const currentAgentStatuses = useMemo(() => {
    if (dataMode === 'live') {
      // Return only external agents
      return externalAgents;
    }
    // Return simulator agents in demo mode
    return simAgentStatuses;
  }, [dataMode, externalAgents, simAgentStatuses]);

  const currentApprovals = useMemo(() => {
    if (dataMode === 'live') {
      return externalApprovalsList;
    }
    return simPendingApprovals;
  }, [dataMode, externalApprovalsList, simPendingApprovals]);

  const handleApprove = useCallback((id) => {
    if (dataMode === 'live' || String(id).startsWith('appr-')) {
      decideApproval(id, 'approved');
    } else {
      simApproveRequest(id);
    }
  }, [dataMode, decideApproval, simApproveRequest]);

  const handleReject = useCallback((id) => {
    if (dataMode === 'live' || String(id).startsWith('appr-')) {
      decideApproval(id, 'rejected');
    } else {
      simRejectRequest(id);
    }
  }, [dataMode, decideApproval, simRejectRequest]);

  const handleNodeClick = useCallback((agentId) => {
    setSelectedAgent(prev => prev === agentId ? null : agentId);
  }, []);

  // Construct React Flow nodes and edges
  const { rawNodes, rawEdges } = useMemo(() => {
    if (dataMode === 'live') {
      const extList = Object.values(externalAgents);
      const generatedNodes = extList.map((agent) => ({
        id: agent.agentId,
        type: 'agentNode',
        position: { x: 0, y: 0 },
        data: { agent, onClick: handleNodeClick },
      }));

      const generatedEdges = externalEdgesList.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        animated: true,
        style: { stroke: '#06b6d4', strokeWidth: 2.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#06b6d4' },
      }));

      if (generatedNodes.length > 0) {
        const layouted = getLayoutedElements(generatedNodes, generatedEdges, 'TB');
        return { rawNodes: layouted.nodes, rawEdges: layouted.edges };
      }
      return { rawNodes: [], rawEdges: [] };
    }

    // Demo Mode nodes
    const simNodes = Object.entries(simAgentStatuses).map(([id, agent]) => ({
      id,
      type: 'agentNode',
      position: AGENT_POSITIONS[id] || { x: 400, y: 300 },
      data: { agent, onClick: handleNodeClick },
    }));

    const simEdges = AGENT_EDGES.map((e) => {
      const edgeId = `${e.source}-${e.target}`;
      const isActive = activeEdges.has(edgeId);
      return {
        id: edgeId,
        source: e.source,
        target: e.target,
        label: isActive ? e.label : '',
        animated: isActive,
        style: {
          stroke: isActive ? '#06b6d4' : 'rgba(0,0,0,0.12)',
          strokeWidth: isActive ? 3 : 1.5,
          strokeDasharray: isActive ? '8 4' : 'none',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isActive ? '#06b6d4' : 'rgba(0,0,0,0.12)',
        },
      };
    });

    return { rawNodes: simNodes, rawEdges: simEdges };
  }, [dataMode, externalAgents, externalEdgesList, simAgentStatuses, activeEdges, handleNodeClick]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rawNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rawEdges);

  useEffect(() => {
    setNodes(rawNodes);
  }, [rawNodes, setNodes]);

  useEffect(() => {
    setEdges(rawEdges);
  }, [rawEdges, setEdges]);

  // Logs for selected agent
  const agentLogs = useMemo(() => {
    if (!selectedAgent) return [];
    if (dataMode === 'live') {
      const agentObj = externalAgents[selectedAgent];
      if (agentObj && agentObj.events) {
        return agentObj.events.slice(-20);
      }
      return externalEvents.filter(e => e.agent === selectedAgent).slice(-20);
    }
    return simActivityLog.filter(l => l.agentId === selectedAgent).slice(-50);
  }, [selectedAgent, dataMode, externalAgents, externalEvents, simActivityLog]);

  return (
    <div className="w-full h-full relative overflow-hidden flex flex-col bg-transparent">
      {/* ── Scenario / Swarm Mode Header Bar ── */}
      <div className={styles.scenarioBar}>
        <div className="flex items-center gap-2 mr-3 shrink-0">
          <Cpu size={16} className="text-black/50 dark:text-white/50" />
          <span className="text-sm font-bold text-black dark:text-white tracking-tight">Observatory</span>
        </div>

        {/* Demo vs Live External Swarm Toggle */}
        <div className="flex items-center bg-black/5 dark:bg-white/10 p-0.5 rounded-lg mr-3 shrink-0 border border-black/10 dark:border-white/10">
          <button
            onClick={() => setDataMode('demo')}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
              dataMode === 'demo'
                ? 'bg-white dark:bg-black text-black dark:text-white shadow-sm'
                : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'
            }`}
          >
            <span>Demo Swarm</span>
          </button>
          <button
            onClick={() => setDataMode('live')}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
              dataMode === 'live'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Live External ({Object.keys(externalAgents).length})</span>
          </button>
        </div>

        <div className="w-px h-6 bg-black/10 dark:bg-white/10 shrink-0 mr-2" />

        {/* Show built-in scenario buttons only in Demo mode */}
        {dataMode === 'demo' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {Object.entries(scenarios).map(([id, scenario]) => (
              <button
                key={id}
                onClick={() => (engineMode === 'ai' ? runLiveScenario(id) : runScenario(id))}
                disabled={!!scenarioRunning}
                className="px-2.5 py-1 text-xs rounded border border-black/10 dark:border-white/10 bg-white/40 dark:bg-black/30 hover:bg-white/70 text-black dark:text-white disabled:opacity-40 transition-colors"
              >
                {scenario.icon} {scenario.title}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs font-mono text-black/60 dark:text-white/60">
            <span>Ingesting events from <code className="bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded text-blue-600 dark:text-blue-400">/api/v1/events</code></span>
            <span>•</span>
            <span>Active External Agents: <strong className="text-black dark:text-white">{Object.keys(externalAgents).length}</strong></span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <div className="flex bg-black/5 dark:bg-white/10 p-0.5 rounded">
            <button
              onClick={() => setViewMode('flow')}
              className={`px-2 py-0.5 text-xs rounded ${viewMode === 'flow' ? 'bg-white dark:bg-black text-black dark:text-white' : 'text-black/50 dark:text-white/50'}`}
            >
              Graph Flow
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`px-2 py-0.5 text-xs rounded ${viewMode === 'grid' ? 'bg-white dark:bg-black text-black dark:text-white' : 'text-black/50 dark:text-white/50'}`}
            >
              Swarm Metrics
            </button>
          </div>
        </div>
      </div>

      {/* ── Main View Area ── */}
      {viewMode === 'grid' ? (
        <div className="flex-1 w-full h-full bg-transparent overflow-hidden">
          <LiveSwarmView />
        </div>
      ) : (
        <div className={`flex-1 relative ${styles.canvas}`}>
          {dataMode === 'live' && Object.keys(externalAgents).length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 pointer-events-none">
              <div className="max-w-md p-6 bg-white/80 dark:bg-black/80 backdrop-blur-md rounded-xl border border-black/10 dark:border-white/10 shadow-lg pointer-events-auto">
                <div className="w-10 h-10 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center mx-auto mb-3">
                  <Bot size={22} />
                </div>
                <h3 className="text-base font-bold text-black dark:text-white mb-1">Awaiting External Swarm Events</h3>
                <p className="text-xs text-black/60 dark:text-white/60 mb-4 leading-relaxed">
                  No external agents have reported yet. Connect any Python, Node, or LangChain agent using the Synapse SDK or HTTP API.
                </p>
                <div className="bg-black/5 dark:bg-white/5 p-3 rounded text-left font-mono text-[11px] text-black/70 dark:text-white/70 overflow-x-auto mb-3">
                  <code>python sdk/python/scripts/fake_agent.py</code>
                </div>
                <button
                  onClick={() => setDataMode('demo')}
                  className="px-3 py-1.5 bg-black dark:bg-white text-white dark:text-black rounded text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  Switch to Demo Mode
                </button>
              </div>
            </div>
          ) : null}

          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            minZoom={0.2}
            maxZoom={1.5}
          >
            <Background gap={24} size={1} color="rgba(0,0,0,0.05)" />
            <Controls showInteractive={false} />
          </ReactFlow>

          {/* ── Slide-in Agent Detail Panel ── */}
          <AgentDetailPanel
            selectedAgent={selectedAgent}
            setSelectedAgent={setSelectedAgent}
            agentStatuses={currentAgentStatuses}
            agentApprovals={currentApprovals}
            approveRequest={handleApprove}
            rejectRequest={handleReject}
            agentLogs={agentLogs}
            logEndRef={logEndRef}
            isExternal={dataMode === 'live'}
            onKillAgent={killAgent}
            onPauseAgent={pauseAgent}
            onResumeAgent={resumeAgent}
          />
        </div>
      )}
    </div>
  );
}
