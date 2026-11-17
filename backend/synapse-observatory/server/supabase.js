require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

let supabase = null;

if (supabaseUrl && supabaseKey && supabaseKey !== 'YOUR_ANON_KEY_HERE' && !supabaseKey.includes('your_supabase')) {
  try {
    supabase = createClient(supabaseUrl, supabaseKey);
    console.log('[SUPABASE] Client initialized successfully.');
  } catch (err) {
    console.warn('[SUPABASE] Failed to initialize client:', err.message);
  }
} else {
  console.log('[SUPABASE] ⚠️ Client NOT initialized. Events will not be persisted to Supabase.');
}

/**
 * Helper to log simulation events to Supabase asynchronously without blocking the main thread.
 */
const logEventToSupabase = async (eventData) => {
  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('observatory_events')
      .insert([eventData]);
      
    if (error) {
      console.error('[SUPABASE] Error inserting event:', error.message);
    }
  } catch (err) {
    console.error('[SUPABASE] Exception inserting event:', err.message);
  }
};

/**
 * Helper to persist external agent events to the agent_events table asynchronously.
 */
const logAgentEventToSupabase = async (eventData) => {
  if (!supabase) return;

  try {
    const row = {
      project_id: eventData.projectId,
      agent_id: eventData.agentId,
      agent_name: eventData.agentName || null,
      role: eventData.role || null,
      status: eventData.status || null,
      handoff_to: eventData.handoffTo || null,
      task: eventData.task || null,
      input: eventData.input || null,
      output: eventData.output || null,
      model: eventData.model || null,
      tokens_in: typeof eventData.tokensIn === 'number' ? eventData.tokensIn : 0,
      tokens_out: typeof eventData.tokensOut === 'number' ? eventData.tokensOut : 0,
      cost_usd: typeof eventData.costUsd === 'number' ? eventData.costUsd : 0,
      latency_ms: typeof eventData.latencyMs === 'number' ? eventData.latencyMs : 0,
      confidence: typeof eventData.confidence === 'number' ? eventData.confidence : null,
      hrs_score: typeof eventData.hrs === 'number' ? eventData.hrs : null,
      metadata: eventData.metadata ? JSON.stringify(eventData.metadata) : null,
      created_at: eventData.timestamp || new Date().toISOString()
    };

    const { error } = await supabase
      .from('agent_events')
      .insert([row]);

    if (error) {
      // Log once as warning, do not crash
      console.warn('[SUPABASE] Agent event insert notice:', error.message);
    }
  } catch (err) {
    console.warn('[SUPABASE] Exception logging agent event:', err.message);
  }
};

module.exports = { supabase, logEventToSupabase, logAgentEventToSupabase };
