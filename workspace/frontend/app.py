import streamlit as st
import requests
import uuid
import os
import json
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# API URL
API_URL = os.getenv("API_URL", "http://localhost:3000")

# Set page configuration
st.set_page_config(page_title="AI Chat Assistant", page_icon="🤖", layout="wide")

# Initialize session state variables
if "messages" not in st.session_state:
    st.session_state.messages = []

if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())

if "show_history" not in st.session_state:
    st.session_state.show_history = False

if "selected_interaction" not in st.session_state:
    st.session_state.selected_interaction = None


# Function to call the API
def query_agent(message):
    try:
        response = requests.post(
            f"{API_URL}/chat",
            headers={
                "Content-Type": "application/json",
                "session-id": st.session_state.session_id,
            },
            json={"message": message},
            timeout=120,  # Increased timeout for complex queries
        )

        response.raise_for_status()
        return response.json()["response"]
    except requests.exceptions.RequestException as e:
        st.error(f"Error connecting to API: {str(e)}")
        return "Sorry, I couldn't connect to the API. Please try again later."


# Function to fetch chat history
def get_chat_history():
    try:
        response = requests.get(
            f"{API_URL}/chat/history",
            headers={
                "session-id": st.session_state.session_id,
            },
            timeout=30,
        )

        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        st.sidebar.error(f"Error retrieving chat history: {str(e)}")
        return []


# Toggle chat history visibility
def toggle_history():
    st.session_state.show_history = not st.session_state.show_history
    st.session_state.selected_interaction = None


# Select an interaction to view details
def select_interaction(idx):
    st.session_state.selected_interaction = idx


# Main layout with columns
col1, col2 = st.columns([2, 1])

with col1:
    # App title
    st.title("AI Chat Assistant")
    st.markdown("Ask questions about your S3 or Postgres data!")

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
            st.warning(
                "Could not clear session on server, but chat is cleared locally."
            )

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

# Sidebar for session information and chat history
with st.sidebar:
    st.subheader("Session Information")
    st.info(f"Session ID: {st.session_state.session_id}")
    st.caption("This ID is used to maintain your chat history")

    # Toggle history button
    st.button("Show/Hide Chat History", on_click=toggle_history)

    if st.session_state.show_history:
        st.subheader("Chat History")

        history = get_chat_history()

        if not history:
            st.info("No chat history available")
        else:
            # Show list of interactions
            for i, interaction in enumerate(history):
                timestamp = interaction.get("timestamp", "Unknown time")
                # Format the timestamp for display
                try:
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                except:
                    formatted_time = timestamp

                # Create a button for each interaction
                if st.button(
                    f"Query: {interaction.get('query', 'N/A')[:30]}...",
                    key=f"int_{i}",
                    help=f"From: {formatted_time}",
                ):
                    select_interaction(i)

            # Display selected interaction details
            if st.session_state.selected_interaction is not None:
                idx = st.session_state.selected_interaction
                interaction = history[idx]

                st.divider()
                st.subheader("Interaction Details")

                # Format timestamp
                timestamp = interaction.get("timestamp", "Unknown time")
                try:
                    dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                    formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                except:
                    formatted_time = timestamp

                st.write(f"**Time:** {formatted_time}")
                st.write(f"**Query:** {interaction.get('query', 'N/A')}")

                # Source information
                st.write(
                    f"**Sources Used:** {len(interaction.get('ragResults', []))} total"
                )
                st.write(f"- S3 Sources: {len(interaction.get('s3Results', []))}")
                st.write(
                    f"- PostgreSQL Sources: {len(interaction.get('postgresResults', []))}"
                )

                # Display sources - no nested expanders
                if interaction.get("ragResults"):
                    st.write("**Sources:**")
                    for idx, source in enumerate(interaction.get("ragResults", [])):
                        st.write(f"Source {idx+1}: {source.get('source', 'Unknown')}")

                # Response
                st.write("**Response:**")
                st.write(interaction.get("response", "No response available"))
