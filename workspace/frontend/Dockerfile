FROM python:3.10-slim

WORKDIR /app

# Copy requirements first for better caching
COPY pyproject.toml ./

# Install Streamlit and dependencies
RUN pip install --no-cache-dir streamlit python-dotenv requests

# Copy the application
COPY . .

EXPOSE 3001

# Run the Streamlit application
CMD ["streamlit", "run", "app.py", "--server.address=0.0.0.0", "--server.port=3001"]