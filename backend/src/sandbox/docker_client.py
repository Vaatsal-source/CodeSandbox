import os
import time
import logging
import shutil
from pathlib import Path
import docker
from docker.errors import ImageNotFound, APIError

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DockerSandbox")

class DockerSandbox:
    def __init__(self):
        """Initializes the Docker client connection with Windows named pipe handles."""
        try:
            self.client = docker.from_env()
            self.client.ping()
            logger.info("✅ Successfully connected to Docker Daemon via Named Pipe.")
        except Exception as pipe_error:
            try:
                self.client = docker.DockerClient(base_url="tcp://127.0.0.1:2375")
                self.client.ping()
                logger.info("✅ Successfully connected to Docker Daemon via TCP Socket.")
            except Exception as tcp_error:
                logger.error("❌ All Docker connection strategies exhausted.")
                raise tcp_error

        self.host_workspace_root = Path(__file__).parent.parent.parent / "agent_workspace"
        self.host_workspace_root.mkdir(exist_ok=True)

    def execute_code(self, code_string: str, timeout_seconds: int = 15, packages: list = None) -> dict:
        """
        Writes code to a host folder and bind-mounts it inside a sandboxed container.
        If packages are provided, it dynamically hooks up network access to run pip install.
        """
        run_id = f"run_{int(time.time())}"
        host_run_dir = self.host_workspace_root / run_id
        host_run_dir.mkdir(parents=True, exist_ok=True)

        # Write code payload out to disk
        script_path = host_run_dir / "main.py"
        with open(script_path, "w", encoding="utf-8") as f:
            f.write(code_string)

        # Handle dynamic package installation setup
        command_chain = "python /app/main.py"
        network_setting = "none" # Default state is highly isolated
        
        if packages:
            logger.info(f"📦 Dynamic Installer: Requirements identified: {packages}. Injecting installation phase...")
            req_path = host_run_dir / "requirements.txt"
            with open(req_path, "w", encoding="utf-8") as f:
                f.write("\n".join(packages))
            
            # Chain the pip setup directly prior to running the main file script
            command_chain = "pip install --no-cache-dir -r /app/requirements.txt && python /app/main.py"
            network_setting = "bridge" # Enable temporary egress internet to poll PyPI

        container = None
        result = {
            "stdout": "",
            "stderr": "",
            "exit_code": -1,
            "timed_out": False
        }

        try:
            try:
                self.client.images.get("python:3.11-slim")
            except ImageNotFound:
                logger.info("Pulling base python:3.11-slim image...")
                self.client.images.pull("python:3.11-slim")

            absolute_host_path = str(host_run_dir.resolve())
            volumes_config = {absolute_host_path: {"bind": "/app", "mode": "rw"}}

            container = self.client.containers.create(
                image="python:3.11-slim",
                command=f"sh -c '{command_chain}'",
                volumes=volumes_config,
                working_dir="/app",
                network_mode=network_setting,
                mem_limit="384m",          # Bumped memory limit slightly to allow pip build processes
                nano_cpus=1000000000,
                user="root"
            )

            container.start()
            start_time = time.time()

            while True:
                container.reload()
                if container.status == "exited":
                    output = container.wait()
                    result["exit_code"] = output.get("StatusCode", 0)
                    break
                
                if time.time() - start_time > timeout_seconds:
                    result["timed_out"] = True
                    logger.warning("⚠️ Code execution exceeded timeout constraint. Terminating container.")
                    try:
                        container.kill()
                    except Exception:
                        pass
                    break
                
                time.sleep(0.2)

            result["stdout"] = container.logs(stdout=True, stderr=False).decode("utf-8")
            result["stderr"] = container.logs(stdout=False, stderr=True).decode("utf-8")

        except APIError as e:
            logger.error(f"Docker API Server Error: {e}")
            result["stderr"] = f"Sandbox Infrastructure Error: {str(e)}"
        finally:
            if container:
                try:
                    container.remove(force=True)
                except Exception:
                    pass
            try:
                shutil.rmtree(host_run_dir)
            except Exception as cleanup_error:
                logger.warning(f"Failed to clear temporary host path: {cleanup_error}")

        return result

if __name__ == "__main__":
    sandbox = DockerSandbox()
    print("\n--- Testing Live Dependency Installation Sandbox ---")
    # Test script requiring the third party library requests
    test_code = "import requests; r = requests.get('https://api.github.com/zen'); print(f'PyPI Download Status Code: {r.status_code}'); print(f'Mantra: {r.text}')"
    output = sandbox.execute_code(test_code, packages=["requests"])
    print(f"Results: {output}")