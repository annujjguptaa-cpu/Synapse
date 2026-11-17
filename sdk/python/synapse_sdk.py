"""
Synapse Python SDK — Official client for Synapse OS Swarm Observability & Governance.
Single file, depends only on `requests`.
"""

import time
import logging
import functools
from contextlib import contextmanager
from typing import Any, Dict, Optional, Generator

try:
    import requests
except ImportError:
    raise ImportError("The synapse SDK requires the 'requests' package. Install it via: pip install requests")

logger = logging.getLogger("synapse_sdk")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(asctime)s] [Synapse-SDK] [%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


class AgentKilled(Exception):
    """Raised when an external agent has been terminated by the Synapse operator kill switch."""
    pass


class EventTracker:
    """Helper passed to a context block or decorator to record tokens, cost, and outputs."""
    def __init__(self, agent_id: str, client: "Synapse"):
        self.agent_id = agent_id
        self.client = client
        self.tokens_in: int = 0
        self.tokens_out: int = 0
        self.cost_usd: float = 0.0
        self.output: str = ""
        self.input: str = ""
        self.task: str = ""
        self.model: str = ""
        self.confidence: Optional[float] = None
        self.metadata: Dict[str, Any] = {}
        self.handoff_to: Optional[str] = None

    def set_tokens(self, tokens_in: int = 0, tokens_out: int = 0) -> None:
        self.tokens_in = tokens_in
        self.tokens_out = tokens_out

    def set_cost(self, cost_usd: float) -> None:
        self.cost_usd = cost_usd

    def set_output(self, output: str) -> None:
        self.output = output

    def set_input(self, input_data: str) -> None:
        self.input = input_data

    def set_handoff(self, next_agent_id: str) -> None:
        self.handoff_to = next_agent_id


class Synapse:
    """
    Synapse OS Client
    """
    def __init__(self, url: str = "http://localhost:4000", api_key: str = "", project_id: str = "default", timeout: float = 4.0):
        self.url = url.rstrip("/")
        self.api_key = api_key
        self.project_id = project_id
        self.timeout = timeout
        self.headers = {
            "Content-Type": "application/json",
            "x-synapse-key": self.api_key
        }

    def _post(self, path: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        endpoint = f"{self.url}{path}"
        try:
            resp = requests.post(endpoint, json=payload, headers=self.headers, timeout=self.timeout)
            if resp.status_code in (200, 201, 202):
                return resp.json()
            elif resp.status_code == 401:
                logger.error("Authentication failed: invalid x-synapse-key header.")
                return None
            else:
                logger.warning(f"Synapse returned status {resp.status_code}: {resp.text}")
                return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"Could not connect to Synapse at {self.url}: {e}. Continuing without telemetry.")
            return None

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        endpoint = f"{self.url}{path}"
        try:
            resp = requests.get(endpoint, params=params, headers=self.headers, timeout=self.timeout)
            if resp.status_code == 200:
                return resp.json()
            return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"Could not connect to Synapse at {self.url}: {e}.")
            return None

    def check_control(self, agent_id: str) -> str:
        """
        Check the remote control state of an agent: 'running' | 'paused' | 'killed'.
        """
        data = self._get(f"/api/v1/agents/{agent_id}/control", params={"projectId": self.project_id})
        if data and "state" in data:
            return data["state"]
        return "running"

    def _enforce_control(self, agent_id: str) -> None:
        """
        Verifies control state. If 'killed', raises AgentKilled. If 'paused', blocks until resumed.
        """
        state = self.check_control(agent_id)
        if state == "killed":
            raise AgentKilled(f"Agent '{agent_id}' has been terminated by the Synapse kill switch.")

        while state == "paused":
            logger.info(f"Agent '{agent_id}' is PAUSED by Synapse operator. Waiting for resume...")
            time.sleep(2)
            state = self.check_control(agent_id)
            if state == "killed":
                raise AgentKilled(f"Agent '{agent_id}' has been terminated by the Synapse kill switch.")

    def report(self, agent_id: str, status: str, **fields) -> Dict[str, Any]:
        """
        Sends one event to Synapse and returns the server response.
        Enforces pause/kill control policy automatically.
        """
        self._enforce_control(agent_id)

        payload = {
            "projectId": self.project_id,
            "agentId": agent_id,
            "status": status.upper(),
            **fields
        }

        resp = self._post("/api/v1/events", payload)
        if resp and resp.get("control") == "killed":
            raise AgentKilled(f"Agent '{agent_id}' killed via event response.")

        return resp or {"ok": False, "hrs": 0.0, "control": "running"}

    @contextmanager
    def track(self, agent_id: str, agent_name: str = "", role: str = "") -> Generator[EventTracker, None, None]:
        """
        Context manager that measures latency, sends PROCESSING, COMPLETED or ERROR.
        Usage:
            with synapse.track("analyzer", "Market Analyzer", "Analyst") as t:
                # do work...
                t.set_output("result data")
                t.set_tokens(100, 50)
        """
        self._enforce_control(agent_id)
        tracker = EventTracker(agent_id, self)
        start_time = time.time()

        # Send starting PROCESSING status
        self.report(
            agent_id=agent_id,
            status="PROCESSING",
            agentName=agent_name or agent_id,
            role=role,
            task=tracker.task or "Processing step started",
            input=tracker.input
        )

        try:
            yield tracker
            elapsed_ms = (time.time() - start_time) * 1000
            self.report(
                agent_id=agent_id,
                status="COMPLETED",
                agentName=agent_name or agent_id,
                role=role,
                task=tracker.task or "Completed processing",
                input=tracker.input,
                output=tracker.output,
                model=tracker.model,
                tokensIn=tracker.tokens_in,
                tokensOut=tracker.tokens_out,
                costUsd=tracker.cost_usd,
                latencyMs=elapsed_ms,
                confidence=tracker.confidence,
                handoffTo=tracker.handoff_to,
                metadata=tracker.metadata
            )
        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            self.report(
                agent_id=agent_id,
                status="ERROR",
                agentName=agent_name or agent_id,
                role=role,
                task=f"Error: {str(e)}",
                output=str(e),
                latencyMs=elapsed_ms,
                metadata={"error": str(e)}
            )
            raise e

    def request_approval(self, agent_id: str, action: str, amount: float = 0.0, reason: str = "", details: Optional[Dict[str, Any]] = None, timeout_s: int = 300) -> bool:
        """
        Requests human approval in the Synapse dashboard.
        Blocks and polls every 2 seconds until decided or timed out.
        Returns True if approved, False if rejected or timed out.
        """
        self._enforce_control(agent_id)

        payload = {
            "projectId": self.project_id,
            "agentId": agent_id,
            "action": action,
            "amount": amount,
            "reason": reason or action,
            "details": details or {}
        }

        res = self._post("/api/v1/approvals", payload)
        if not res or "approvalId" not in res:
            logger.warning(f"Failed to submit approval request for agent '{agent_id}'. Approving by default fallback.")
            return True

        approval_id = res["approvalId"]
        logger.info(f"Submitted approval '{approval_id}' for agent '{agent_id}' ({action}). Waiting for operator...")

        start_time = time.time()
        while time.time() - start_time < timeout_s:
            self._enforce_control(agent_id)
            poll_res = self._get(f"/api/v1/approvals/{approval_id}")
            if poll_res:
                status = poll_res.get("status", "pending")
                if status == "approved":
                    logger.info(f"Approval '{approval_id}' APPROVED by operator.")
                    return True
                elif status == "rejected":
                    logger.warning(f"Approval '{approval_id}' REJECTED by operator.")
                    return False
            time.sleep(2)

        logger.warning(f"Approval '{approval_id}' timed out after {timeout_s}s.")
        return False
