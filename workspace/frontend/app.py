import streamlit as st
import requests
import uuid
import os
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API URL
API_URL = os.getenv("API_URL", "http://api:3000")

# Set page configuration
st.set_page_config(page_title="AI Chat Assistant", page_icon="🤖", layout="centered")

# Initialize session state variables
if "messages" not in st.session_state:
    st.session_state.messages = []

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())

# App title
st.title("AI Chat Assistant")
st.markdown("Ask questions about your S3 or Postgres data!")


# Function to call the API with better error handling
def query_agent(message):
    try:
        st.write(f"Trying to connect to: {API_URL}/chat")
        response = requests.post(
            f"{API_URL}/chat",
            headers={
                "Content-Type": "application/json",
                "session-id": st.session_state.session_id,
            },
            json={"message": message},
            timeout=120,
        )

        # Log response status and headers for debugging
        st.write(f"Response status: {response.status_code}")
        st.write(f"Response headers: {dict(response.headers)}")

        # If we get an error, try to parse the response
        if response.status_code >= 400:
            try:
                error_content = response.json()
                return (
                    f"Error from API: {error_content.get('message', 'Unknown error')}"
                )
            except:
                return f"Error {response.status_code}: {response.text[:500]}"

        return response.json()["response"]
    except requests.exceptions.RequestException as e:
        return f"Error connecting to API: {str(e)}"


# Clear chat button
if st.button("Clear Chat"):
    # Clear messages from UI
    st.session_state.messages = []

    # Call API to clear session
    try:
        requests.delete(
            f"{API_URL}/chat", headers={"session-id": st.session_state.session_id}
        )
    except requests.exceptions.RequestException:
        st.warning("Could not clear session on server, but chat is cleared locally.")

    # Generate new session ID
    st.session_state.session_id = str(uuid.uuid4())
    st.success("Chat cleared!")

# Display chat messages
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.write(message["content"])

# Chat input
if prompt := st.chat_input("Type your message here..."):
    # Add user message to chat history
    st.session_state.messages.append({"role": "user", "content": prompt})

    # Display user message in chat message container
    with st.chat_message("user"):
        st.write(prompt)

    # Display assistant response
    with st.chat_message("assistant"):
        message_placeholder = st.empty()
        message_placeholder.markdown("Thinking...")

        # Call API
        response = query_agent(prompt)

        # Update message placeholder with response
        message_placeholder.markdown(response)

    # Add assistant response to chat history
    st.session_state.messages.append({"role": "assistant", "content": response})

# Display session information in sidebar
with st.sidebar:
    st.subheader("Session Information")
    st.info(f"Session ID: {st.session_state.session_id}")
    st.caption("This ID is used to maintain your chat history")

    # Add debug section
    st.subheader("Debug Information")
    st.write(f"API URL: {API_URL}")

    # Button to test API connection
    if st.button("Test API Connection"):
        try:
            response = requests.get(f"{API_URL}")
            st.write(f"Status: {response.status_code}")
            st.write(f"Content: {response.text[:200]}...")
        except Exception as e:
            st.error(f"Connection error: {str(e)}")
