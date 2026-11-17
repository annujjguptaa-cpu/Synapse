# Synapse Python SDK

Monitor, score, and control AI agent swarms in real time with **Synapse OS**.

## Installation

The Synapse SDK is a lightweight single-file client that depends only on `requests`.

```bash
pip install requests
```

You can copy `sdk/python/synapse_sdk.py` into your project, or install it as a local module.

---

## Quickstart

```python
from synapse_sdk import Synapse, AgentKilled

# Initialize Synapse client
synapse = Synapse(
    url="http://localhost:4000",
    api_key="your_api_key",
    project_id="my-ai-app"
)

# 1. Report individual telemetry events
synapse.report(
    agent_id="researcher-1",
    status="PROCESSING",
    agentName="Web Researcher",
    role="Research Agent",
    task="Browsing latest market reports",
    model="gpt-4o",
    tokensIn=450,
    tokensOut=150,
    costUsd=0.003,
    latencyMs=120,
    confidence=0.98,
    output="Retrieved 15 articles"
)

# 2. Use the automatic tracking context manager
try:
    with synapse.track("analyst-1", agent_name="Financial Analyst", role="Analyst") as t:
        t.task = "Running valuation model"
        # ... your LLM call or computation ...
        t.set_tokens(tokens_in=800, tokens_out=320)
        t.set_cost(0.005)
        t.set_output("Valuation estimate: $4.2M")
        t.set_handoff("decision-engine")
except AgentKilled:
    print("Agent was halted by operator kill switch!")

# 3. Request human approval for high-risk actions
approved = synapse.request_approval(
    agent_id="decision-engine",
    action="Execute Trade Order #991",
    amount=25000.00,
    reason="Exceeded automated risk ceiling"
)
if approved:
    print("Operator approved action!")
else:
    print("Action rejected or timed out.")
```

---

## Testing with Fake Agents

To simulate a real multi-agent swarm without writing custom code, run the bundled test script:

```bash
python sdk/python/scripts/fake_agent.py
```
This script will stream telemetry across 3 collaborating agents, trigger periodic handoffs, send high-cost alerts, and emit hallucination events to test the Observatory UI live.
