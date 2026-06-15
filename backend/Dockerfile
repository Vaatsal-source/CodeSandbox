# Lock the Python runtime to version 3.11 using a lightweight base image
FROM python:3.11-slim

# Set working directory inside the container
WORKDIR /app

# Copy dependency files and install them
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the backend source code
COPY . .

ENV PYTHONPATH=/app
# Expose the dynamic port provided by the cloud host
EXPOSE 8000

# Run the FastAPI server using uvicorn via your main entry point
CMD ["python","-m", "src.main"]