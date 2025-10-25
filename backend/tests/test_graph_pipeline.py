from __future__ import annotations

from pathlib import Path

from backend.graph import create_graph
from backend.types import AgentPhase, GraphState


def test_graph_executes_pipeline(sample_csv: Path, sample_csv_alt: Path, repositories) -> None:
    status_repo = repositories["status"]
    graph = create_graph(status_repository=status_repo)
    state = GraphState(task_id="task-1", source_files=[str(sample_csv), str(sample_csv_alt)])
    result = graph.invoke(state)
    assert result.audit_report is not None
    assert result.audit_report.summary is not None
    completed_phases = {phase for _, phase, status in status_repo.agent_updates if status == "completed"}
    assert completed_phases == {
        AgentPhase.OCR,
        AgentPhase.AUDITOR,
        AgentPhase.CLASSIFIER,
        AgentPhase.CROSS_VALIDATOR,
        AgentPhase.INTELLIGENCE,
        AgentPhase.ACCOUNTANT,
    }
