"""Pydantic models: the API contract and the validated analysis structure."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Priority = Literal["High", "Medium", "Low"]
DecisionStatus = Literal["confirmed", "needs_clarification"]


class AnalyzeRequest(BaseModel):
    transcript: str = Field(default="", max_length=400_000)  # real limit enforced from settings
    title: str = Field(default="", max_length=200)
    meeting_date: str | None = Field(default=None, max_length=40)
    participants: list[str] = Field(default_factory=list, max_length=50)
    project: str = Field(default="", max_length=200)
    mode: Literal["auto", "ai", "demo"] = "auto"

    @field_validator("participants")
    @classmethod
    def _clean_participants(cls, v: list[str]) -> list[str]:
        out = []
        for p in v:
            p = (p or "").strip()[:100]
            if p and p not in out:
                out.append(p)
        return out


class Decision(BaseModel):
    description: str = Field(min_length=1, max_length=1000)
    evidence: str = Field(default="", max_length=1500)
    evidence_verified: bool = False
    topic: str | None = Field(default=None, max_length=200)
    status: DecisionStatus = "needs_clarification"


class ActionItem(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=1500)
    owner: str = Field(default="Unassigned", max_length=120)
    due_date: str | None = None          # ISO yyyy-mm-dd, only when it could be determined
    due_text: str | None = Field(default=None, max_length=120)  # the wording used in the meeting
    priority: Priority = "Medium"
    topic: str | None = Field(default=None, max_length=200)
    evidence: str = Field(default="", max_length=1500)
    evidence_verified: bool = False
    confidence: float | None = Field(default=None, ge=0, le=1)
    needs_review: bool = False
    needs_clarification: bool = False
    review_reasons: list[str] = Field(default_factory=list)


class Analysis(BaseModel):
    meeting_summary: str = Field(default="", max_length=4000)
    main_topics: list[str] = Field(default_factory=list)
    outcomes: list[str] = Field(default_factory=list)
    unresolved: list[str] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)
    action_items: list[ActionItem] = Field(default_factory=list)
    discussion_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    blockers: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
