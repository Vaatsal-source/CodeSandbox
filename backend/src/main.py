import os
import logging
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from contextlib import asynccontextmanager

from src.agent.graph import build_workflow_graph
from src.agent.state import AgentState
from src.database.connection import engine, Base, AsyncSessionLocal
from src.database.models import SessionHistory

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FastAPIServer")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Executes structural database schema compilations upon API instance boots."""
    logger.info("🐘 Database Lifecycle: Connecting to Neon PostgreSQL and compiling tables...")
    async with engine.begin() as conn:
        # Automatically builds the agent_session_history table inside Neon if absent
        await conn.run_sync(Base.metadata.create_all)
    yield
    logger.info("🔌 Shutting down backend telemetry stream instances...")

# Unified Single FastAPI Declaration with Lifespan Database Initialization Hook
app = FastAPI(title="Autonomous Code Fixer Agent Backend", lifespan=lifespan)

# Enable CORS so our Next.js frontend can communicate with it
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compile our LangGraph agent workflow once on startup
agent_executor = build_workflow_graph()

class TaskRequest(BaseModel):
    task_description: str

async def get_db():
    """Dependency helper yielding scoped async database session connections."""
    async with AsyncSessionLocal() as session:
        yield session

@app.get("/health")
def health_check():
    return {"status": "healthy", "infrastructure": "Docker & Gemini Live"}

@app.get("/api/history")
async def fetch_all_session_history(db: AsyncSession = Depends(get_db)):
    """Retrieves an ordered history list of all past autonomous agent execution records from Neon."""
    try:
        result = await db.execute(
            select(SessionHistory).order_by(SessionHistory.created_at.desc())
        )
        sessions = result.scalars().all()
        return [
            {
                "id": s.id,
                "task_description": s.task_description,
                "final_code": s.final_code,
                "explanation": s.explanation,
                "metrics": {
                    "input_tokens": s.input_tokens,
                    "output_tokens": s.output_tokens,
                    "total_cost_usd": s.total_cost_usd,
                    "execution_time_ms": s.execution_time_ms
                },
                "is_resolved": bool(s.is_resolved),
                "created_at": s.created_at.isoformat()
            }
            for s in sessions
        ]
    except Exception as e:
        logger.error(f"❌ Failed to fetch database history log packets: {e}")
        return []

@app.delete("/api/history/{session_id}")
async def delete_session_record(session_id: int, db: AsyncSession = Depends(get_db)):
    """Permanently deletes a specific engineering execution record from Neon SQL."""
    try:
        result = await db.execute(select(SessionHistory).where(SessionHistory.id == session_id))
        session_record = result.scalar_one_or_none()
        
        if not session_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, 
                detail=f"Session record matching ID {session_id} could not be located."
            )
            
        await db.delete(session_record)
        await db.commit()
        logger.info(f"🗑️ Neon DB: Session execution record #{session_id} successfully dropped.")
        return {"status": "success", "message": f"Session {session_id} dropped successfully."}
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"❌ Failed to execute drop execution query on record #{session_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error deleting database record cluster."
        )

