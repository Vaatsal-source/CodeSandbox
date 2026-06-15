import os
import re
import logging
import json
import time
from dotenv import load_dotenv
import google.generativeai as genai
from src.agent.state import AgentState, CodeGenerationSchema
from src.sandbox.docker_client import DockerSandbox

load_dotenv()
logger = logging.getLogger("AgentNodes")

# Pricing benchmarks for Gemini 2.5 Flash: 
# Input: ~$0.075 per 1M tokens | Output: ~$0.30 per 1M tokens
PRICE_PER_INPUT_TOKEN = 0.075 / 1_000_000
PRICE_PER_OUTPUT_TOKEN = 0.30 / 1_000_000

sandbox = DockerSandbox()

def get_model(api_key: str):
    genai.configure(api_key=api_key)
    return genai.GenerativeModel('gemini-2.5-flash')

def update_telemetry_metrics(current_telemetry: dict, response_metadata, elapsed_time_ms: int) -> dict:
    """Calculates and aggregates model token usage overhead and live costs."""
    updated = dict(current_telemetry)
    
    try:
        input_tokens = response_metadata.usage_metadata.prompt_token_count
        output_tokens = response_metadata.usage_metadata.candidates_token_count
        
        # Incremental sums
        updated["input_tokens"] += input_tokens
        updated["output_tokens"] += output_tokens
        
        # Calculate localized monetary cost increment
        node_cost = (input_tokens * PRICE_PER_INPUT_TOKEN) + (output_tokens * PRICE_PER_OUTPUT_TOKEN)
        updated["total_cost_usd"] += round(node_cost, 6)
    except Exception as e:
        logger.warning(f"Failed to extract token telemetry metadata: {e}")
        
    updated["execution_time_ms"] = elapsed_time_ms
    return updated

def generate_initial_code(state: AgentState) -> dict:
    """Node: Writes initial code implementation while calculating processing footprint metadata."""
    logger.info("Base Orchestrator Node: Structuring Initial Code...")
    start_time = time.perf_counter()
    model = get_model(os.getenv("ORCHESTRATOR_GEMINI_API_KEY"))
    
    prompt = f"Write a standalone Python script to complete the following objective: {state.task_description}"
    
    response = model.generate_content(
        prompt,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": CodeGenerationSchema
        }
    )
    
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    parsed_json = json.loads(response.text)
    
    new_telemetry = update_telemetry_metrics(state.telemetry, response, elapsed_ms)
    
    return {
        "current_code": parsed_json["code"],
        "latest_explanation": parsed_json["explanation"],
        "iteration_count": state.iteration_count + 1,
        "telemetry": new_telemetry,
        "history": state.history + [{"action": "initial_generation", "explanation": parsed_json["explanation"]}]
    }

def execute_sandbox_code(state: AgentState) -> dict:
    """Node: Runs code inside the container. Tracks localized sandbox latency."""
    logger.info(f"Container Sandbox Node: Executing codebase iteration {state.iteration_count}...")
    start_time = time.perf_counter()
    
    run_result = sandbox.execute_code(
        state.current_code, 
        timeout_seconds=20, 
        packages=state.required_packages
    )
    
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    is_resolved = (run_result["exit_code"] == 0) and not run_result["timed_out"]
    
    updated_packages = list(state.required_packages)
    match = re.search(r"ModuleNotFoundError:\s+No\s+module\s+named\s+'([^']+)'", run_result["stderr"])
    if match:
        missing_module = match.group(1)
        if missing_module not in updated_packages:
            logger.info(f"🔍 Automated Interception: Missing module '{missing_module}' extracted from stderr.")
            updated_packages.append(missing_module)
            
    # Copy telemetry forward, appending sandbox runtime execution timing metrics
    new_telemetry = dict(state.telemetry)
    new_telemetry["execution_time_ms"] = elapsed_ms
            
    return {
        "latest_stdout": run_result["stdout"],
        "latest_stderr": run_result["stderr"],
        "latest_exit_code": run_result["exit_code"],
        "timed_out": run_result["timed_out"],
        "is_resolved": is_resolved,
        "required_packages": updated_packages,
        "telemetry": new_telemetry,
        "history": state.history + [{"action": "execute_sandbox", "result": run_result}]
    }

def debug_failed_code(state: AgentState) -> dict:
    """Node: Debugs runtime failures while updating total pipeline usage metrics."""
    logger.info("Debugger Node: Correcting syntax/runtime runtime failures...")
    start_time = time.perf_counter()
    model = get_model(os.getenv("DEBUGGER_GEMINI_API_KEY"))
    
    feedback = f"Exit Code: {state.latest_exit_code}\n"
    if state.timed_out:
        feedback += "Error: Code execution timed out (infinite loop safety triggered)."
    else:
        feedback += f"Stdout: {state.latest_stdout}\nStderr: {state.latest_stderr}"
        
    prompt = f"""
    The following script crashed during sandbox execution. Analyze the error and fix it entirely.
    Target Goal: {state.task_description}
    Buggy Code: {state.current_code}
    Sandbox Runtime Error Report: {feedback}
    """
    
    response = model.generate_content(
        prompt,
        generation_config={
            "response_mime_type": "application/json",
            "response_schema": CodeGenerationSchema
        }
    )
    
    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    parsed_json = json.loads(response.text)
    
    new_telemetry = update_telemetry_metrics(state.telemetry, response, elapsed_ms)
    
    return {
        "current_code": parsed_json["code"],
        "latest_explanation": parsed_json["explanation"],
        "iteration_count": state.iteration_count + 1,
        "telemetry": new_telemetry,
        "history": state.history + [{"action": "debug_correction", "explanation": parsed_json["explanation"]}]
    }