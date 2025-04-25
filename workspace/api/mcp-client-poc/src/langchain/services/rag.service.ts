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

@Injectable()
export class RagService {
    private readonly logger = new Logger(RagService.name);

    constructor(
        private configService: ConfigService,
        private mcpClientService: McpClientService,
        private vectorSearchService: VectorSearchService,
    ) { }

    /**
     * Retrieves relevant information from S3 and Postgres based on the query
     */
    async retrieveRelevantInfo(query: string): Promise<RagQueryResults> {
        try {
            // Initialize results objects
            const s3Results: RagResult[] = [];
            const postgresResults: RagResult[] = [];
            let combinedResults: RagResult[] = [];

            // Get tools for searching
            const tools = await this.mcpClientService.getTools();
            if (!tools || tools.length === 0) {
                throw new Error('No tools available');
            }

            // Search S3 documents
            try {
                const results = await this.searchS3(query);
                if (results.length > 0) {
                    s3Results.push(...results);
                    combinedResults.push(...results);
                }
            } catch (error) {
                this.logger.warn(`Error searching S3: ${error.message}`);
            }

            // Search Postgres database
            try {
                const results = await this.searchPostgres(query);
                if (results.length > 0) {
                    postgresResults.push(...results);
                    combinedResults.push(...results);
                }
            } catch (error) {
                this.logger.warn(`Error searching Postgres: ${error.message}`);
            }

            return {
                query,
                combinedResults,
                s3Results,
                postgresResults
            };
        } catch (error) {
            this.logger.error(`Error retrieving RAG info: ${error.message}`);
            return {
                query,
                combinedResults: [],
                s3Results: [],
                postgresResults: []
            };
        }
    }

    /**
     * Search S3 for relevant documents
     */
    private async searchS3(query: string): Promise<RagResult[]> {
        const results: RagResult[] = [];
        const tools = await this.mcpClientService.getTools();

        // Get a list of buckets
        const listBucketsTool = tools.find(tool => tool.name === 'list_buckets');
        if (!listBucketsTool) {
            throw new Error('S3 list_buckets tool not available');
        }

        const bucketsResponse = await listBucketsTool.invoke({});
        const buckets = bucketsResponse.buckets || [];

        if (buckets.length === 0) {
            this.logger.warn('No S3 buckets found');
            return results;
        }

        // For each bucket, search for objects related to the query
        const searchObjectsTool = tools.find(tool => tool.name === 'search_objects');
        if (!searchObjectsTool) {
            throw new Error('S3 search_objects tool not available');
        }

        for (const bucket of buckets) {
            try {
                const searchResponse = await searchObjectsTool.invoke({
                    bucket: bucket.name,
                    query: query,
                    max_results: 3
                });

                if (searchResponse.objects && searchResponse.objects.length > 0) {
                    // Get content of relevant objects
                    const getObjectContentTool = tools.find(tool => tool.name === 'get_object_content');
                    if (!getObjectContentTool) {
                        throw new Error('S3 get_object_content tool not available');
                    }

                    for (const obj of searchResponse.objects) {
                        try {
                            const contentResponse = await getObjectContentTool.invoke({
                                bucket: bucket.name,
                                key: obj.key
                            });

                            results.push({
                                content: contentResponse.content,
                                source: `s3://${bucket.name}/${obj.key}`,
                                metadata: {
                                    size: obj.size,
                                    lastModified: obj.last_modified,
                                    contentType: contentResponse.content_type
                                }
                            });
                        } catch (error) {
                            this.logger.warn(`Error getting content for ${obj.key}: ${error.message}`);
                        }
                    }
                }
            } catch (error) {
                this.logger.warn(`Error searching bucket ${bucket.name}: ${error.message}`);
            }
        }

        return results;
    }

