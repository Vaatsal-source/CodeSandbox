import logging
from langgraph.graph import StateGraph, END
from src.agent.state import AgentState
from src.agent.nodes import generate_initial_code, execute_sandbox_code, debug_failed_code

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("AgentGraph")

def routing_decision_edge(state: AgentState):
    """Conditional Edge: Inspects execution feedback metrics to calculate graph progression."""
    if state.is_resolved:
        logger.info("🎉 Code passes successfully! Ending execution graph optimization.")
        return END
    
    if state.iteration_count >= state.max_iterations:
        logger.warning("🚨 Maximum retry thresholds broken! Stopping loop to preserve rate quotas.")
        return END
        
    logger.info(f"❌ Execution failed. Routing to Debugger Node (Count: {state.iteration_count}/{state.max_iterations}).")
    return "debug_failed_code"

def build_workflow_graph():
    # Initialize the graph with our state schema tracking definition
    workflow = StateGraph(AgentState)
    
    # Register our processing nodes
    workflow.add_node("generate_initial_code", generate_initial_code)
    workflow.add_node("execute_sandbox_code", execute_sandbox_code)
    workflow.add_node("debug_failed_code", debug_failed_code)
    
    # Establish Entrypoint direction
    workflow.set_entry_point("generate_initial_code")
    
    # Link Nodes together
    workflow.add_edge("generate_initial_code", "execute_sandbox_code")
    workflow.add_edge("debug_failed_code", "execute_sandbox_code")
    
    # Attach our state conditional checking edge loop routing logic
    workflow.add_conditional_edges(
        "execute_sandbox_code",
        routing_decision_edge,
        {
            END: END,
            "debug_failed_code": "debug_failed_code"
        }
    )
    
    return workflow.compile()

if __name__ == "__main__":
    print("\n--- Executing Full Agentic Sandbox Loop Test ---")
    
    # Compile the active engine graph
    agent_executor = build_workflow_graph()
    
    # Let's give it a task that will force it to fail initially or iterate creatively:
    # "Write a function that calculates the factorial of a number, but make a call to an intentional typo variable name 'crashing_var' on the first try so we can watch it fix itself."
    complex_test_task = "Write a python script that attempts to sum a list of numbers, but inside include a statement that prints an undefined variable named 'broken_var' so the debugger is forced to fix it, then print the final sum."
    
    initial_input = AgentState(task_description=complex_test_task)
    
    # Run the machine!
    final_output = agent_executor.invoke(initial_input)
    
    print("\n================ FINAL COMPILED CODE RESULTS ================")
    print(final_output.get("current_code"))
    print("=============================================================")
    print(f"Final Execution Success Status: {final_output.get('is_resolved')}")
    print(f"Total Self-Correction Loops Taken: {final_output.get('iteration_count')}")