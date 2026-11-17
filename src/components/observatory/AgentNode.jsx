import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap, Shield, AlertTriangle } from 'lucide-react';
import styles from '../../views/Observatory.module.css';

export const AgentNode = ({ data, selected }) => {
  const { agent, onClick } = data;
  const isProcessing = agent.status === 'processing';
  const isError = agent.status === 'error' || agent.status === 'critical' || agent.controlState === 'killed';
  const isWaiting = agent.status === 'waiting_approval';
  const isPaused = agent.status === 'paused' || agent.controlState === 'paused';

  const hrs = agent.lastHRS !== undefined ? agent.lastHRS : agent.hrs !== undefined ? agent.hrs : 0;
  const hrsLevel = agent.lastHRSLevel || agent.hrsLevel || 'nominal';

  return (
    <div
      className={`${styles.agentNode} ${isProcessing ? styles.agentNodeProcessing : ''} ${
        isWaiting ? 'border-amber-500 ring-2 ring-amber-500/20' : ''
      }`}
      onClick={() => onClick?.(agent.id || agent.agentId)}
      style={{ minWidth: 190 }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center gap-2.5 mb-2.5">
        <div className="text-2xl">{agent.icon || '🤖'}</div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-black dark:text-white tracking-tight truncate">
            {agent.name || agent.agentName || agent.id}
          </div>
          <div className="font-mono text-[9px] text-black/50 dark:text-white/50 uppercase truncate">
            {agent.role ? `${agent.role} • ` : ''}{agent.id || agent.agentId}
          </div>
        </div>
        <div
          className={`${styles.statusDot} ${
            isProcessing ? styles.statusProcessing : 
            isWaiting ? 'bg-amber-500 animate-pulse' :
            isPaused ? 'bg-amber-400' :
            isError ? styles.statusError : 
            styles.statusIdle
          }`}
        />
      </div>

      <div className="flex items-center justify-between gap-1 mb-2">
        <div className="flex items-center gap-1 text-[10px] font-mono text-black/50 dark:text-white/50">
          <Zap size={10} />
          <span>{agent.actions || agent.callCount || 0} calls</span>
        </div>
        <div className={`text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded ${
          isWaiting
            ? 'text-amber-700 dark:text-amber-300 bg-amber-500/20 border border-amber-500/30'
            : isPaused
            ? 'text-amber-600 dark:text-amber-400 bg-amber-500/10'
            : isProcessing 
            ? 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10' 
            : isError 
            ? 'text-red-600 dark:text-red-400 bg-red-500/10' 
            : 'text-black/50 dark:text-white/50 bg-black/5 dark:bg-white/5'
        }`}>
          {isWaiting ? 'WAITING APPROVAL' : agent.status || 'IDLE'}
        </div>
      </div>

      {/* HRS Indicator */}
      <div className="flex items-center justify-between text-[9px] font-mono pt-1.5 border-t border-black/5 dark:border-white/5">
        <span className="text-black/40 dark:text-white/40 flex items-center gap-1">
          <Shield size={10} className={hrsLevel === 'critical' ? 'text-red-500' : hrsLevel === 'high' ? 'text-orange-500' : 'text-emerald-500'} />
          HRS:
        </span>
        <span className={`font-bold ${
          hrsLevel === 'critical' ? 'text-red-600 dark:text-red-400' :
          hrsLevel === 'high' ? 'text-orange-500' :
          hrsLevel === 'warning' ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400'
        }`}>
          {(hrs * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  );
};
