from __future__ import annotations

from typing import Callable, Dict, Optional

from backend.agents.accountant_agent import run_accounting_analysis
from backend.agents.classifier_agent import run_classification
from backend.agents.cross_validator_agent import run_cross_validation
from backend.agents.data_extractor_agent import extract_documents
from backend.agents.intelligence_agent import run_intelligence_analysis
from backend.agents.validator_agent import run_audit
from backend.types import AgentPhase, GraphState, StatusRepository


class StatusCallback:
    def __init__(self, repository: Optional[StatusRepository] = None):
        self.repository = repository

    def on_start(self, task_id: str, phase: AgentPhase) -> None:
        if self.repository:
            self.repository.update_agent_status(task_id, phase, "running")

    def on_end(self, task_id: str, phase: AgentPhase) -> None:
        if self.repository:
            self.repository.update_agent_status(task_id, phase, "completed")

    def on_error(self, task_id: str, phase: AgentPhase, error: Exception) -> None:
        if self.repository:
            self.repository.update_agent_status(task_id, phase, f"error:{error}")


class AgentGraph:
    def __init__(self, status_repository: Optional[StatusRepository] = None):
        self.callback = StatusCallback(status_repository)

    def _run_node(self, state: GraphState, phase: AgentPhase, func: Callable[[GraphState], GraphState]) -> GraphState:
        self.callback.on_start(state.task_id, phase)
        try:
            new_state = func(state)
        except Exception as error:
            state.errors.append(str(error))
            self.callback.on_error(state.task_id, phase, error)
            raise
        else:
            self.callback.on_end(state.task_id, phase)
            return new_state

    def invoke(self, state_input: Dict[str, object] | GraphState) -> GraphState:
        state = state_input if isinstance(state_input, GraphState) else GraphState(**state_input)
        state = self._run_node(state, AgentPhase.OCR, _ocr_node)
        state = self._run_node(state, AgentPhase.AUDITOR, _auditor_node)
        state = self._run_node(state, AgentPhase.CLASSIFIER, _classifier_node)
        state = self._run_node(state, AgentPhase.CROSS_VALIDATOR, _cross_validator_node)
        state = self._run_node(state, AgentPhase.INTELLIGENCE, _intelligence_node)
        state = self._run_node(state, AgentPhase.ACCOUNTANT, _accountant_node)
        return state


def _ocr_node(state: GraphState) -> GraphState:
    documents = extract_documents(state.source_files)
    new_state = state.copy()
    new_state.imported_docs = documents
    return new_state


def _auditor_node(state: GraphState) -> GraphState:
    report = run_audit(state.imported_docs)
    new_state = state.copy()
    new_state.audit_report = report
    return new_state


def _classifier_node(state: GraphState) -> GraphState:
    if not state.audit_report:
        return state
    report = run_classification(state.audit_report)
    new_state = state.copy()
    new_state.audit_report = report
    return new_state


def _cross_validator_node(state: GraphState) -> GraphState:
    if not state.audit_report:
        return state
    report = run_cross_validation(state.audit_report)
    new_state = state.copy()
    new_state.audit_report = report
    return new_state


def _intelligence_node(state: GraphState) -> GraphState:
    if not state.audit_report:
        return state
    intelligence = run_intelligence_analysis(state.audit_report)
    report = state.audit_report
    report.aiDrivenInsights = intelligence["aiDrivenInsights"]
    report.crossValidationResults = intelligence["crossValidationResults"]
    new_state = state.copy()
    new_state.audit_report = report
    return new_state


def _accountant_node(state: GraphState) -> GraphState:
    if not state.audit_report:
        return state
    report = run_accounting_analysis(state.audit_report)
    new_state = state.copy()
    new_state.audit_report = report
    return new_state


def create_graph(status_repository: Optional[StatusRepository] = None) -> AgentGraph:
    return AgentGraph(status_repository=status_repository)
