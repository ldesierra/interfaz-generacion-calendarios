from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class CaseCreated(BaseModel):
    case_id: str
    created_at: datetime
    files_received: list[str]


class ValidationIssue(BaseModel):
    file: str
    issue: str


class SchemaValidationError(BaseModel):
    error: Literal["schema_validation_failed"] = "schema_validation_failed"
    details: list[ValidationIssue]