@app.websocket("/ws/agent")
async def websocket_agent_endpoint(websocket: WebSocket):
    """
    Handles live, bidirectional communication with the Next.js frontend dashboard.
    Supports initial generation tasks, manual code verification updates, and persistent state logging.
    """
    await websocket.accept()
    logger.info("🔌 WebSocket Connection established with frontend client.")
    
    try:
        while True:
            data = await websocket.receive_json()
            action_type = data.get("action", "initial_task")
            
            # --- Scenario A: User sends a brand new natural language objective ---
            if action_type == "initial_task":
                task_description = data.get("task_description")
                if not task_description:
                    await websocket.send_json({"error": "Task description missing."})
                    continue
                    
                logger.info(f"🚀 Received coding objective from scratch: {task_description}")
                initial_state = AgentState(task_description=task_description)
                
            # --- Scenario B: User iteratively requests features/changes built on current code ---
            elif action_type == "iterative_refinement":
                user_code = data.get("code", "")
                task_description = data.get("task_description", "Refine existing logic canvas state.")
                previous_packages = data.get("required_packages", [])
                
                logger.info(f"🔄 Iterative Update: Modifying current code structure with prompt: {task_description}")
                
                # We feed the existing working code directly into current_code so LangGraph modifies it
                initial_state = AgentState(
                    task_description=task_description,
                    current_code=user_code,
                    required_packages=previous_packages,
                    iteration_count=0
                )

            # --- Scenario C: User manually edited code in Monaco and hit 'Run Tests' ---
            elif action_type == "human_intervention":
                user_code = data.get("code")
                task_description = data.get("task_description", "Manual human refinement review.")
                previous_packages = data.get("required_packages", [])
                
                logger.info("👤 Human Intercept: Running user-modified script variation through sandbox...")
                
                initial_state = AgentState(
                    task_description=task_description,
                    current_code=user_code,
                    required_packages=previous_packages,
                    iteration_count=0
                )
            
            else:
                await websocket.send_json({"error": f"Unknown action type: {action_type}"})
                continue

            # Local reference to capture state payload data through loop updates
            last_recorded_state = None

            try:
                # Execute the LangGraph streaming state machine lifecycle
                for event in agent_executor.stream(initial_state, stream_mode="updates"):
                    if not event:
                        continue
                    node_name = list(event.keys())[0]
                    state_update = event[node_name]
                    last_recorded_state = state_update
                    
                    payload = {
                        "event": "node_update",
                        "node": node_name,
                        "current_code": state_update.get("current_code", ""),
                        "latest_explanation": state_update.get("latest_explanation", ""),
                        "latest_stdout": state_update.get("latest_stdout", ""),
                        "latest_stderr": state_update.get("latest_stderr", ""),
                        "latest_exit_code": state_update.get("latest_exit_code", 0),
                        "iteration_count": state_update.get("iteration_count", 0),
                        "is_resolved": state_update.get("is_resolved", False),
                        "required_packages": state_update.get("required_packages", []),
                        "telemetry": state_update.get("telemetry", {
                            "input_tokens": 0, "output_tokens": 0, "total_cost_usd": 0.0, "execution_time_ms": 0
                        })
                    }
                    await websocket.send_json(payload)
                    
                # 🏁 Graph cycle execution complete -> Log final metrics bundle to Neon Database
                if last_recorded_state:
                    telemetry_data = last_recorded_state.get("telemetry", {})
                    async with AsyncSessionLocal() as db_session:
                        try:
                            history_record = SessionHistory(
                                task_description=task_description,
                                final_code=last_recorded_state.get("current_code", ""),
                                explanation=last_recorded_state.get("latest_explanation", ""),
                                input_tokens=telemetry_data.get("input_tokens", 0),
                                output_tokens=telemetry_data.get("output_tokens", 0),
                                total_cost_usd=telemetry_data.get("total_cost_usd", 0.0),
                                execution_time_ms=telemetry_data.get("execution_time_ms", 0),
                                is_resolved=1 if last_recorded_state.get("is_resolved", False) else 0
                            )
                            db_session.add(history_record)
                            await db_session.commit()
                            logger.info("💾 Neon DB: Session execution history successfully persisted.")
                        except Exception as db_err:
                            await db_session.rollback()
                            logger.error(f"❌ Neon DB Save Error Failure: {db_err}")

                await websocket.send_json({"event": "execution_complete"})

            except Exception as graph_err:
                # Intercept 429 Quota or Model call failures directly within streaming iteration
                logger.error(f"❌ Graph Node Generation Failure: {graph_err}")
                error_msg = str(graph_err)
                
                # Check if it looks like a quota rate limit issue
                if "429" in error_msg or "quota" in error_msg.lower():
                    friendly_notice = "⚠️ GEMINI API QUOTA EXCEEDED: You have hit the 20 requests/day Free Tier threshold. Please wait or upgrade your plan."
                else:
                    friendly_notice = f"❌ Pipeline Engine Error: {error_msg}"
                
                # Update frontend log drawer so the UI stream doesn't spin endlessly
                await websocket.send_json({
                    "event": "node_update",
                    "node": "error_handling_intercept",
                    "latest_explanation": friendly_notice
                })
                await websocket.send_json({"event": "execution_complete"})
            
    except WebSocketDisconnect:
        logger.info("🔌 User disconnected from WebSocket stream pipeline.")
    except Exception as e:
        logger.error(f"❌ WebSocket Exception encountered: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)