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

  const socketRef = useRef<WebSocket | null>(null);
  const terminalEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const executeStreamPipeline = (payload: object) => {
    setIsRunning(true);
    const socket = new WebSocket("ws://127.0.0.1:8000/ws/agent");
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
        setLogs((prev) => [...prev, "🏁 Execution cycle sequence completed."]);
        setMetrics((prev) => ({ ...prev, status: "Ready" }));
        setIsRunning(false);
        socket.close();
      }
    };

    socket.onerror = () => {
      setLogs((prev) => [...prev, "❌ WebSocket network link error."]);
      setIsRunning(false);
    };
  };

  const deployAgentFromScratch = () => {
    if (!taskDescription.trim()) return;
    setLogs(["🔌 Initializing full autonomous graph pipeline..."]);
    setExplanation("");
    setTrackedPackages([]);
    setTelemetry({ input_tokens: 0, output_tokens: 0, total_cost_usd: 0.0, execution_time_ms: 0 });
    setSandboxOutput({ stdout: "", stderr: "", exitCode: 0 });
    
    executeStreamPipeline({
      action: "initial_task",
      task_description: taskDescription
    });
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
          <div className="flex flex-wrap gap-3 text-xs w-full md:w-auto">
            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg min-w-[100px]">
              <span className="text-[10px] text-slate-400 block font-mono">LATENCY</span>
              <span className="font-semibold text-emerald-400 font-mono text-sm">
                {telemetry.execution_time_ms} <span className="text-[10px] text-slate-500">ms</span>
              </span>
            </div>
            
            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg min-w-[120px]">
              <span className="text-[10px] text-slate-400 block font-mono">TOTAL TOKENS</span>
              <span className="font-semibold text-cyan-400 font-mono text-sm">
                {telemetry.input_tokens + telemetry.output_tokens}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg min-w-[110px]">
              <span className="text-[10px] text-slate-400 block font-mono">SESSION COST</span>
              <span className="font-semibold text-amber-400 font-mono text-sm">
                ${telemetry.total_cost_usd.toFixed(4)}
              </span>
            </div>

            <div className="bg-slate-900/80 border border-slate-800/80 px-3 py-1.5 rounded-lg">
              <span className="text-[10px] text-slate-400 block mb-0.5">STATUS</span>
              <span className={`font-semibold text-xs ${isRunning ? "text-amber-400 animate-pulse" : "text-emerald-400"}`}>
                {metrics.status}
              </span>
            </div>
          </div>
        </header>

        {/* Primary prompt entry layout */}
        <div className="mb-6 bg-slate-900/50 backdrop-blur-md border border-slate-800/80 p-4 rounded-xl shadow-xl">
          <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
            Coding Objective / Buggy Requirements Prompt
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              className="flex-1 bg-slate-950/80 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 text-slate-200"
              placeholder="Describe an objective to watch the agent build it autonomously..."
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              disabled={isRunning}
            />
            <button
              onClick={deployAgentFromScratch}
              disabled={isRunning}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-bold px-6 py-2 rounded-lg text-sm transition-all shadow-md shadow-emerald-950/20"
            >
              Deploy Agent
            </button>
          </div>
        </div>

        {/* Workspaces split layouts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[calc(100vh-250px)]">
          
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
    </div>
  );
}