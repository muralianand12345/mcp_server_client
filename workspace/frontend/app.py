import streamlit as st
import requests
import uuid
import os
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
API_URL = os.getenv("API_URL", "http://localhost:3000")

# Set page configuration
st.set_page_config(page_title="AI Chat Assistant", page_icon="🤖", layout="wide")

# Initialize session state
if "messages" not in st.session_state:
    st.session_state.messages = []
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())
if "show_details" not in st.session_state:
    st.session_state.show_details = False


# Helper functions
def query_agent(message):
    try:
        response = requests.post(
            f"{API_URL}/chat",
            headers={
                "Content-Type": "application/json",
                "session-id": st.session_state.session_id,
            },
            json={"message": message},
            timeout=120,
        )
        response.raise_for_status()
        return response.json()["response"]
    except requests.exceptions.RequestException as e:
        st.error(f"Error connecting to API: {str(e)}")
        return "Sorry, I couldn't connect to the API. Please try again later."


def get_rag_details(query):
    try:
        response = requests.post(
            f"{API_URL}/rag/test-query",
            headers={"Content-Type": "application/json"},
            json={"query": query},
            timeout=30,
        )
        response.raise_for_status()
        return response.json()
    except Exception as e:
        return None


def toggle_details():
    st.session_state.show_details = not st.session_state.show_details


# UI Layout
st.title("AI Chat Assistant")

# Header actions - single row
col1, col2 = st.columns([1, 5])
with col1:
    if st.button("Clear"):
        st.session_state.messages = []
        try:
            requests.delete(
                f"{API_URL}/chat", headers={"session-id": st.session_state.session_id}
            )
            st.session_state.session_id = str(uuid.uuid4())
        except:
            pass
        st.rerun()

with col2:
    if st.button("Toggle RAG Details", help="Show or hide retrieval information"):
        toggle_details()

# Chat messages display
for i, message in enumerate(st.session_state.messages):
    with st.chat_message(message["role"]):
        st.write(message["content"])

        # Show RAG details for user messages when enabled
        if st.session_state.show_details and message["role"] == "user":
            # Only show for messages with a response
            if (
                i + 1 < len(st.session_state.messages)
                and st.session_state.messages[i + 1]["role"] == "assistant"
            ):
                # Fetch RAG details when details are toggled on
                rag_details = get_rag_details(message["content"])

                if rag_details and rag_details.get("totalResults", 0) > 0:
                    # Use a container instead of an expander to avoid nesting issues
                    with st.container():
                        st.markdown("#### RAG Sources")
                        st.caption(
                            f"Found {rag_details['totalResults']} relevant sources"
                        )
                        st.caption(
                            f"S3: {rag_details['s3Results']} | Postgres: {rag_details['postgresResults']}"
                        )

                        # List sources without nesting expanders
                        if rag_details.get("formattedSources"):
                            # Create a markdown table of sources
                            st.markdown("| Source | Content Preview |")
                            st.markdown("| ------ | -------------- |")
                            for src in rag_details["formattedSources"]:
                                preview = (
                                    src["contentPreview"].replace("\n", " ")[:100]
                                    + "..."
                                )
                                st.markdown(f"| `{src['source']}` | {preview} |")
                elif rag_details:
                    st.caption("No relevant sources found")

# Chat input
if prompt := st.chat_input("Type your message here..."):
    # Add user message
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.write(prompt)

    # Generate and display response
    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            response = query_agent(prompt)
            st.write(response)

    # Add assistant response to history
    st.session_state.messages.append({"role": "assistant", "content": response})

# Small footer with session info
st.caption(f"Session ID: {st.session_state.session_id}")
