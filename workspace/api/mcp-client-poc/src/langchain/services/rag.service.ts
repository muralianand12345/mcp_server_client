import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { McpClientService } from '../clients/mcp-client.service';
import { VectorSearchService } from './vector-search.service';

export interface RagResult {
    content: string;
    source: string;
    metadata: Record<string, any>;
}

export interface RagQueryResults {
    query: string;
    combinedResults: RagResult[];
    s3Results: RagResult[];
    postgresResults: RagResult[];
}

export interface ImageInfo {
    s3_key: string;
    description: string;
    uploaded_at: string;
    presigned_url?: string;
    exists: boolean;
    bucket: string;
    content?: string;
    contentType?: string;
}

@Injectable()
export class RagService {
    private readonly logger = new Logger(RagService.name);
    private readonly defaultBucketName = 'xyz-support-images';

    constructor(
        private configService: ConfigService,
        private mcpClientService: McpClientService,
        private vectorSearchService: VectorSearchService,
    ) { }

    /**
     * Retrieves relevant information based on the query
     */
    async retrieveRelevantInfo(query: string): Promise<RagQueryResults> {
        try {
            this.logger.log(`Starting RAG retrieval for query: "${query}"`);

            // Get top 3 vector search results
            const vectorResults = await this.getTop3VectorResults(query);

            return {
                query,
                combinedResults: vectorResults,
                s3Results: [],
                postgresResults: vectorResults
            };
        } catch (error) {
            this.logger.error(`Error in RAG retrieval: ${error.message}`);
            return {
                query,
                combinedResults: [],
                s3Results: [],
                postgresResults: []
            };
        }
    }

    /**
     * Get top 3 relevant documents using vector similarity search
     */
    private async getTop3VectorResults(query: string): Promise<RagResult[]> {
        try {
            this.logger.log(`Starting vector search for query: "${query}"`);

            const queryTool = this.mcpClientService.getToolByName('query');
            if (!queryTool) {
                throw new Error('Query tool not available');
            }

            // Generate embedding for query
            const queryEmbedding = await this.vectorSearchService.generateEmbedding(query);
            if (!queryEmbedding || queryEmbedding.length === 0) {
                throw new Error('Failed to generate embedding for query');
            }

            // Format embedding for PostgreSQL
            const embeddingString = this.vectorSearchService.formatEmbeddingForPostgres(queryEmbedding);

            // Execute vector similarity search limiting to top 3 results
            const vectorSearchSql = `
        SELECT 
          ticket_id, 
          subject, 
          description,
          customer,
          metadata,
          resolution,
          1 - (embedding <=> '${embeddingString}'::vector) AS similarity
        FROM support_tickets
        WHERE embedding IS NOT NULL
        ORDER BY embedding <=> '${embeddingString}'::vector
        LIMIT 3;
      `;

            const results = await queryTool.invoke({ sql: vectorSearchSql });
            return this.parseResults(results);
        } catch (error) {
            this.logger.error(`Error in vector search: ${error.message}`);
            return [];
        }
    }

    /**
     * Parse query results into RagResult format
     */
    private parseResults(queryResponse: string): RagResult[] {
        const results: RagResult[] = [];

        if (!queryResponse || !queryResponse.includes('Results:')) {
            return results;
        }

        const resultLines = queryResponse.split('\n').slice(2); // Skip header lines

        for (const line of resultLines) {
            if (!line.trim()) continue;

            // Parse line into key-value pairs
            const fields = line.split(' | ');
            const record: Record<string, any> = {};

            for (const field of fields) {
                const [key, ...valueParts] = field.split(': ');
                if (!key || !key.trim()) continue;
                record[key.trim()] = valueParts.join(': ');
            }

            if (!record.ticket_id) continue;

            // Parse JSON fields
            const customer = this.parseJsonField(record.customer);
            const metadata = this.parseJsonField(record.metadata);
            const resolution = this.parseJsonField(record.resolution);

            // Format content with all available information
            let content = `Ticket: ${record.ticket_id}\n`;
            content += `Subject: ${record.subject}\n`;
            content += `Description: ${record.description}\n`;
            content += `Similarity: ${record.similarity || 'unknown'}\n\n`;

            // Add customer details if available
            if (customer && typeof customer === 'object') {
                content += 'Customer:\n';
                Object.entries(customer).forEach(([k, v]) => {
                    content += `  ${k}: ${v}\n`;
                });
                content += '\n';
            }

            // Add metadata details
            if (metadata && typeof metadata === 'object') {
                content += 'Metadata:\n';
                Object.entries(metadata).forEach(([k, v]) => {
                    // Special handling for images
                    if (k === 'images' && Array.isArray(v)) {
                        content += `  images: ${v.length} image(s)\n`;
                        v.forEach((img, idx) => {
                            content += `    Image ${idx + 1}: ${img.description || 'No description'}\n`;
                            content += `      Path: ${img.s3_key}\n`;
                        });
                    } else {
                        content += `  ${k}: ${JSON.stringify(v)}\n`;
                    }
                });
                content += '\n';
            }

            // Add resolution if available
            if (resolution && typeof resolution === 'object') {
                content += 'Resolution:\n';
                Object.entries(resolution).forEach(([k, v]) => {
                    content += `  ${k}: ${v}\n`;
                });
            }

            // Include all metadata as JSON string
            const fullMetadata = {
                ticketId: record.ticket_id,
                similarity: record.similarity,
                customer,
                metadata,
                resolution,
                rawData: record
            };

            results.push({
                content,
                source: `postgres:support_tickets:${record.ticket_id}`,
                metadata: fullMetadata
            });
        }

        return results;
    }

    /**
     * Parse a JSON field from string
     */
    private parseJsonField(jsonStr: string): any {
        if (!jsonStr) return null;

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            // Try to fix common PostgreSQL JSON formatting issues
            try {
                const fixedJson = jsonStr
                    .replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
                    .replace(/'/g, '"')
                    .replace(/\\"/g, '"');

                return JSON.parse(fixedJson);
            } catch (e2) {
                // Return the original string if parsing fails
                return jsonStr;
            }
        }
    }

    /**
     * Format RAG results into a prompt context string
     */
    formatRagContext(results: RagResult[]): string {
        if (!results || results.length === 0) {
            return 'No relevant information found.';
        }

        let context = 'The s3_key is the file image is connected that is relavant to the file attach them to the response\n\n### Retrieved Information:\n\n';

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            context += `#### Source ${i + 1}: ${result.source}\n`;
            context += `${result.content}\n\n`;
            context += `#### Full Metadata:\n\`\`\`json\n${JSON.stringify(result.metadata, null, 2)}\n\`\`\`\n\n`;
            context += '---\n\n';
        }

        return context;
    }
}