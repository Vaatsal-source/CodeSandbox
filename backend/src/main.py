import os
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.agent.graph import build_workflow_graph
from src.agent.state import AgentState

# Setup Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("FastAPIServer")

app = FastAPI(title="Autonomous Code Fixer Agent Backend")

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

@app.get("/health")
def health_check():
    return {"status": "healthy", "infrastructure": "Docker & Gemini Live"}

@app.websocket("/ws/agent")
async def websocket_agent_endpoint(websocket: WebSocket):
    """
    Handles live, bidirectional communication with the Next.js frontend dashboard.
    Supports initial generation tasks and manual code verification updates.
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
                    
                logger.info(f"🚀 Received coding objective: {task_description}")
                initial_state = AgentState(task_description=task_description)
                
            # --- Scenario B: User manually edited code in Monaco and hit 'Run Tests' ---
            elif action_type == "human_intervention":
                user_code = data.get("code")
                task_description = data.get("task_description", "Manual human refinement review.")
                previous_packages = data.get("required_packages", [])
                
                logger.info("👤 Human Intercept: Running user-modified script variation through sandbox...")
                
                # Seed the graph state *directly* at the sandbox node with the user's edits
                initial_state = AgentState(
                    task_description=task_description,
                    current_code=user_code,
                    required_packages=previous_packages,
                    iteration_count=0
                )
            
            # Execute the LangGraph streaming state machine lifecycle
            for event in agent_executor.stream(initial_state, stream_mode="updates"):
                node_name = list(event.keys())[0]
                state_update = event[node_name]
                
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
                    "telemetry": state_update.get("telemetry", { # Stream down telemetry object
                        "input_tokens": 0, "output_tokens": 0, "total_cost_usd": 0.0, "execution_time_ms": 0
                    })
                }
                await websocket.send_json(payload)
                
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
    # Start ASGI Uvicorn Server on Port 8000
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)