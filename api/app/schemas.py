from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import List, Optional

# Generic Error schema
class ErrorDetails(BaseModel):
    code: str
    message: str
    details: Optional[dict] = None

class ErrorResponse(BaseModel):
    error: ErrorDetails

# Device schemas
class DeviceCreate(BaseModel):
    device_id: str = Field(..., description="Client-generated device UUID")
    ua_class: Optional[str] = Field(None, description="Sanitized device class")

    @field_validator("device_id")
    @classmethod
    def validate_uuid(cls, v: str) -> str:
        import uuid
        try:
            uuid.UUID(v)
        except ValueError:
            raise ValueError("Invalid UUID format for device_id")
        return v

class DeviceResponse(BaseModel):
    device_id: str
    first_seen: datetime

    class Config:
        from_attributes = True

# Speaker schemas
class SpeakerCreate(BaseModel):
    name: Optional[str] = Field(None, description="Volunteer name")
    age: int = Field(..., ge=10, le=100, description="Speaker age between 10 and 100")
    gender: str = Field(..., description="Gender: male, female, other, prefer_not_say")
    l1: str = Field(..., min_length=1, description="Native language")
    region: str = Field(..., min_length=1, description="State/region")
    consent_version: str = Field(..., min_length=1, description="Version of the consent agreed to")

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: str) -> str:
        allowed = {"male", "female", "other", "prefer_not_say"}
        if v not in allowed:
            raise ValueError(f"Gender must be one of {allowed}")
        return v

class SpeakerResponse(BaseModel):
    speaker_id: str
    name: Optional[str] = None
    token: str
    age_band: str
    consent_at: datetime
    assigned_domain: Optional[str] = None

    class Config:
        from_attributes = True

class SpeakerRosterItem(BaseModel):
    speaker_id: str
    name: Optional[str] = None
    age_band: str
    gender: str
    last_used_at: datetime

    class Config:
        from_attributes = True

class SpeakerRosterResponse(BaseModel):
    speakers: List[SpeakerRosterItem]

# Task schemas
class TaskResponse(BaseModel):
    task_id: str
    # Server-authoritative: the client must never choose or override this.
    domain: str
    intent: str
    scenario_id: str
    scenario_no: int
    example_no: int
    text_hi: str
    examples: List[str]
    register: Optional[str] = None
    status: str
    redo_count: int

    class Config:
        from_attributes = True

# Session progress schemas
class ProgressInfo(BaseModel):
    intents_total: int
    intents_done: int
    current_intent: Optional[str] = None
    scenarios_in_intent: int
    scenarios_done: int
    examples_in_scenario: int
    examples_done: int

class SessionBatchInfo(BaseModel):
    domain: str
    batch_no: int
    tasks: List[TaskResponse]
    progress: ProgressInfo
    assigned_domain: Optional[str] = None

class SessionResponse(BaseModel):
    batch: SessionBatchInfo

# Clip schemas
class ClipInitRequest(BaseModel):
    task_id: str
    mime_type: str = Field("audio/webm;codecs=opus", description="MIME type of recorded audio")

class ClipInitResponse(BaseModel):
    clip_id: str
    filename: str
    upload_url: str
    upload_expires_at: datetime

class ClipConfirmRequest(BaseModel):
    transcript_edit: Optional[str] = None
    prompted: bool = False

class ClipConfirmResponse(BaseModel):
    clip_id: str
    status: str
    next_task: Optional[TaskResponse] = None

class ClipDiscardResponse(BaseModel):
    clip_id: str
    status: str
    task: TaskResponse

# Multi-level progress schemas (/api/progress)
class ExampleProgressInfo(BaseModel):
    example_no: int
    status: str

class ScenarioProgressInfo(BaseModel):
    scenario_no: int
    total_scenarios: int
    examples: List[ExampleProgressInfo]

class IntentProgressInfo(BaseModel):
    intent: str
    intent_no: int
    total_intents: int
    status: str  # pending, in_progress, recorded
    scenarios: List[ScenarioProgressInfo]

class ProgressResponse(BaseModel):
    domain: str
    batch_no: int
    intents: List[IntentProgressInfo]

# Admin schemas
class AdminLoginRequest(BaseModel):
    username: str
    password: str

class AdminLoginResponse(BaseModel):
    token: str
    expires_at: datetime

class AdminStatsResponse(BaseModel):
    total_speakers: int
    total_recordings: int
    confirmed_clips: int
    redo_count: int
    qc_passed: int
    qc_failed: int

class ClipReviewItem(BaseModel):
    clip_id: str
    task_id: str
    speaker_id: str
    device_id: str
    domain: str
    intent: str
    scenario_id: str
    filename: Optional[str]
    duration_s: Optional[float]
    qc_flags: List[str]
    status: str
    transcript_provisional: Optional[str]
    transcript_final: Optional[str]
    transcript_source: Optional[str]
    created_at: datetime

class ClipReviewResponse(BaseModel):
    clips: List[ClipReviewItem]

class ClipReviewActionRequest(BaseModel):
    action: str  # accept, reject, edit_transcript
    transcript_final: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        allowed = {"accept", "reject", "edit_transcript"}
        if v not in allowed:
            raise ValueError(f"Action must be one of {allowed}")
        return v

class QRItem(BaseModel):
    speaker_id: str
    token: str
    qr_data_url: str

class QRGenerateResponse(BaseModel):
    codes: List[QRItem]

class SpeakerClipItem(BaseModel):
    clip_id: str
    task_id: str
    domain: str
    intent: str
    scenario_id: str
    filename: Optional[str]
    duration_s: Optional[float]
    transcript_final: Optional[str]
    status: str
    created_at: datetime

class SpeakerClipsResponse(BaseModel):
    clips: List[SpeakerClipItem]

class AssignDomainRequest(BaseModel):
    domain: str

class AdminCoverageItem(BaseModel):
    domain: str
    intent: str
    clips_processed: int
    speakers_count: int
    floor: int = 40

class AdminCoverageResponse(BaseModel):
    coverage: List[AdminCoverageItem]
