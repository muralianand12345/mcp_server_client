import { Injectable } from '@nestjs/common';
import { RagData, RagResult } from '../../common/interfaces/rag-result.interface';
import { DatabaseService } from '../../shared/database/database.service';
import { OpenAIService } from '../../shared/openai/openai.service';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class RagService {
    private readonly bucketName: string;
    private readonly topK: number;

    constructor(
        private databaseService: DatabaseService,
        private openaiService: OpenAIService,
        private configService: ConfigService,
    ) {
        this.bucketName = this.configService.s3BucketName;
        this.topK = this.configService.topK;
    }

    async search(query: string): Promise<RagData> {
        try {
            // Generate embedding for the query
            const embeddingVector = await this.openaiService.generateEmbedding(query);
            const queryEmbedding = `[${embeddingVector.join(',')}]`;

            // Execute the vector search query
            const vectorSearchQuery = `
                SELECT 
                id,
                ticket_id,
                subject,
                description,
                customer,
                metadata,
                resolution,
                created_at
                FROM public.vector_table
                ORDER BY embedding <=> $1::vector
                LIMIT $2;
            `;

            const result = await this.databaseService.query(vectorSearchQuery, [queryEmbedding, this.topK]);

            // Transform database results
            const ragResults: RagResult[] = result.rows.map(row => ({
                content: `${row.description} Answer/Resolution: ${row.resolution.solution}`,
                ticketId: row.ticket_id,
                subject: row.subject,
                metadata: [{
                    data: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
                    resolution: row.resolution,
                    createdAt: row.created_at
                }]
            }));

            // Return formatted RAG data
            return {
                query,
                ragResult: ragResults
            };
        } catch (error) {
            console.error(`Vector search failed: ${error.message}`);
            // Return empty results on error
            return {
                query,
                ragResult: []
            };
        }
    }

    // Format the RAG results into a string context for the agent
    formatRagContext(ragData: RagData): string {
        if (!ragData || !ragData.ragResult || ragData.ragResult.length === 0) {
            return '';
        }

        return ragData.ragResult.map(result =>
            `Ticket ID: ${result.ticketId}
            Subject: ${result.subject}
            Content: ${result.content}
            Metadata: ${JSON.stringify(result.metadata, null, 2)}
            Images: ${result.metadata.map(m =>
                m.data.images ? m.data.images.map(img => img.s3_key).join(', ') : ''
            ).join(', ')}`
        ).join('\n\n');
    }

    async testQuery(query: string): Promise<any> {
        const ragData = await this.search(query);

        return {
            query,
            totalResults: ragData.ragResult.length,
            s3Results: ragData.ragResult.filter(r =>
                r.metadata.some(m => m.data.images && m.data.images.length > 0)
            ).length,
            postgresResults: ragData.ragResult.length,
            formattedSources: ragData.ragResult.map(r => ({
                source: r.ticketId,
                contentPreview: r.content.substring(0, 200)
            }))
        };
    }
}