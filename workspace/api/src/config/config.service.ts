import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
    constructor(private configService: NestConfigService) { }

    get openaiApiKey(): string {
        return this.configService.get<string>('OPENAI_API_KEY') || "";
    }

    get openaiBaseUrl(): string {
        return "https://api.openai.com/v1";
    }

    get clientOpenAIModel(): string {
        return "o4-mini"; //Used in Agent (Powerful LLM with image support)
    }

    get chatOpenAIModel(): string {
        return "o4-mini"; //Used in Tool Agent (LLM with tool support)
    }

    get openaiEmbeddingModel(): string {
        return "text-embedding-3-large"; //same as the one used in the PGVector
    }

    get s3BucketName(): string {
        return this.configService.get<string>('S3_BUCKET_NAME') || 'xyz-support-images';
    }

    get topK(): number {
        return 3;
    }

    get databaseUrl(): string {
        return this.configService.get<string>('DATABASE_URL') ||
            'postgresql://postgres:postgres@localhost:5432/postgres';
    }

    get mcpServers(): Record<string, { transport: 'sse', url: string, reconnect: { enabled: boolean, maxAttempts: number, delayMs: number } }> {
        return {
            s3: {
                transport: 'sse' as const,
                url: this.configService.get<string>('MCP_S3_URL') || 'http://localhost:8001/sse',
                reconnect: {
                    enabled: true,
                    maxAttempts: 5,
                    delayMs: 2000,
                }
            },
            postgres: {
                transport: 'sse' as const,
                url: this.configService.get<string>('MCP_POSTGRES_URL') || 'http://localhost:8002/sse',
                reconnect: {
                    enabled: true,
                    maxAttempts: 5,
                    delayMs: 2000,
                }
            }
        }
    }

    get toolS3BaseUrl(): string {
        return this.configService.get<string>('AWS_ENDPOINT_URL') || "http://localstack:4566";
    }

    get chatHistoryLimit(): number {
        return 10;
    }

    get port(): number {
        return parseInt(this.configService.get<string>('PORT') || '3000', 10);
    }
}