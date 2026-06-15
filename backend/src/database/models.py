import datetime
from sqlalchemy import Column, Integer, String, Text, Float, DateTime
from src.database.connection import Base

class SessionHistory(Base):
    """SQLAlchemy object mapping for tracking autonomous agent workspace runs."""
    __tablename__ = "agent_session_history"

    id = Column(Integer, primary_key=True, index=True)
    task_description = Column(String(500), nullable=False)
    final_code = Column(Text, nullable=True)
    explanation = Column(Text, nullable=True)
    
    # Aggregated Telemetry Columns
    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_cost_usd = Column(Float, default=0.0)
    execution_time_ms = Column(Integer, default=0)
    
    # Cleaned up column wrapping here
    is_resolved = Column(Integer, default=0)  # 1 for Success, 0 for Failure
    created_at = Column(DateTime, default=datetime.datetime.utcnow)