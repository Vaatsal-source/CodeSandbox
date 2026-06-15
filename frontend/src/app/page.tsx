"use client";

import React, { useState, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import Image from "next/image";

interface TelemetryData {
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
  execution_time_ms: number;
}

interface HistoricalSession {
  id: number;
  task_description: string;
  final_code: string;
  explanation: string;
  metrics: TelemetryData;
  is_resolved: boolean;
  created_at: string;
}

interface AgentUpdatePacket {
  event: "node_update" | "execution_complete";
  node?: string;
  current_code?: string;
  latest_explanation?: string;
  latest_stdout?: string;
  latest_stderr?: string;
  latest_exit_code?: number;
  iteration_count?: number;
  is_resolved?: boolean;
  required_packages?: string[];
  telemetry?: TelemetryData;
}

export default function AgentDashboard() {
  const [taskDescription, setTaskDescription] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [currentCode, setCurrentCode] = useState("");
  const [explanation, setExplanation] = useState("");
  const [sandboxOutput, setSandboxOutput] = useState({ stdout: "", stderr: "", exitCode: 0 });
  const [metrics, setMetrics] = useState({ loops: 0, status: "Idle" });
  const [trackedPackages, setTrackedPackages] = useState<string[]>([]);
  
  // Real-time Telemetry State
  const [telemetry, setTelemetry] = useState<TelemetryData>({
    input_tokens: 0,
    output_tokens: 0,
    total_cost_usd: 0.0,
    execution_time_ms: 0
  });

  // Database Sessions State Sidebar Drawer
  const [history, setHistory] = useState<HistoricalSession[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  // ── DYNAMIC BACKEND CONFIGURATION ──
  const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
  const cleanHost = rawApiUrl.replace(/^https?:\/\//, "");
  
  const HTTP_BASE_URL = rawApiUrl;
  const WS_BASE_URL = rawApiUrl.startsWith("https") ? `wss://${cleanHost}` : `ws://${cleanHost}`;

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load Neon history sessions list
  const loadHistoryLogs = async () => {
    try {
      const res = await fetch(`${HTTP_BASE_URL}/api/history`);
      const data = await res.json();
      setHistory(data);
    } catch (err) {
      console.error("Failed to load historical session state array:", err);
    }
  };

  useEffect(() => {
    loadHistoryLogs();
  }, []);

  // Delete a historical session from both DB and local UI state
  const deleteHistorySession = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation(); // Stop parent execution row loader from firing
    if (!window.confirm("Are you sure you want to permanently delete this execution log from history?")) {
      return;
    }

    try {
      const res = await fetch(`${HTTP_BASE_URL}/api/history/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setHistory((prev) => prev.filter((session) => session.id !== id));
        setLogs((prev) => [...prev, `🗑️ Permanently removed session log #${id} from historical tracking.`]);
      } else {
        console.error("Failed to delete session log from backend API.");
      }
    } catch (err) {
      console.error("Network error deleting session log:", err);
    }
  };

  const selectHistoricalSession = (session: HistoricalSession) => {
    setTaskDescription(session.task_description);
    setCurrentCode(session.final_code || "");
    setExplanation(session.explanation || "");
    setTelemetry(session.metrics);
    setSandboxOutput({ stdout: "Loaded from cloud execution logs.", stderr: "", exitCode: session.is_resolved ? 0 : 1 });
    setMetrics({ loops: 0, status: "Ready" });
    setIsDrawerOpen(false);
    setLogs([`📂 Restored historical session configuration record #${session.id} from Neon cloud database.`]);
  };

  const executeStreamPipeline = (payload: object) => {
    setIsRunning(true);
    const socket = new WebSocket(`${WS_BASE_URL}/ws/agent`);
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify(payload));
    };

    socket.onmessage = (event) => {
      const data: AgentUpdatePacket = JSON.parse(event.data);

      if (data.event === "node_update") {
        setMetrics({
          loops: data.iteration_count || 0,
          status: data.node === "generate_initial_code" ? "Planning" : data.node === "execute_sandbox_code" ? "Running Tests" : "Debugging Errors"
        });

        if (data.telemetry) {
          setTelemetry(data.telemetry);
        }

        if (data.node === "generate_initial_code" || data.node === "debug_failed_code") {
          if (data.current_code) setCurrentCode(data.current_code);
          if (data.latest_explanation) setExplanation(data.latest_explanation);
          setLogs((prev) => [...prev, `🤖 [${data.node}]: ${data.latest_explanation}`]);
        }

        if (data.node === "execute_sandbox_code") {
          setSandboxOutput({
            stdout: data.latest_stdout || "",
            stderr: data.latest_stderr || "",
            exitCode: data.latest_exit_code ?? 0
          });
          if (data.required_packages) setTrackedPackages(data.required_packages);
          
          const logStatus = data.is_resolved 
            ? "🎉 SUCCESS: Sandbox evaluation metrics clean." 
            : `❌ CRASHED: Code exited with runtime error status ${data.latest_exit_code}`;
          setLogs((prev) => [...prev, logStatus]);
        }
      }

      if (data.event === "execution_complete") {
        setLogs((prev) => [...prev, "🏁 Execution cycle sequence completed. Saved to history."]);
        setMetrics((prev) => ({ ...prev, status: "Ready" }));
        setIsRunning(false);
        loadHistoryLogs(); // Automatically reload list with newest record
        socket.close();
      }
    };

    socket.onerror = () => {
      setLogs((prev) => [...prev, "❌ WebSocket network link error."]);
      setIsRunning(false);
    };
  };

  const deployAgent = () => {
    if (!taskDescription.trim()) return;

    // Check if we are performing a smart iterative refinement or an absolute clean start
    if (currentCode.trim()) {
      setLogs((prev) => [...prev, "🔄 Initializing intelligent context refinement loop on top of existing code..."]);
      executeStreamPipeline({
        action: "iterative_refinement",
        task_description: taskDescription,
        code: currentCode,
        required_packages: trackedPackages
      });
    } else {
      setLogs(["🔌 Initializing full autonomous graph pipeline from scratch..."]);
      setExplanation("");
      setTrackedPackages([]);
      setTelemetry({ input_tokens: 0, output_tokens: 0, total_cost_usd: 0.0, execution_time_ms: 0 });
      setSandboxOutput({ stdout: "", stderr: "", exitCode: 0 });
      
      executeStreamPipeline({
        action: "initial_task",
        task_description: taskDescription
      });
    }
  };

  const evaluateHumanEdits = () => {
    setLogs((prev) => [...prev, "👤 User action: Intercepting workspace canvas and rerunning sandbox..."]);
    executeStreamPipeline({
      action: "human_intervention",
      task_description: taskDescription || "Manual script override compilation.",
      code: currentCode,
      required_packages: trackedPackages
    });
  };

  const clearWorkspace = () => {
    setTaskDescription("");
    setCurrentCode("");
    setExplanation("");
    setTrackedPackages([]);
    setSandboxOutput({ stdout: "", stderr: "", exitCode: 0 });
    setTelemetry({ input_tokens: 0, output_tokens: 0, total_cost_usd: 0.0, execution_time_ms: 0 });
    setMetrics({ loops: 0, status: "Idle" });
    setLogs(["✨ Workspace canvas cleared. Ready for new coding objective."]);
  };

  return (
    <div className="relative min-h-screen text-slate-100 p-6 font-sans overflow-x-hidden">
      
      {/* Background Wallpaper Frame */}
      <div className="fixed inset-0 z-0 select-none pointer-events-none">
        <Image
          src="/bg-wallpaper.jpg"
          alt="Dashboard Background Background"
          fill
          priority
          quality={90}
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[2px]" />
      </div>

      {/* Primary Interface Layout */}
      <div className="relative z-10 max-w-[1800px] mx-auto">
        
        {/* Header Telemetry Dashboard Panel */}
        <header className="mb-6 border-b border-slate-800/60 backdrop-blur-md bg-slate-950/40 p-4 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-emerald-400 bg-clip-text text-transparent">
              Co-Pilot Autonomous Sandbox Workspace
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Interactive Agent Execution Loop with Human-in-the-Loop Intercepts
            </p>
          </div>
          
          {/* Live Telemetry Monitors Grid */}
          <div className="flex flex-wrap items-center gap-3 text-xs w-full md:w-auto">
            
            <button 
              onClick={() => setIsDrawerOpen(true)}
              className="bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-cyan-400 hover:border-cyan-500/50 px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 h-9 shadow-md"
            >
              📊 History Log Drawer ({history.length})
            </button>

            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1 rounded-lg min-w-[90px] h-9 flex flex-col justify-center">
              <span className="text-[9px] text-slate-400 block font-mono leading-none mb-0.5">LATENCY</span>
              <span className="font-semibold text-emerald-400 font-mono text-xs leading-none">
                {telemetry.execution_time_ms} <span className="text-[9px] text-slate-500">ms</span>
              </span>
            </div>
            
            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1 rounded-lg min-w-[100px] h-9 flex flex-col justify-center">
              <span className="text-[9px] text-slate-400 block font-mono leading-none mb-0.5">TOTAL TOKENS</span>
              <span className="font-semibold text-cyan-400 font-mono text-xs leading-none">
                {telemetry.input_tokens + telemetry.output_tokens}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1 rounded-lg min-w-[100px] h-9 flex flex-col justify-center">
              <span className="text-[9px] text-slate-400 block font-mono leading-none mb-0.5">SESSION COST</span>
              <span className="font-semibold text-amber-400 font-mono text-xs leading-none">
                ${telemetry.total_cost_usd.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1 rounded-lg h-9 flex flex-col justify-center min-w-[90px]">
              <span className="text-[9px] text-slate-400 block leading-none mb-0.5">STATUS</span>
              <span className={`font-semibold text-xs leading-none ${isRunning ? "text-amber-400 animate-pulse" : "text-emerald-400"}`}>
                {metrics.status}
              </span>
            </div>
          </div>
        </header>

        {/* Primary prompt entry layout */}
        <div className="mb-6 bg-slate-900/50 backdrop-blur-md border border-slate-800/80 p-4 rounded-xl shadow-xl">
          <div className="flex justify-between items-center mb-2">
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Coding Objective / Refinement Instructions Prompt
            </label>
            {currentCode.trim() && (
              <button
                onClick={clearWorkspace}
                disabled={isRunning}
                className="text-xs text-rose-400 hover:text-rose-300 transition-all underline cursor-pointer disabled:opacity-40"
              >
                Clear Entire Canvas (Fresh Start)
              </button>
            )}
          </div>
          <div className="flex flex-col sm:flex-row gap-3 items-end">
            <textarea
              rows={2}
              className="w-full flex-1 bg-slate-950/80 border border-slate-800 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 text-slate-200 resize-none font-sans"
              placeholder={currentCode.trim() ? "Type instructions to alter or improve the current generated code script..." : "Describe an objective to watch the agent build it autonomously..."}
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              disabled={isRunning}
            />
            <button
              onClick={deployAgent}
              disabled={isRunning}
              className={`w-full sm:w-auto font-bold px-6 py-3 rounded-lg text-sm transition-all shadow-md h-[46px] whitespace-nowrap ${
                currentCode.trim() 
                  ? "bg-cyan-600 hover:bg-cyan-500 text-slate-950 shadow-cyan-950/20" 
                  : "bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-emerald-950/20"
              } disabled:bg-slate-800 disabled:text-slate-500`}
            >
              {currentCode.trim() ? "Refine Code Script" : "Deploy Agent"}
            </button>
          </div>
        </div>

        {/* Workspaces split layouts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-270px)]">
          
          {/* Left Layout column */}
          <div className="flex flex-col gap-4 h-full overflow-hidden">
            <div className="h-28 bg-slate-900/50 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 flex flex-col overflow-hidden shadow-lg">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-1.5 mb-1.5">
                Agent Engineering Justification
              </h3>
              <p className="text-sm text-slate-300 italic overflow-y-auto pr-1">
                {explanation || "Workspace canvas is currently waiting for a task sequence..."}
              </p>
            </div>

            {/* Interactive Monaco editor frame */}
            <div className="flex-1 bg-slate-900/50 backdrop-blur-md border border-slate-800/80 rounded-xl flex flex-col overflow-hidden shadow-lg">
              <div className="bg-slate-950/60 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">workspace_output.py</span>
                  <span className="text-[9px] text-amber-400 font-sans border border-amber-950/40 bg-amber-950/10 px-1.5 py-0.2 rounded uppercase tracking-wide">
                    Interactive Editable Code
                  </span>
                </div>
                <button
                  onClick={evaluateHumanEdits}
                  disabled={isRunning || !currentCode}
                  className="text-xs bg-slate-950 border border-slate-800 text-emerald-400 hover:bg-emerald-950/30 hover:border-emerald-600 px-3 py-1 rounded-md transition-all font-semibold disabled:text-slate-600 disabled:border-slate-900"
                >
                  Run Code inside Sandbox
                </button>
              </div>
              <div className="flex-1 w-full p-2 bg-slate-950/80">
                <Editor
                  height="100%"
                  defaultLanguage="python"
                  language="python"
                  theme="vs-dark"
                  value={currentCode}
                  onChange={(val) => setCurrentCode(val || "")}
                  options={{
                    readOnly: isRunning,
                    minimap: { enabled: false },
                    fontSize: 14,
                    lineNumbers: "on",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    padding: { top: 8 }
                  }}
                />
              </div>
            </div>
          </div>

          {/* Right side outputs column */}
          <div className="flex flex-col gap-4 h-full overflow-hidden">
            <div className="flex-1 bg-slate-950/50 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 font-mono text-xs overflow-hidden flex flex-col shadow-lg">
              <h3 className="text-xs font-semibold font-sans text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 mb-2">
                Live Pipeline Execution Logs
              </h3>
              <div className="flex-1 overflow-y-auto space-y-1.5 text-slate-300 pr-1">
                {logs.map((log, index) => (
                  <div key={index} className="leading-relaxed whitespace-pre-wrap">
                    {log}
                  </div>
                ))}
                <div ref={terminalEndRef} />
              </div>
            </div>

            <div className="flex-1 bg-slate-900/50 backdrop-blur-md border border-slate-800/80 rounded-xl p-4 font-mono text-xs flex flex-col overflow-hidden shadow-lg">
              <h3 className="text-xs font-semibold font-sans text-slate-400 uppercase tracking-wider border-b border-slate-800 pb-2 mb-2">
                Docker Container Isolation Output (Stdout/Stderr)
              </h3>
              <div className="flex-1 overflow-y-auto bg-slate-950/80 p-3 rounded-lg border border-slate-800 space-y-2">
                <div>
                  <span className="text-cyan-400 font-semibold">[STDOUT]:</span>
                  <pre className="text-slate-200 mt-1 pl-2 whitespace-pre-wrap font-mono">{sandboxOutput.stdout || "None"}</pre>
                </div>
                <div className="border-t border-slate-800 pt-2">
                  <span className="text-rose-400 font-semibold">[STDERR]:</span>
                  <pre className="text-rose-300 mt-1 pl-2 whitespace-pre-wrap font-mono">{sandboxOutput.stderr || "None"}</pre>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* ── HISTORICAL SESSIONS DRAWER OVERLAY ── */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm animate-fade-in">
          <div className="fixed inset-0" onClick={() => setIsDrawerOpen(false)} />
          <div className="relative w-full max-w-md h-screen bg-slate-900/90 backdrop-blur-md border-l border-slate-800 p-6 flex flex-col shadow-2xl z-10 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-4 mb-4">
              <div>
                <h2 className="text-lg font-bold text-cyan-400">Execution History Logs</h2>
                <p className="text-[11px] text-slate-400">Cached inside Neon PostgreSQL cluster</p>
              </div>
              <button 
                onClick={() => setIsDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-100 font-bold bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs"
              >
                ✕ Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {history.length === 0 ? (
                <div className="text-center text-xs text-slate-500 mt-10 italic">No past sessions recorded in database.</div>
              ) : (
                history.map((session) => (
                  <div 
                    key={session.id}
                    onClick={() => selectHistoricalSession(session)}
                    className="group relative border border-slate-800/80 hover:border-cyan-500/40 bg-slate-950/50 hover:bg-slate-950/90 rounded-xl p-3 cursor-pointer transition-all shadow-md"
                  >
                    <div className="flex justify-between items-start gap-2 mb-1.5 pr-6">
                      <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded ${session.is_resolved ? "bg-emerald-950 text-emerald-400 border border-emerald-900" : "bg-rose-950 text-rose-400 border border-rose-900"}`}>
                        {session.is_resolved ? "SUCCESS" : "FAILED"}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {new Date(session.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Integrated Delete Button Action */}
                    <button
                      onClick={(e) => deleteHistorySession(e, session.id)}
                      className="absolute top-2.5 right-2.5 p-1 text-slate-500 hover:text-rose-400 hover:bg-slate-900 rounded-md opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete log record"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>

                    <p className="text-xs font-semibold text-slate-200 line-clamp-2 group-hover:text-cyan-400 transition-colors pr-4">
                      {session.task_description}
                    </p>
                    <div className="mt-2 pt-2 border-t border-slate-900 flex justify-between text-[10px] font-mono text-slate-400">
                      <span>Cost: <span className="text-amber-400">${session.metrics.total_cost_usd.toFixed(4)}</span></span>
                      <span>Tokens: <span className="text-cyan-400">{session.metrics.input_tokens + session.metrics.output_tokens}</span></span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}