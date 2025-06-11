# RAG API with NestJS

A Retrieval Augmented Generation (RAG) API built with NestJS that integrates OpenAI, PostgreSQL, and S3 to provide intelligent answers based on stored knowledge.

## Overview

This API converts a standalone Node.js RAG application into a modular NestJS API with the following features:

- Vector-based search using PostgreSQL pgvector
- Integration with OpenAI for embeddings and chat completions
- Tool execution via LangChain and MCP (Microservice Communication Protocol)
- Session management for chat history
- RESTful API endpoints

## Project Structure

```
src/
├── main.ts                        # Entry point
├── app.module.ts                  # Main module
├── common/                        # Shared utilities, DTOs, interfaces
│   ├── dto/
│   │   ├── chat-request.dto.ts
│   │   └── chat-response.dto.ts
│   └── interfaces/
│       ├── message.interface.ts
│       └── rag-result.interface.ts
├── config/                        # Configuration
│   ├── config.module.ts
│   └── config.service.ts
├── modules/                       # Feature modules
│   ├── agent/
│   │   ├── agent.module.ts
│   │   └── agent.service.ts
│   ├── chat/
│   │   ├── chat.controller.ts
│   │   ├── chat.module.ts
│   │   └── chat.service.ts
│   ├── rag/
│   │   ├── rag.module.ts
│   │   └── rag.service.ts
│   └── tool-agent/
│       ├── tool-agent.module.ts
│       └── tool-agent.service.ts
└── shared/                        # Shared services
    ├── database/
    │   └── database.service.ts
    └── openai/
        └── openai.service.ts
```

## Setup

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your API keys and configuration
4. Start the API:
   ```bash
   npm run start:dev
   ```

## API Endpoints

### `/chat`

- **POST**: Process a chat message and generate a response
  - Request body: `{ "message": "your message", "sessionId": "optional-session-id" }`
  - Headers: You can also pass `session-id` in the request header
  - Response: `{ "response": "AI response", "sessionId": "session-id", "timestamp": "timestamp" }`

- **DELETE**: Clear a chat session
  - Headers: Requires `session-id` header
  - Response: 204 No Content

### `/chat/rag/test-query`

- **POST**: Test a RAG query to see what results it would return
  - Request body: `{ "query": "your query" }`
  - Response: Information about the RAG results

## Environment Variables

- `PORT`: API port (default: 3000)
- `OPENAI_API_KEY`: Your OpenAI API key
- `POSTGRES_URL`: PostgreSQL connection URL
- `S3_BUCKET_NAME`: S3 bucket name for images (default: xyz-support-images)
- `MCP_S3_URL`: URL for S3 MCP service
- `MCP_POSTGRES_URL`: URL for PostgreSQL MCP service

## Working Process

1. When a user sends a message, the API searches for relevant information in the PostgreSQL database using vector embeddings.
2. If relevant information is found, a tool agent executes tools based on the RAG context (like fetching images from S3).
3. The main agent then generates a response using OpenAI, incorporating the RAG context, tool results, and chat history.
4. Chat history is maintained for each session to provide context for future interactions.

## Dependencies

- NestJS
- OpenAI
- LangChain
- PostgreSQL with pgvector
- LangGraph
- MCP adapters for LangChain