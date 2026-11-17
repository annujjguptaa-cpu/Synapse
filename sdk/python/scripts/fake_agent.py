"""
Fake Agent Swarm Simulation Script
Streams events from 3 external agents with handoffs, high-cost alerts, and hallucination tests.
"""

import time
import sys
import os

# Add parent directory to sys.path to import synapse_sdk
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from synapse_sdk import Synapse, AgentKilled

SYNAPSE_URL = os.environ.get("SYNAPSE_URL", "http://localhost:4000")
API_KEY = os.environ.get("SYNAPSE_API_KEY", "synapse-test-key")
PROJECT_ID = os.environ.get("SYNAPSE_PROJECT_ID", "external-swarm-demo")

def run_swarm():
    print(f"\n🚀 Connecting fake agent swarm to Synapse at {SYNAPSE_URL}...")
    syn = Synapse(url=SYNAPSE_URL, api_key=API_KEY, project_id=PROJECT_ID)

    # 1. Health check
    health = syn._get("/api/v1/health")
    if not health or not health.get("ok"):
        print("❌ Cannot reach Synapse /api/v1/health. Make sure backend is running.")
        sys.exit(1)
    print(f"✅ Synapse server online (v{health.get('version')})\n")

    round_idx = 1
    while True:
        try:
            print(f"─── Cycle #{round_idx} ─────────────────────────────")
            
            # Agent 1: Ingestion
            print("▶ [Agent 1: Ingestor] Polling external API streams...")
            with syn.track("ingestor", agent_name="Telemetry Ingestion Agent", role="Ingestor") as t:
                time.sleep(1.2)
                t.task = "Pulling IoT and sales metrics"
                t.set_tokens(tokens_in=350, tokens_out=120)
                t.set_cost(0.0018)
                t.set_output("Ingested 48 market signals and 12 sensor records")
                t.set_handoff("analyzer")
            print("  ↳ Handoff to [analyzer]")

            # Agent 2: Analysis & Anomaly Detection
            print("▶ [Agent 2: Analyzer] Running cross-correlation...")
            with syn.track("analyzer", agent_name="Anomaly Detection Agent", role="Data Analyst") as t:
                time.sleep(1.5)
                t.task = "Running statistical regression"
                t.set_tokens(tokens_in=1200, tokens_out=450)
                t.set_cost(0.0062)
                t.set_output("Detected 3 demand spikes; recommendation: restock warehouse B")
                t.set_handoff("decision_core")
            print("  ↳ Handoff to [decision_core]")

            # Agent 3: Decision Maker (includes occasional high cost / hallucination)
            print("▶ [Agent 3: Decision Core] Formulating operational execution plan...")
            with syn.track("decision_core", agent_name="Autonomous Decision Engine", role="Executive Agent") as t:
                time.sleep(1.8)
                if round_idx % 3 == 0:
                    # Trigger a simulated hallucination event with high entropy and repetition
                    print("  ⚠️ Emitting hallucinated test payload...")
                    t.task = "Recursive self-referential decision loop"
                    t.confidence = 0.22
                    t.set_tokens(tokens_in=8500, tokens_out=4200)
                    t.set_cost(0.095) # Cost spike
                    t.set_output("LOOP: repeat repeat repeat undefined undefined critical state invalid logic " * 8)
                else:
                    t.task = "Approving purchase order #892"
                    t.set_tokens(tokens_in=800, tokens_out=300)
                    t.set_cost(0.0045)
                    t.set_output("Approved order batch for warehouse B distribution")

            # Request an approval every 2 cycles
            if round_idx % 2 == 0:
                print("▶ [Decision Core] Requesting operator sign-off for large transaction ($14,500)...")
                approved = syn.request_approval(
                    agent_id="decision_core",
                    action="Approve Purchase Order $14,500",
                    amount=14500,
                    reason="Warehouse B restock procurement",
                    timeout_s=30
                )
                print(f"  ↳ Operator Decision: {'APPROVED ✅' if approved else 'REJECTED ❌'}")

            round_idx += 1
            print("Sleeping 4s before next cycle...\n")
            time.sleep(4)

        except AgentKilled as e:
            print(f"\n🛑 {e}\nAgent stopped. Waiting 5s before checking resume status...")
            time.sleep(5)
        except KeyboardInterrupt:
            print("\nExiting swarm simulation.")
            break

if __name__ == "__main__":
    run_swarm()
