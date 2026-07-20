import uuid
from sqlalchemy import (
    Column, Integer, String, Boolean, Float, DateTime, 
    ForeignKey, Computed, JSON, func, UniqueConstraint
)
from sqlalchemy.orm import relationship
from .database import Base

class Speaker(Base):
    __tablename__ = "speakers"

    speaker_id = Column(String, primary_key=True)  # Format 'SPK_0042'
    token = Column(String, unique=True, default=lambda: str(uuid.uuid4()), nullable=False)
    age = Column(Integer, nullable=False)
    
    # Generated column for age band
    age_band = Column(
        String,
        Computed(
            "CASE "
            "WHEN age < 26 THEN '18-25' "
            "WHEN age < 36 THEN '26-35' "
            "WHEN age < 51 THEN '36-50' "
            "ELSE '50+' "
            "END"
        ),
        nullable=False
    )
    
    gender = Column(String, nullable=False)  # male, female, other, prefer_not_say
    l1 = Column(String, nullable=False)      # Native language
    region = Column(String, nullable=False)  # State/region
    consent_at = Column(DateTime(timezone=True), nullable=True)
    consent_version = Column(String, nullable=True)
    withdrawn_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    device_speakers = relationship("DeviceSpeaker", back_populates="speaker", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="speaker")
    clips = relationship("Clip", back_populates="speaker")

class Device(Base):
    __tablename__ = "devices"

    device_id = Column(String, primary_key=True)  # Client-generated UUID
    ua_class = Column(String, nullable=True)       # Device class from UA
    first_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_seen = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    device_speakers = relationship("DeviceSpeaker", back_populates="device")
    clips = relationship("Clip", back_populates="device")

class DeviceSpeaker(Base):
    __tablename__ = "device_speakers"

    device_id = Column(String, ForeignKey("devices.device_id", ondelete="CASCADE"), primary_key=True)
    speaker_id = Column(String, ForeignKey("speakers.speaker_id", ondelete="CASCADE"), primary_key=True)
    last_used_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    device = relationship("Device", back_populates="device_speakers")
    speaker = relationship("Speaker", back_populates="device_speakers")

class Scenario(Base):
    __tablename__ = "scenarios"

    scenario_id = Column(String, primary_key=True)  # e.g., 'BNK.block_card.v2.s1'
    domain = Column(String, nullable=False)         # BNK, EDU, TRV, VAS
    intent = Column(String, nullable=False)         # e.g. 'BNK.block_card'
    scenario_set = Column(String, nullable=False)   # v1, v2
    text_hi = Column(String, nullable=False)        # Hindi scenario description
    examples = Column(JSON, nullable=False)         # Exactly 3 seed phrasings (stored as list of strings)
    register = Column(String, nullable=True)        # Delivery tone e.g., 'urgent, alarmed'
    use_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    # Relationships
    tasks = relationship("Task", back_populates="scenario")

class Task(Base):
    __tablename__ = "tasks"

    task_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    speaker_id = Column(String, ForeignKey("speakers.speaker_id", ondelete="CASCADE"), nullable=False)
    domain = Column(String, nullable=False)         # BNK, EDU, TRV, VAS
    intent = Column(String, nullable=False)
    scenario_id = Column(String, ForeignKey("scenarios.scenario_id"), nullable=False)
    scenario_no = Column(Integer, nullable=False)
    example_no = Column(Integer, nullable=False)
    batch_no = Column(Integer, nullable=False)
    status = Column(String, nullable=False, default="pending")  # pending, recorded, skipped
    redo_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    speaker = relationship("Speaker", back_populates="tasks")
    scenario = relationship("Scenario", back_populates="tasks")
    clips = relationship("Clip", back_populates="task")

    # Add unique constraint to prevent duplicate tasks
    __table_args__ = (
        UniqueConstraint('speaker_id', 'scenario_id', 'example_no', 'batch_no', name='_speaker_scenario_example_batch_uc'),
    )

class Clip(Base):
    __tablename__ = "clips"

    clip_id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id = Column(String, ForeignKey("tasks.task_id", ondelete="CASCADE"), nullable=False)
    speaker_id = Column(String, ForeignKey("speakers.speaker_id", ondelete="CASCADE"), nullable=False)
    device_id = Column(String, ForeignKey("devices.device_id"), nullable=False)
    filename = Column(String, nullable=True)
    raw_path = Column(String, nullable=True)        # Path to raw file (e.g. 'storage/raw/BNK/SPK_0042/<clip_id>.webm')
    wav_path = Column(String, nullable=True)        # Path to processed file (e.g. 'storage/processed/BNK/SPK_0042/<filename>.wav')
    mime_type = Column(String, nullable=True)       # e.g., 'audio/webm;codecs=opus'
    duration_s = Column(Float, nullable=True)
    transcript_provisional = Column(String, nullable=True)
    transcript_final = Column(String, nullable=True)
    transcript_source = Column(String, nullable=True) # example_unedited, speaker_edited, asr, human_verified
    prompted = Column(Boolean, nullable=False, default=False)
    qc_flags = Column(JSON, nullable=False, default=list)  # Stored as list of strings
    status = Column(String, nullable=False, default="initiated")  # initiated, uploaded, confirmed, discarded, processing, processed, rejected
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    # Relationships
    task = relationship("Task", back_populates="clips")
    speaker = relationship("Speaker", back_populates="clips")
    device = relationship("Device", back_populates="clips")

class WithdrawalAudit(Base):
    __tablename__ = "withdrawal_audits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    speaker_id = Column(String, nullable=False)
    withdrawn_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    clips_deleted = Column(Integer, nullable=False, default=0)
    tasks_deleted = Column(Integer, nullable=False, default=0)
    processed_by = Column(String, nullable=True)
    notes = Column(String, nullable=True)
