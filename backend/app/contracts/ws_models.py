from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


class _WsMessageBase(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str
    request_id: str | None = None


class NotebookCreateMessage(_WsMessageBase):
    type: Literal["notebook_create"]
    cwd: str | None = None
    path: str | None = None
    previous_kernel_id: str | None = None


class NotebookLoadMessage(_WsMessageBase):
    type: Literal["notebook_load"]
    content: str | dict[str, Any]
    cwd: str | None = None
    path: str | None = None
    previous_kernel_id: str | None = None


class NotebookAttachKernelMessage(_WsMessageBase):
    type: Literal["notebook_attach_kernel"]
    kernel_id: str | None = None
    path: str | None = None

    @model_validator(mode="after")
    def _validate_attach_target(self) -> "NotebookAttachKernelMessage":
        if self.kernel_id or self.path:
            return self
        raise ValueError("kernel_id or path is required")


class NotebookSaveMessage(_WsMessageBase):
    type: Literal["notebook_save"]
    notebook: dict[str, Any]


class NotebookExecuteCellMessage(_WsMessageBase):
    type: Literal["notebook_execute_cell"]
    kernel_id: str
    execution_id: str | None = None
    cell_id: str | None = None
    cell_index: int | None = None
    cell_type: str | None = None
    source: str | list[str] | None = None
    execution_timeout_s: float | None = Field(default=None, gt=0)
    emit_docx: bool | None = None
    docx_validation: bool | None = None
    enable_tracing: bool | None = None
    skip_pdf: bool | None = None

    @field_validator("execution_timeout_s", mode="before")
    @classmethod
    def _validate_execution_timeout_s(cls, value: float | None) -> float | None:
        if isinstance(value, bool):
            raise ValueError("execution_timeout_s must be a positive number")
        return value


class NotebookCancelExecutionMessage(_WsMessageBase):
    type: Literal["notebook_cancel_execution"]
    kernel_id: str
    execution_id: str | None = None


class ExecuteCodeMessage(_WsMessageBase):
    type: Literal["execute_code"]
    code: str
    file_path: str | None = None
    run_id: str | None = None


class CancelCodeExecutionMessage(_WsMessageBase):
    type: Literal["cancel_code_execution"]
    run_id: str | None = None
    file_path: str | None = None

    @model_validator(mode="after")
    def _validate_cancel_target(self) -> "CancelCodeExecutionMessage":
        if self.run_id or self.file_path:
            return self
        raise ValueError("run_id or file_path is required")


class TemplateUploadMessage(_WsMessageBase):
    type: Literal["template_upload"]
    kernel_id: str
    docx_base64: str


class TemplateAttachMessage(_WsMessageBase):
    type: Literal["template_attach"]
    kernel_id: str
    template_token: str


class TemplateUpdateStyleMessage(_WsMessageBase):
    type: Literal["template_update_style"]
    kernel_id: str
    style_name: str
    updates: dict[str, Any] = Field(default_factory=dict)


class TemplateUpdateDocumentDefaultsMessage(_WsMessageBase):
    type: Literal["template_update_document_defaults"]
    kernel_id: str
    updates: dict[str, Any] = Field(default_factory=dict)


class TemplateUpdateSemanticSlotsMessage(_WsMessageBase):
    type: Literal["template_update_semantic_slots"]
    kernel_id: str
    semantic_style_slots: dict[str, Any] = Field(default_factory=dict)


class TemplatePreviewStyleMessage(_WsMessageBase):
    type: Literal["template_preview_style"]
    kernel_id: str
    style_name: str | None = None
    style_props: dict[str, Any] = Field(default_factory=dict)
    preview_key: str | None = None
    force_refresh: bool | int | str | None = None
    style_id: str | None = None
    is_table_style: bool | None = None
    category: str | None = None


class TemplatePreviewCancelMessage(_WsMessageBase):
    type: Literal["template_preview_cancel"]
    kernel_id: str
    preview_key: str | None = None


class AnalyzeDependenciesMessage(_WsMessageBase):
    type: Literal["analyze_dependencies"]
    symbol: str
    source_code: str | None = None
    line: int | None = None
    column: int | None = None
    notebook_context: list[str] | None = None
    file_path: str | None = None
    max_depth: int | None = None
    kernel_id: str | None = None
    context_cell_ids: list[str] | None = None
    cell_id: str | None = None

    @field_validator("symbol")
    @classmethod
    def _validate_symbol(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("symbol must be a non-empty string")
        return value


class AnalyzeImpactMessage(_WsMessageBase):
    type: Literal["analyze_impact"]
    symbol: str
    source_code: str | None = None
    line: int | None = None
    column: int | None = None
    notebook_context: list[str] | None = None
    file_path: str | None = None
    max_depth: int | None = None
    context_cell_ids: list[str] | None = None
    cell_id: str | None = None

    @field_validator("symbol")
    @classmethod
    def _validate_symbol(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("symbol must be a non-empty string")
        return value


class SensitivityAnalyzeMessage(_WsMessageBase):
    type: Literal["sensitivity_analyze"]
    modified_variables: dict[str, Any] = Field(default_factory=dict)
    output_variables: list[str] = Field(default_factory=list)
    formulas: dict[str, Any] = Field(default_factory=dict)
    current_values: dict[str, Any] = Field(default_factory=dict)


class OptimizeDesignMessage(_WsMessageBase):
    type: Literal["optimize_design"]
    objective: dict[str, Any] = Field(default_factory=dict)
    variables: list[dict[str, Any]] = Field(default_factory=list)
    constraints: list[dict[str, Any]] = Field(default_factory=list)
    formulas: dict[str, Any] = Field(default_factory=dict)
    current_values: dict[str, Any] = Field(default_factory=dict)
    iterations: int | None = None
    seed: int | None = None
    kernel_id: str | None = None


class AnalyzeLoadEnvelopeMessage(_WsMessageBase):
    type: Literal["analyze_load_envelope"]
    combinations: list[dict[str, Any]] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    formulas: dict[str, Any] = Field(default_factory=dict)
    current_values: dict[str, Any] = Field(default_factory=dict)


class RunCodeChecksMessage(_WsMessageBase):
    type: Literal["run_code_checks"]
    code_profile: str | None = None
    checks: list[dict[str, Any]] = Field(default_factory=list)
    formulas: dict[str, Any] = Field(default_factory=dict)
    current_values: dict[str, Any] = Field(default_factory=dict)


class CompareScenariosMessage(_WsMessageBase):
    type: Literal["compare_scenarios"]
    baseline: dict[str, Any] = Field(default_factory=dict)
    candidates: list[dict[str, Any]] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    formulas: dict[str, Any] = Field(default_factory=dict)
    current_values: dict[str, Any] = Field(default_factory=dict)


_MODEL_BY_TYPE: dict[str, type[BaseModel]] = {
    "notebook_create": NotebookCreateMessage,
    "notebook_load": NotebookLoadMessage,
    "notebook_attach_kernel": NotebookAttachKernelMessage,
    "notebook_save": NotebookSaveMessage,
    "notebook_execute_cell": NotebookExecuteCellMessage,
    "notebook_cancel_execution": NotebookCancelExecutionMessage,
    "execute_code": ExecuteCodeMessage,
    "cancel_code_execution": CancelCodeExecutionMessage,
    "template_upload": TemplateUploadMessage,
    "template_attach": TemplateAttachMessage,
    "template_update_document_defaults": TemplateUpdateDocumentDefaultsMessage,
    "template_update_semantic_slots": TemplateUpdateSemanticSlotsMessage,
    "template_update_style": TemplateUpdateStyleMessage,
    "template_preview_style": TemplatePreviewStyleMessage,
    "template_preview_cancel": TemplatePreviewCancelMessage,
    "analyze_dependencies": AnalyzeDependenciesMessage,
    "analyze_impact": AnalyzeImpactMessage,
    "sensitivity_analyze": SensitivityAnalyzeMessage,
    "optimize_design": OptimizeDesignMessage,
    "analyze_load_envelope": AnalyzeLoadEnvelopeMessage,
    "run_code_checks": RunCodeChecksMessage,
    "compare_scenarios": CompareScenariosMessage,
}


def _format_validation_errors(exc: ValidationError) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for item in exc.errors():
        loc_tuple = item.get("loc", ())
        loc = ".".join(str(part) for part in loc_tuple) if loc_tuple else "<root>"
        errors.append(
            {
                "loc": loc,
                "message": item.get("msg"),
                "error_type": item.get("type"),
            }
        )
    return errors


def validate_ws_message_payload(message_type: str, payload: dict[str, Any]) -> tuple[bool, list[dict[str, Any]]]:
    model = _MODEL_BY_TYPE.get(message_type)
    if model is None:
        return True, []

    try:
        model.model_validate(payload)
        return True, []
    except ValidationError as exc:
        return False, _format_validation_errors(exc)
