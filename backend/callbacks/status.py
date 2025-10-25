from __future__ import annotations

from typing import Any, Optional

from langchain.callbacks.base import BaseCallbackHandler

from backend.types import AgentPhase, StatusRepository


class StatusCallbackHandler(BaseCallbackHandler):
    """LangChain callback that reports the execution status of each graph node."""

    def __init__(self, repository: StatusRepository):
        self.repository = repository

    def _extract_task_id(self, inputs: dict[str, Any]) -> Optional[str]:
        if "task_id" in inputs:
            return str(inputs["task_id"])
        state = inputs.get("state")
        if isinstance(state, dict) and "task_id" in state:
            return str(state["task_id"])
        return None

    def on_chain_start(self, serialized: dict[str, Any], inputs: dict[str, Any], **kwargs: Any) -> None:
        task_id = self._extract_task_id(inputs)
        if not task_id:
            return
        node = serialized.get("id") or serialized.get("name") or serialized.get("run_id")
        if not node:
            return
        phase = AgentPhase(node)
        self.repository.update_agent_status(task_id, phase, "running")

    def on_chain_end(self, outputs: dict[str, Any], **kwargs: Any) -> None:
        task_id = self._extract_task_id(kwargs.get("inputs", {}))
        node = kwargs.get("name")
        if not task_id or not node:
            return
        phase = AgentPhase(node)
        self.repository.update_agent_status(task_id, phase, "completed")

    def on_chain_error(self, error: BaseException, **kwargs: Any) -> None:
        task_id = self._extract_task_id(kwargs.get("inputs", {}))
        node = kwargs.get("name")
        if not task_id or not node:
            return
        phase = AgentPhase(node)
        self.repository.update_agent_status(task_id, phase, f"error:{error}")
