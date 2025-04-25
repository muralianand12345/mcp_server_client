import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
    port: parseInt(process.env.PORT || "3000", 10),
    openai: {
        modelName: process.env.OPENAI_MODEL || "gpt-4o",
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || "0"),
        apiKey: process.env.OPENAI_API_KEY,
    },
    mcp: {
        s3: {
            transport: 'sse' as const,
            url: process.env.MCP_S3_URL || 'http://localhost:8001/sse',
            enabled: process.env.MCP_S3_ENABLED !== 'false',
        },
        postgres: {
            transport: 'sse' as const,
            url: process.env.MCP_POSTGRES_URL || 'http://localhost:8002/sse',
            enabled: process.env.MCP_POSTGRES_ENABLED !== 'false',
        },
    },
    storage: {
        enabled: process.env.STORAGE_ENABLED !== 'false',
        dir: process.env.STORAGE_DIR || './chat-logs',
    },
    logging: {
        level: process.env.LOG_LEVEL || 'log', // log, error, warn, debug, verbose
        mcp: process.env.LOG_MCP === 'true',
    }
}));