    /**
     * Search Postgres for relevant information using vector search
     */
    private async searchPostgres(query: string): Promise<RagResult[]> {
        const results: RagResult[] = [];
        const tools = await this.mcpClientService.getTools();

        const queryTool = tools.find(tool => tool.name === 'query');
        if (!queryTool) {
            throw new Error('Postgres query tool not available');
        }

        try {
            // Check if vector extension is available
            const checkVectorSql = `
            SELECT COUNT(*) 
            FROM pg_extension 
            WHERE extname = 'vector';
            `;

            const vectorEnabled = await queryTool.invoke({ sql: checkVectorSql });

            if (vectorEnabled && !vectorEnabled.includes('No results found') && !vectorEnabled.includes('0')) {
                this.logger.log('Vector extension is available, performing vector search');

                // Generate embedding for query
                const queryEmbedding = await this.vectorSearchService.generateEmbedding(query);
                const embeddingString = this.vectorSearchService.formatEmbeddingForPostgres(queryEmbedding);

                // Use vector search with embedding similarity
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
                ORDER BY embedding <=> '${embeddingString}'::vector
                LIMIT 3;
                `;

                this.logger.log('Executing vector similarity search...');

                const vectorResults = await queryTool.invoke({ sql: vectorSearchSql });
                if (vectorResults && !vectorResults.includes('Error')) {
                    this.logger.log('Vector search successful');
                    const parsed = this.parsePostgresResults(vectorResults);
                    results.push(...parsed);

                    if (parsed.length > 0) {
                        this.logger.log(`Found ${parsed.length} results via vector search`);
                        return results;
                    }
                } else {
                    this.logger.warn(`Vector search returned an error: ${vectorResults}`);
                }
            } else {
                this.logger.warn('Vector extension is not enabled in PostgreSQL');
            }
        } catch (error) {
            this.logger.warn(`Error with vector search: ${error.message}`);
        }

        // Fallback to text search if vector search failed or is not available
        try {
            this.logger.log('Falling back to text search');
            const textSearchSql = `
            SELECT 
              ticket_id, 
              subject, 
              description, 
              customer, 
              metadata, 
              resolution
            FROM support_tickets
            WHERE 
              subject ILIKE '%${query.replace(/'/g, "''")}%' OR 
              description ILIKE '%${query.replace(/'/g, "''")}%'
            LIMIT 3;
            `;

            const queryResponse = await queryTool.invoke({ sql: textSearchSql });

            // Parse the results
            if (queryResponse && queryResponse.includes('Results:')) {
                const parsed = this.parsePostgresResults(queryResponse);
                results.push(...parsed);
                this.logger.log(`Found ${parsed.length} results via text search`);
            }
        } catch (error) {
            this.logger.warn(`Error executing text search query: ${error.message}`);
        }

        // If no results yet, try getting ticket schema and some sample data
        if (results.length === 0) {
            try {
                const describeTableTool = tools.find(tool => tool.name === 'describe_table');
                if (describeTableTool) {
                    const tableStructure = await describeTableTool.invoke({
                        table_name: 'support_tickets',
                        db_schema: 'public'
                    });

                    results.push({
                        content: `No exact matches found, but here's the support_tickets table structure:\n${tableStructure}`,
                        source: 'postgres:schema:support_tickets',
                        metadata: { type: 'schema' }
                    });
                }
            } catch (error) {
                this.logger.warn(`Error getting table schema: ${error.message}`);
            }
        }

        return results;
    }

    /**
     * Safely parse JSON string
     */
    private tryParseJson(jsonString: string): any {
        try {
            return JSON.parse(jsonString);
        } catch (e) {
            // Try to fix common issues with the JSON string
            // 1. Try wrapping with quotes if needed
            try {
                if (!jsonString.startsWith('{') && !jsonString.startsWith('[')) {
                    return JSON.parse(`"${jsonString.replace(/"/g, '\\"')}"`);
                }
            } catch (e) {
                // Ignore this attempt
            }

            // 2. Try handling PostgreSQL JSON formatting
            try {
                // Replace postgres-style JSON keys without quotes
                const fixedJson = jsonString
                    .replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
                    // Fix single quotes to double quotes
                    .replace(/'/g, '"');
                return JSON.parse(fixedJson);
            } catch (e) {
                // If all attempts fail, return the original string
                return jsonString;
            }
        }
    }

    /**
     * Parse PostgreSQL results into a structured format
     */
    private parsePostgresResults(queryResponse: string): RagResult[] {
        const results: RagResult[] = [];

        if (queryResponse && queryResponse.includes('Results:')) {
            const resultLines = queryResponse.split('\n').slice(2); // Skip the "Results:" and "--------" lines
            for (const line of resultLines) {
                if (line.trim()) {
                    // Parse the line into key-value pairs
                    const fields = line.split(' | ');
                    const resultObj: Record<string, any> = {};

                    for (const field of fields) {
                        const [key, ...valueParts] = field.split(': ');
                        const value = valueParts.join(': ');
                        resultObj[key.trim()] = value;
                    }

                    if (resultObj.ticket_id) {
                        let content = '';
                        if (resultObj.subject) content += `Subject: ${resultObj.subject}\n`;
                        if (resultObj.description) content += `Description: ${resultObj.description}\n`;
                        if (resultObj.similarity) content += `Similarity Score: ${resultObj.similarity}\n`;

                        // Try to extract JSON fields
                        try {
                            // Handle customer JSON field
                            if (resultObj.customer) {
                                const customerData = this.tryParseJson(resultObj.customer);
                                if (typeof customerData === 'object' && customerData !== null) {
                                    content += 'Customer Details:\n';
                                    for (const [key, value] of Object.entries(customerData)) {
                                        content += `- ${key}: ${value}\n`;
                                    }
                                    content += '\n';
                                } else {
                                    content += `Customer: ${resultObj.customer}\n`;
                                }
                            }

                            // Handle resolution JSON field
                            if (resultObj.resolution) {
                                const resolutionData = this.tryParseJson(resultObj.resolution);
                                if (typeof resolutionData === 'object' && resolutionData !== null) {
                                    content += 'Resolution Details:\n';
                                    for (const [key, value] of Object.entries(resolutionData)) {
                                        content += `- ${key}: ${value}\n`;
                                    }
                                    content += '\n';
                                } else {
                                    content += `Resolution: ${resultObj.resolution}\n`;
                                }
                            }

                            // Handle metadata JSON field
                            if (resultObj.metadata) {
                                const metadataData = this.tryParseJson(resultObj.metadata);
                                if (typeof metadataData === 'object' && metadataData !== null) {
                                    content += 'Metadata Details:\n';
                                    for (const [key, value] of Object.entries(metadataData)) {
                                        // Handle nested objects like images array
                                        if (key === 'images' && Array.isArray(value)) {
                                            content += `- images: ${value.length} image(s)\n`;
                                            value.forEach((img, idx) => {
                                                content += `  Image ${idx + 1}: ${img.description || 'No description'}\n`;
                                                if (img.s3_key) {
                                                    content += `    Path: ${img.s3_key}\n`;
                                                }
                                            });
                                        } else {
                                            content += `- ${key}: ${JSON.stringify(value)}\n`;
                                        }
                                    }
                                    content += '\n';
                                }
                            }
                        } catch (e) {
                            this.logger.warn(`Error parsing JSON fields: ${e.message}`);
                        }

                        // Extract metadata from the returned fields
                        const metadata: Record<string, any> = {};
                        for (const [key, value] of Object.entries(resultObj)) {
                            if (key !== 'ticket_id' && key !== 'subject' && key !== 'description' &&
                                key !== 'customer' && key !== 'resolution') {
                                metadata[key] = value;
                            }
                        }

                        results.push({
                            content,
                            source: `postgres:support_tickets:${resultObj.ticket_id}`,
                            metadata
                        });
                    }
                }
            }
        }

        return results;
    }

    /**
     * Formats RAG results into a prompt context for the LLM
     */
    formatRagContext(results: RagResult[]): string {
        if (results.length === 0) {
            return '';
        }

        let context = '### Relevant Information:\n\n';

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            context += `#### Source ${i + 1}: ${result.source}\n`;
            context += `${result.content}\n\n`;

            // Add metadata if available
            if (result.metadata && Object.keys(result.metadata).length > 0) {
                context += '**Metadata:**\n';
                for (const [key, value] of Object.entries(result.metadata)) {
                    if (value && typeof value === 'string') {
                        context += `- ${key}: ${value}\n`;
                    }
                }
                context += '\n';
            }
        }

        return context;
    }
}