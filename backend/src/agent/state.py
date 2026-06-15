from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class CodeGenerationSchema(BaseModel):
    """The strict structural schema the LLM must return when creating or editing code."""
    explanation: str = Field(..., description="Short engineering justification of the changes or implementation details.")
    code: str = Field(..., description="The raw executable Python script body. Absolutely no markdown wrappers.")

class AgentState(BaseModel):
    """The underlying state schema managed by our LangGraph workflow."""
    task_description: str = Field(..., description="The original prompt or bug fixing task.")
    current_code: str = Field(default="", description="The current iteration of the code script.")
    history: List[Dict[str, Any]] = Field(default_factory=list, description="Audit log of actions taken.")
    
    # State Trackers
    latest_explanation: str = Field(default="")
    latest_stdout: str = Field(default="")
    latest_stderr: str = Field(default="")
    latest_exit_code: int = Field(default=0)
    timed_out: bool = Field(default=False)
    required_packages: List[str] = Field(default_factory=list, description="List of third-party PyPI libraries needed for execution.")
    
    # Live Live Telemetry Aggregator Panel
    telemetry: Dict[str, Any] = Field(
        default_factory=lambda: {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_cost_usd": 0.0,
            "execution_time_ms": 0
        },
        description="Tracks token consumption metrics and processing time across execution nodes."
    )
    
    # Loop controls
    iteration_count: int = Field(default=0)
    max_iterations: int = Field(default=5)
    is_resolved: bool = Field(default=False)