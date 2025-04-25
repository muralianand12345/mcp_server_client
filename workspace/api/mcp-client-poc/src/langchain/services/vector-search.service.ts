import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class VectorSearchService {
    private readonly logger = new Logger(VectorSearchService.name);
    private readonly openai: OpenAI;

    constructor(private configService: ConfigService) {
        this.openai = new OpenAI({
            apiKey: this.configService.get('app.openai.apiKey'),
        });
    }

    /**
     * Generate embeddings for a query text
     */
    async generateEmbedding(text: string): Promise<number[]> {
        try {
            const response = await this.openai.embeddings.create({
                model: 'text-embedding-ada-002',
                input: text,
            });

            return response.data[0].embedding;
        } catch (error) {
            this.logger.error(`Error generating embedding: ${error.message}`);
            throw error;
        }
    }

    /**
     * Format an embedding array for use in PostgreSQL queries
     */
    formatEmbeddingForPostgres(embedding: number[]): string {
        return `[${embedding.join(',')}]`;
    }
}