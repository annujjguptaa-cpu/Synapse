import React from 'react';
import { X, CheckCircle2, Shield, AlertTriangle, Play, Pause, Square } from 'lucide-react';
import styles from '../../views/Observatory.module.css';

export const AgentDetailPanel = ({
  selectedAgent,
  setSelectedAgent,
  agentStatuses,
  agentApprovals = [],
  approveRequest,
  rejectRequest,
  agentLogs = [],
  logEndRef,
  // External agent extra props
  isExternal = false,
  onKillAgent,
  onPauseAgent,
  onResumeAgent,
}) => {
  const agent = selectedAgent && agentStatuses ? agentStatuses[selectedAgent] : null;
  if (!selectedAgent || !agent) return null;

  const status = agent.status || 'idle';
  const controlState = agent.controlState || (status === 'killed' ? 'killed' : status === 'paused' ? 'paused' : 'running');
  const tokensIn = agent.tokens?.in || agent.tokensIn || agent.tokenUsage?.prompt || 0;
  const tokensOut = agent.tokens?.out || agent.tokensOut || agent.tokenUsage?.completion || 0;
  const totalTokens = agent.tokens?.total || agent.totalTokens || (tokensIn + tokensOut);
  const cost = agent.cumulativeCostUSD !== undefined ? agent.cumulativeCostUSD : agent.costUSD || (agent.actions ? (agent.actions * 0.023) : 0);
  const avgLatency = agent.avgLatencyMs !== undefined ? agent.avgLatencyMs : agent.latencyMs || 0;
  const hrs = agent.lastHRS !== undefined ? agent.lastHRS : agent.hrs !== undefined ? agent.hrs : 0;
  const hrsLevel = agent.lastHRSLevel || agent.hrsLevel || (hrs >= 0.85 ? 'critical' : hrs >= 0.7 ? 'high' : hrs >= 0.45 ? 'warning' : 'nominal');
  const hrsHistory = agent.historyHRS || [];

  const getHrsColor = (level) => {
    switch (level) {
      case 'critical': return 'text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30';
      case 'high': return 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30';
      case 'warning': return 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30';
      default: return 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    }
  };

  const relevantApprovals = agentApprovals.filter(a => (a.agent === selectedAgent || a.agentId === selectedAgent) && a.status === 'pending');

  return (
    <div className={`${styles.detailPanel} ${selectedAgent ? styles.detailPanelOpen : ''}`}>
      <div className="flex flex-col h-full overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-black/10 dark:border-white/10 flex items-center justify-between bg-white/50 dark:bg-black/50 sticky top-0 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{agent.icon || '🤖'}</span>
            <div>
              <div className="text-sm font-bold text-black dark:text-white tracking-tight flex items-center gap-2">
                {agent.name || agent.agentName || selectedAgent}
                {isExternal && (
                  <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    Live External
                  </span>
                )}
              </div>
              <div className="font-mono text-[10px] text-black/50 dark:text-white/50 uppercase">
                {agent.role ? `${agent.role} • ` : ''}{selectedAgent} {agent.projectId ? `(${agent.projectId})` : ''}
              </div>
            </div>
          </div>
          <button
            onClick={() => setSelectedAgent(null)}
            className="w-7 h-7 flex items-center justify-center text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Control Actions Row (Kill / Pause / Resume) */}
        <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/10 dark:border-white/10 flex items-center gap-2">
          {controlState === 'paused' ? (
            <button
              onClick={() => onResumeAgent?.(selectedAgent)}
              className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Play size={12} /> Resume Agent
            </button>
          ) : (
            <button
              onClick={() => onPauseAgent?.(selectedAgent)}
              disabled={controlState === 'killed'}
              className="flex-1 py-1.5 px-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Pause size={12} /> Pause Agent
            </button>
          )}
          <button
            onClick={() => onKillAgent?.(selectedAgent)}
            disabled={controlState === 'killed'}
            className="py-1.5 px-3 bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-xs font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            <Square size={12} /> Kill Switch
          </button>
        </div>

        {/* Telemetry Stats Grid */}
        <div className="grid grid-cols-4 gap-px bg-black/5 dark:bg-white/5">
          <div className="p-3 bg-white/80 dark:bg-black/80 text-center">
            <div className="text-base font-bold font-mono text-black dark:text-white">
              {agent.actions || agent.callCount || 0}
            </div>
            <div className="text-[9px] font-mono text-black/40 dark:text-white/40 uppercase">Calls</div>
          </div>
          <div className="p-3 bg-white/80 dark:bg-black/80 text-center">
            <div className={`text-base font-bold font-mono uppercase ${
              status === 'waiting_approval' ? 'text-amber-500' :
              status === 'processing' ? 'text-cyan-600 dark:text-cyan-400' :
              status === 'killed' ? 'text-red-500' :
              status === 'paused' ? 'text-amber-500' : 'text-black dark:text-white'
            }`}>
              {status}
            </div>
            <div className="text-[9px] font-mono text-black/40 dark:text-white/40 uppercase">Status</div>
          </div>
          <div className="p-3 bg-white/80 dark:bg-black/80 text-center">
            <div className="text-base font-bold font-mono text-black dark:text-white">
              ${Number(cost).toFixed(4)}
            </div>
            <div className="text-[9px] font-mono text-black/40 dark:text-white/40 uppercase">Cost</div>
          </div>
          <div className="p-3 bg-white/80 dark:bg-black/80 text-center">
            <div className="text-base font-bold font-mono text-black dark:text-white">
              {Math.round(avgLatency)}<span className="text-[9px] text-black/40">ms</span>
            </div>
            <div className="text-[9px] font-mono text-black/40 dark:text-white/40 uppercase">Avg Lat</div>
          </div>
        </div>

        {/* Tokens Row */}
        <div className="px-4 py-2.5 bg-black/[0.01] dark:bg-white/[0.01] border-b border-black/10 dark:border-white/10 flex items-center justify-between font-mono text-xs">
          <span className="text-black/60 dark:text-white/60">Tokens:</span>
          <div className="flex gap-3">
            <span className="text-blue-600 dark:text-blue-400">In: {tokensIn.toLocaleString()}</span>
            <span className="text-purple-600 dark:text-purple-400">Out: {tokensOut.toLocaleString()}</span>
            <span className="font-bold text-black dark:text-white">Total: {totalTokens.toLocaleString()}</span>
          </div>
        </div>

        {/* HRS (Hallucination Risk Score) Section */}
        <div className="p-4 border-b border-black/10 dark:border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-black dark:text-white">
              <Shield size={14} className={hrsLevel === 'critical' ? 'text-red-500' : hrsLevel === 'high' ? 'text-orange-500' : hrsLevel === 'warning' ? 'text-amber-500' : 'text-emerald-500'} />
              <span>Hallucination Risk (HRS)</span>
            </div>
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${getHrsColor(hrsLevel)}`}>
              {(hrs * 100).toFixed(1)}% [{hrsLevel.toUpperCase()}]
            </span>
          </div>

          <div className="w-full h-2 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-300"
              style={{
                width: `${Math.min(100, hrs * 100)}%`,
                backgroundColor: hrsLevel === 'critical' ? '#EF4444' : hrsLevel === 'high' ? '#F97316' : hrsLevel === 'warning' ? '#F59E0B' : '#10B981'
              }}
            />
          </div>

          {/* Sparkline / HRS History */}
          {hrsHistory.length > 0 && (
            <div className="pt-2">
              <div className="text-[9px] font-mono text-black/50 dark:text-white/50 uppercase mb-1">Recent HRS Trend</div>
              <div className="flex items-end gap-1 h-8 bg-black/5 dark:bg-white/5 p-1 rounded">
                {hrsHistory.slice(-20).map((h, idx) => (
                  <div
                    key={idx}
                    title={`HRS: ${(h.hrs * 100).toFixed(0)}% at ${new Date(h.timestamp).toLocaleTimeString()}`}
                    className="flex-1 rounded-sm transition-all"
                    style={{
                      height: `${Math.max(15, h.hrs * 100)}%`,
                      backgroundColor: h.level === 'critical' ? '#EF4444' : h.level === 'high' ? '#F97316' : h.level === 'warning' ? '#F59E0B' : '#10B981'
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pending Approvals */}
        {relevantApprovals.length > 0 && (
          <div className="p-4 border-b border-black/10 dark:border-white/10 bg-amber-500/5">
            <div className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 uppercase mb-2 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Pending Approval Requests ({relevantApprovals.length})
            </div>
            {relevantApprovals.map(approval => (
              <div key={approval.approvalId || approval.id} className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded mb-2">
                <div className="text-xs font-mono font-bold text-black dark:text-white mb-1">
                  {approval.action || 'High-Risk Action'}
                </div>
                <div className="text-[11px] text-black/70 dark:text-white/70 mb-2">
                  {approval.reason || approval.description || 'Action requires authorization'}
                </div>
                {approval.amount > 0 && (
                  <div className="text-xs font-mono font-bold text-black dark:text-white mb-3">
                    Amount: ${Number(approval.amount).toFixed(2)}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => approveRequest(approval.approvalId || approval.id)}
                    className="flex-1 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded hover:bg-emerald-700 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 size={12} /> Approve
                  </button>
                  <button
                    onClick={() => rejectRequest(approval.approvalId || approval.id)}
                    className="flex-1 py-1.5 bg-black/5 dark:bg-white/5 text-black/70 dark:text-white/70 text-xs font-medium rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <X size={12} /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Activity & Event Log (Last 20) */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-4 py-3 border-b border-black/10 dark:border-white/10 flex items-center justify-between">
            <span className="text-[10px] font-mono font-medium text-black/50 dark:text-white/50 uppercase">
              Event Log (Recent 20)
            </span>
            <span className="text-[10px] font-mono text-black/30 dark:text-white/30">
              {agentLogs.length} events
            </span>
          </div>
          <div className={`${styles.activityLog} flex-1 p-3 space-y-2`}>
            {agentLogs.length === 0 && (
              <div className="text-black/30 dark:text-white/30 text-center py-8 text-xs font-mono">
                No events recorded for this agent yet.
              </div>
            )}
            {agentLogs.slice(-20).map((entry, idx) => {
              const timeStr = entry.timestamp instanceof Date
                ? entry.timestamp.toLocaleTimeString()
                : new Date(entry.timestamp).toLocaleTimeString();
              return (
                <div key={entry.id || idx} className="text-xs font-mono p-2 rounded bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                  <div className="flex items-center justify-between text-[10px] text-black/40 dark:text-white/40 mb-1">
                    <span>[{timeStr}]</span>
                    {entry.hrs !== undefined && (
                      <span className={entry.hrs >= 0.7 ? 'text-red-500 font-bold' : 'text-emerald-500'}>
                        HRS: {(entry.hrs * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-black/80 dark:text-white/80">
                    {entry.action || entry.message || entry.task}
                  </div>
                  {entry.details && (
                    <div className="text-[11px] text-black/60 dark:text-white/60 mt-0.5 line-clamp-3">
                      {typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details)}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
