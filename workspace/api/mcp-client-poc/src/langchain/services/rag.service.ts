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
            this.logger.log(`Starting RAG retrieval for query: "${query}"`);

            // Initialize results objects
            const s3Results: RagResult[] = [];
            const postgresResults: RagResult[] = [];
            let combinedResults: RagResult[] = [];

            // Get tools for searching
            const tools = await this.mcpClientService.getTools();
            if (!tools || tools.length === 0) {
                this.logger.error('No tools available for RAG retrieval');
                throw new Error('No tools available');
            }

            this.logger.log(`Found ${tools.length} tools for RAG retrieval`);

            // Search S3 documents
            try {
                this.logger.log('Searching S3 for relevant documents...');
                const results = await this.searchS3(query);
                if (results.length > 0) {
                    this.logger.log(`Found ${results.length} relevant documents in S3`);
                    s3Results.push(...results);
                    combinedResults.push(...results);
                } else {
                    this.logger.log('No relevant documents found in S3');
                }
            } catch (error) {
                this.logger.warn(`Error searching S3: ${error.message}`);
            }

            // Search Postgres database
            try {
                this.logger.log('Searching Postgres for relevant information...');
                const results = await this.searchPostgres(query);
                if (results.length > 0) {
                    this.logger.log(`Found ${results.length} relevant records in Postgres`);
                    postgresResults.push(...results);
                    combinedResults.push(...results);
                } else {
                    this.logger.log('No relevant records found in Postgres');
                }
            } catch (error) {
                this.logger.warn(`Error searching Postgres: ${error.message}`);
            }

            // Log detailed results
            this.logger.log(`RAG retrieval completed - Total results: ${combinedResults.length}`);
            this.logger.log(`- S3 results: ${s3Results.length}`);
            this.logger.log(`- Postgres results: ${postgresResults.length}`);

            // Log sources for debugging
            if (combinedResults.length > 0) {
                this.logger.log('Retrieved sources:');
                combinedResults.forEach((result, index) => {
                    this.logger.log(`${index + 1}. ${result.source}`);
                });
            }

            return {
                query,
                combinedResults,
                s3Results,
                postgresResults
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
     * Search S3 for relevant documents
     */
    private async searchS3(query: string): Promise<RagResult[]> {
        const results: RagResult[] = [];
        const tools = await this.mcpClientService.getTools();

        // Get a list of buckets
        const listBucketsTool = tools.find(tool =>
            tool.name === 'list_buckets' || tool.name === 'mcp__s3__list_buckets');
        if (!listBucketsTool) {
            this.logger.warn('S3 list_buckets tool not available');
            throw new Error('S3 list_buckets tool not available');
        }

        const bucketsResponse = await listBucketsTool.invoke({});
        this.logger.debug(`Buckets response: ${JSON.stringify(bucketsResponse)}`);

        // Check if buckets is an array and has items
        if (!bucketsResponse || !bucketsResponse.buckets || !Array.isArray(bucketsResponse.buckets)) {
            this.logger.warn('No valid buckets found in response');
            return results;
        }

        const buckets = bucketsResponse.buckets || [];

        if (buckets.length === 0) {
            this.logger.warn('No S3 buckets found');
            return results;
        }

        this.logger.log(`Found ${buckets.length} S3 buckets to search`);

        // For each bucket, search for objects related to the query
        const searchObjectsTool = tools.find(tool => tool.name === 'search_objects');
        if (!searchObjectsTool) {
            this.logger.warn('S3 search_objects tool not available');
            throw new Error('S3 search_objects tool not available');
        }

        for (const bucket of buckets) {
            try {
                this.logger.log(`Searching bucket: ${bucket.name}`);

                const searchResponse = await searchObjectsTool.invoke({
                    bucket: bucket.name,
                    query: query,
                    max_results: 5  // Increased from 3 to 5
                });

                this.logger.debug(`Search response for bucket ${bucket.name}: ${JSON.stringify(searchResponse)}`);

                if (searchResponse.objects && Array.isArray(searchResponse.objects) && searchResponse.objects.length > 0) {
                    this.logger.log(`Found ${searchResponse.objects.length} matching objects in bucket ${bucket.name}`);

                    // Get content of relevant objects
                    const getObjectContentTool = tools.find(tool => tool.name === 'get_object_content');
                    if (!getObjectContentTool) {
                        this.logger.warn('S3 get_object_content tool not available');
                        throw new Error('S3 get_object_content tool not available');
                    }

                    for (const obj of searchResponse.objects) {
                        try {
                            this.logger.log(`Retrieving content for object: ${obj.key}`);

                            const contentResponse = await getObjectContentTool.invoke({
                                bucket: bucket.name,
                                key: obj.key,
                                // Increased max size
                                max_size: 2 * 1024 * 1024  // 2MB
                            });

                            // Enhanced metadata with more details
                            const enhancedMetadata = {
                                size: obj.size,
                                lastModified: obj.last_modified,
                                contentType: contentResponse.content_type,
                                storageClass: obj.storage_class || 'STANDARD',
                                bucket: bucket.name,
                                key: obj.key,
                                // Add a fully qualified path for easy reference
                                path: `s3://${bucket.name}/${obj.key}`,
                                // Add content preview for reference
                                contentPreview: contentResponse.content.substring(0, 150) + (contentResponse.content.length > 150 ? '...' : '')
                            };

                            results.push({
                                content: contentResponse.content,
                                source: `s3://${bucket.name}/${obj.key}`,
                                metadata: enhancedMetadata
                            });

                            this.logger.log(`Successfully retrieved content for object: ${obj.key}`);
                        } catch (error) {
                            this.logger.warn(`Error getting content for ${obj.key}: ${error.message}`);
                        }
                    }
                } else {
                    this.logger.log(`No matching objects found in bucket ${bucket.name}`);
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
            this.logger.warn('Postgres query tool not available');
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
            this.logger.debug(`Vector extension check result: ${vectorEnabled}`);

            // More robust check for vector extension
            const hasVector = vectorEnabled &&
                !vectorEnabled.includes('No results found') &&
                !vectorEnabled.includes('Error') &&
                !vectorEnabled.includes('0');

            if (hasVector) {
                this.logger.log('Vector extension is available, performing vector search');

                try {
                    // Generate embedding for query
                    const queryEmbedding = await this.vectorSearchService.generateEmbedding(query);
                    if (!queryEmbedding || queryEmbedding.length === 0) {
                        throw new Error('Failed to generate embedding for query');
                    }

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
                    WHERE 1 - (embedding <=> '${embeddingString}'::vector) > 0.5
                    ORDER BY embedding <=> '${embeddingString}'::vector
                    LIMIT 5;
                    `;

                    this.logger.log('Executing vector similarity search...');
                    this.logger.debug(`Vector search SQL: ${vectorSearchSql}`);

                    const vectorResults = await queryTool.invoke({ sql: vectorSearchSql });
                    this.logger.debug(`Vector search results: ${vectorResults}`);

                    if (vectorResults && !vectorResults.includes('Error')) {
                        this.logger.log('Vector search successful');
                        const parsed = this.parsePostgresResults(vectorResults);
                        results.push(...parsed);

                        if (parsed.length > 0) {
                            this.logger.log(`Found ${parsed.length} results via vector search`);
                            return results;
                        }
                    } else {
                        this.logger.warn(`Vector search returned an error or no results: ${vectorResults}`);
                    }
                } catch (error) {
                    this.logger.warn(`Error in vector search execution: ${error.message}`);
                }
            } else {
                this.logger.warn('Vector extension is not enabled in PostgreSQL, falling back to text search');
            }
        } catch (error) {
            this.logger.warn(`Error checking vector extension: ${error.message}`);
        }

        // Fallback to text search if vector search failed or is not available
        try {
            this.logger.log('Performing text search in Postgres');

            // Improved text search with better escaping and multiple search patterns
            const cleanQuery = query.replace(/'/g, "''");
            const keywords = cleanQuery.split(/\s+/).filter(k => k.length > 3);

            let textSearchSql = `
            SELECT 
              ticket_id, 
              subject, 
              description, 
              customer, 
              metadata, 
              resolution
            FROM support_tickets
            WHERE 
              subject ILIKE '%${cleanQuery}%' OR 
              description ILIKE '%${cleanQuery}%'
            `;

            // Add keyword-based search clauses
            if (keywords.length > 0) {
                textSearchSql += ' OR ' + keywords.map(k => `subject ILIKE '%${k}%' OR description ILIKE '%${k}%'`).join(' OR ');
            }

            textSearchSql += ' LIMIT 5;';

            this.logger.debug(`Text search SQL: ${textSearchSql}`);
            const queryResponse = await queryTool.invoke({ sql: textSearchSql });
            this.logger.debug(`Text search results: ${queryResponse}`);

            // Parse the results
            if (queryResponse && queryResponse.includes('Results:')) {
                const parsed = this.parsePostgresResults(queryResponse);
                parsed.forEach(result => {
                    // Mark these as text search results in metadata
                    result.metadata.searchMethod = 'text_search';
                });
                results.push(...parsed);
                this.logger.log(`Found ${parsed.length} results via text search`);
            } else {
                this.logger.log('No results found from text search');
            }
        } catch (error) {
            this.logger.warn(`Error executing text search query: ${error.message}`);
        }

        // If no results yet, try getting ticket schema and some sample data
        if (results.length === 0) {
            try {
                this.logger.log('No search results found, fetching schema information as fallback');

                const describeTableTool = tools.find(tool => tool.name === 'describe_table');
                if (describeTableTool) {
                    const tableStructure = await describeTableTool.invoke({
                        table_name: 'support_tickets',
                        db_schema: 'public'
                    });

                    // Also get a sample ticket to provide context
                    const sampleTicketSql = `
                    SELECT ticket_id, subject FROM support_tickets LIMIT 1;
                    `;

                    const sampleTicket = await queryTool.invoke({ sql: sampleTicketSql });

                    results.push({
                        content: `No exact matches found, but here's the support_tickets table structure:\n${tableStructure}\n\nSample ticket data:\n${sampleTicket}`,
                        source: 'postgres:schema:support_tickets',
                        metadata: {
                            type: 'schema',
                            table: 'support_tickets',
                            schema: 'public',
                            searchMethod: 'fallback'
                        }
                    });

                    this.logger.log('Added table schema as fallback result');
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
        if (!jsonString) return null;

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            // Try to fix common issues with the JSON string
            try {
                // 1. Handle PostgreSQL JSON formatting
                let fixedJson = jsonString
                    // Replace postgres-style JSON keys without quotes
                    .replace(/([{,])\s*([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
                    // Fix single quotes to double quotes
                    .replace(/'/g, '"')
                    // Remove escaped double quotes with actual double quotes
                    .replace(/\\"/g, '"')
                    // Fix situations where " would be escaped incorrectly
                    .replace(/\\\\"/g, '\\"');

                // Handle edge case where the beginning or end might be malformed
                if (!fixedJson.startsWith('{') && !fixedJson.startsWith('[')) {
                    fixedJson = fixedJson.substring(fixedJson.indexOf('{'));
                }

                // Sometimes there's trailing text after the JSON
                const closeBrace = fixedJson.lastIndexOf('}');
                const closeArray = fixedJson.lastIndexOf(']');
                const lastValidChar = Math.max(closeBrace, closeArray);

                if (lastValidChar > 0 && lastValidChar < fixedJson.length - 1) {
                    fixedJson = fixedJson.substring(0, lastValidChar + 1);
                }

                return JSON.parse(fixedJson);
            } catch (e2) {
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

        if (!queryResponse || !queryResponse.includes('Results:')) {
            return results;
        }

        const resultLines = queryResponse.split('\n').slice(2); // Skip the "Results:" and "--------" lines
        for (const line of resultLines) {
            if (!line.trim()) continue;

            // Parse the line into key-value pairs
            const fields = line.split(' | ');
            const resultObj: Record<string, any> = {};

            for (const field of fields) {
                const [key, ...valueParts] = field.split(': ');
                if (!key || !key.trim()) continue;

                const value = valueParts.join(': ');
                resultObj[key.trim()] = value;
            }

            if (!resultObj.ticket_id) continue;

            let content = '';
            if (resultObj.subject) content += `Subject: ${resultObj.subject}\n`;
            if (resultObj.description) content += `Description: ${resultObj.description}\n`;
            if (resultObj.similarity) content += `Similarity Score: ${resultObj.similarity}\n`;

            // Enhanced metadata collection
            const metadata: Record<string, any> = {
                ticketId: resultObj.ticket_id,
                dataSource: 'postgres',
                tableName: 'support_tickets',
                similarity: resultObj.similarity || null,
                recordFields: Object.keys(resultObj).filter(k => k !== 'ticket_id'),
            };

            // Try to extract and parse JSON fields
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
                        metadata.customer = customerData;
                    } else {
                        content += `Customer: ${resultObj.customer}\n`;
                        metadata.customer = { raw: resultObj.customer };
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
                        metadata.resolution = resolutionData;
                    } else {
                        content += `Resolution: ${resultObj.resolution}\n`;
                        metadata.resolution = { raw: resultObj.resolution };
                    }
                }

                // Handle metadata JSON field - with special focus on images
                if (resultObj.metadata) {
                    const metadataData = this.tryParseJson(resultObj.metadata);
                    if (typeof metadataData === 'object' && metadataData !== null) {
                        content += 'Metadata Details:\n';

                        // Extract and properly format image information
                        const images = metadataData.images;
                        if (images && Array.isArray(images)) {
                            content += `- images: ${images.length} image(s)\n`;

                            // Add detailed image information to metadata for the agent to use
                            metadata.images = images.map((img, idx) => ({
                                index: idx + 1,
                                description: img.description || 'No description',
                                s3_key: img.s3_key,
                                uploaded_at: img.uploaded_at,
                                presigned_url: img.presigned_url,
                                exists: img.exists
                            }));

                            // Add image information to content
                            images.forEach((img, idx) => {
                                content += `  Image ${idx + 1}: ${img.description || 'No description'}\n`;
                                if (img.s3_key) {
                                    content += `    Path: ${img.s3_key}\n`;
                                    // This helps the agent know it can retrieve this image from S3
                                    content += `    Storage: Available in S3 bucket\n`;
                                }
                            });
                        }

                        // Include other metadata fields
                        for (const [key, value] of Object.entries(metadataData)) {
                            if (key !== 'images') {
                                content += `- ${key}: ${JSON.stringify(value)}\n`;
                                metadata[key] = value;
                            }
                        }
                        content += '\n';
                    }
                }
            } catch (e) {
                this.logger.warn(`Error parsing JSON fields: ${e.message}`);
            }

            results.push({
                content,
                source: `postgres:support_tickets:${resultObj.ticket_id}`,
                metadata
            });
        }

        return results;
    }

    /**
     * Formats RAG results into a prompt context for the LLM
     */
    formatRagContext(results: RagResult[]): string {
        if (!results || results.length === 0) {
            return '';
        }

        let context = '### Relevant Information:\n\n';

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            context += `#### Source ${i + 1}: ${result.source}\n`;
            context += `${result.content}\n\n`;

            // Add metadata if available - with specific guidance for the agent
            if (result.metadata && Object.keys(result.metadata).length > 0) {
                context += '**Source Metadata:**\n';

                // Special handling for S3 sources
                if (result.source.startsWith('s3://')) {
                    context += '- Type: S3 Object\n';
                    if (result.metadata.bucket) {
                        context += `- Bucket: ${result.metadata.bucket}\n`;
                    }
                    if (result.metadata.key) {
                        context += `- Key: ${result.metadata.key}\n`;
                    }
                    if (result.metadata.contentType) {
                        context += `- Content Type: ${result.metadata.contentType}\n`;
                    }
                }
                // Special handling for Postgres sources with images
                else if (result.source.includes('postgres:') && result.metadata.images) {
                    context += '- Type: Database Record with Images\n';
                    context += `- Images Available: ${result.metadata.images.length}\n`;

                    // Add clear guidance on retrieving images
                    context += '- **Retrieval Instructions**: To view these images, use the S3 tools with:\n';
                    result.metadata.images.forEach((img, idx) => {
                        if (img.s3_key) {
                            context += `  * get_object_content tool with bucket="xyz-support-images" and key="${img.s3_key}"\n`;
                        }
                    });
                }
                // General metadata for any source
                else {
                    for (const [key, value] of Object.entries(result.metadata)) {
                        if (value && typeof value !== 'object') {
                            context += `- ${key}: ${value}\n`;
                        }
                    }
                }
                context += '\n';
            }
        }

        // Add explicit instructions for the agent
        context += `### Retrieval Instructions for the Agent:
- For S3 documents, you can use the S3 tools (list_buckets, search_objects, get_object_content) to fetch additional content
- For Postgres data, you can use the Postgres tools (query, describe_table) to fetch additional data
- If you need to display an image, fetch it from S3 using the get_object_content tool with the provided keys
- Use the metadata in your response to correctly attribute sources and provide accurate information

Use these retrieved documents to help answer the user's question completely and accurately.
`;

        return context;
    }
}