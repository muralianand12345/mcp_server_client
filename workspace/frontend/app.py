import streamlit as st
import requests
import uuid
import os
from dotenv import load_dotenv
from citations import CitationParser, CitationRenderer

load_dotenv()
API_URL = os.getenv("API_URL", "http://localhost:3000")

st.set_page_config(page_title="AI Chat Assistant", page_icon="🤖", layout="wide")

if "messages" not in st.session_state:
    st.session_state.messages = []
if "session_id" not in st.session_state:
    st.session_state.session_id = str(uuid.uuid4())


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
        bot_response = response.json()["response"]
        print(bot_response)  # Debugging line to see the response
        return bot_response  # Return the raw response, not processed HTML
    except requests.exceptions.RequestException as e:
        st.error(f"Error connecting to API: {str(e)}")
        return "Sorry, I couldn't connect to the API. Please try again later."


def render_message_content(content):
    """Helper function to render message content with citations if present."""
    if CitationParser.has_citations(content):
        processed_content, citations = CitationParser.process_text(content)
        return CitationRenderer.get_full_html_template(
            processed_content, len(citations)
        )
    else:
        formatted_content = CitationParser._format_text_for_html(content)
        return f'<div class="message-content">{formatted_content}</div>'


def display_message_content(content):
    """Display message content, using HTML if it contains citations or formatting."""
    if CitationParser.has_citations(content) or "\n" in content:
        html_content = render_message_content(content)
        st.html(html_content)
    else:
        st.write(content)


st.title("AI Chat Assistant")

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

# Display chat history
for i, message in enumerate(st.session_state.messages):
    with st.chat_message(message["role"]):
        display_message_content(message["content"])

# Handle new user input
if prompt := st.chat_input("Type your message here..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.write(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            raw_response = query_agent(prompt)
            st.session_state.messages.append(
                {"role": "assistant", "content": raw_response}
            )
            display_message_content(raw_response)

st.caption(f"Session ID: {st.session_state.session_id}")
