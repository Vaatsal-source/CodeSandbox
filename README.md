# Autonomous Code Fixer

Autonomous Code Fixer is a full-stack AI-powered coding workspace that generates Python code, runs it inside isolated Docker containers, and automatically debugs failed executions using a LangGraph workflow. The project includes a Next.js frontend for interactive use and a FastAPI backend for orchestration, sandboxed execution, and session history tracking.

## Features

- AI-powered code generation from natural language prompts
- Automatic debugging and retry loop for failing code
- Docker-based sandbox execution for isolation
- Real-time frontend updates through WebSockets
- Session history stored in PostgreSQL
- Editable Monaco code editor in the browser
- Live telemetry for token usage, cost, and execution time

## Tech Stack

### Frontend
- Next.js
- React
- TypeScript
- Tailwind CSS
- Monaco Editor

### Backend
- FastAPI
- LangGraph
- SQLAlchemy
- PostgreSQL
- Docker SDK for Python
- Google Gemini API

## Project Structure

```text
Autonomous-Code-fixer/
├── backend/
│   ├── src/
│   │   ├── agent/
│   │   ├── database/
│   │   ├── sandbox/
│   │   └── main.py
│   ├── requirements.txt
│   └── Dockerfile
└── frontend/
    ├── src/
    │   └── app/
    ├── package.json
    └── next.config.ts
Prerequisites
Before running the project, make sure you have:
Node.js 18+ installed
Python 3.11 installed
Docker Desktop running locally
A PostgreSQL database available
Gemini API keys for the backend
Git installed
Environment Variables
Backend
Create a .env file inside backend/ with the following variables:
DATABASE_URL=your_postgresql_connection_string
ORCHESTRATOR_GEMINI_API_KEY=your_gemini_api_key
DEBUGGER_GEMINI_API_KEY=your_gemini_api_key
PORT=8000
Frontend
Create a .env.local file inside frontend/ if you want to override the backend URL:
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000
If you do not set this, the frontend will default to http://127.0.0.1:8000.
Local Setup
1. Clone the repository
git clone <your-repo-url>
cd Autonomous-Code-fixer
2. Start the backend
Open a terminal in the backend folder:
cd backend
Create and activate a virtual environment:
Windows PowerShell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
macOS/Linux
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
Run the backend server:
python -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
The backend will be available at:
API: http://127.0.0.1:8000
Health check: http://127.0.0.1:8000/health
3. Start the frontend
Open a new terminal in the frontend folder:
cd frontend
npm install
npm run dev
The frontend will be available at:
http://localhost:3000
How It Works
The user enters a coding task in the frontend.
The frontend sends the prompt to the backend over WebSocket.
The backend uses Gemini to generate initial Python code.
The generated code is executed inside a Docker container.
If execution fails, the debugger node analyzes the error and retries.
The final code, explanation, and telemetry are saved to PostgreSQL.
The frontend displays live updates, execution output, and history.
API Endpoints
GET /health
Returns backend health status.
GET /api/history
Returns all saved execution sessions.
DELETE /api/history/{session_id}
Deletes a saved session by ID.
WS /ws/agent
WebSocket endpoint used by the frontend to stream agent execution updates.
Troubleshooting
Turbopack crash in frontend
If the frontend keeps refreshing or shows a Turbopack panic, run:
rm -rf .next
npm run dev
The project is configured to use webpack dev mode for stability.
Docker not detected
If the backend reports Docker connection failures:
Open Docker Desktop
Wait until Docker is fully running
Run docker ps to verify the daemon is available
Database connection issues
If the backend fails on startup, verify that DATABASE_URL is set correctly in backend/.env.
Gemini quota or API errors
If the agent stops with a quota-related message, the Gemini API key may have reached its daily limit.
Development Notes
The backend compiles the session history table on startup.
The sandbox runner creates temporary containers for each code execution.
The frontend reads backend URL configuration from NEXT_PUBLIC_API_URL.
The backend stores execution history in PostgreSQL via SQLAlchemy.
License
No license has been specified yet.
