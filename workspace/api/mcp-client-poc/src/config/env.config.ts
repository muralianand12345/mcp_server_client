import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
    port: parseInt(process.env.PORT || "3000", 10),
    openai: {
        modelName: "gpt-4o",
        temperature: 0,
        apiKey: process.env.OPENAI_API_KEY,
    },
    mcp: {
        s3: {
            transport: 'sse' as const,
            url: 'http://localhost:8001/sse',
        },
        postgres: {
            transport: 'sse' as const,
            url: 'http://localhost:8002/sse',
        },
    },
}));