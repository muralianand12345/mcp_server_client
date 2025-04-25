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

        // Get a list of buckets with improved tool finding
        const listBucketsTool = this.mcpClientService.getToolByName('list_buckets');

        if (!listBucketsTool) {
            this.logger.warn('S3 list_buckets tool not available');
            throw new Error('S3 list_buckets tool not available');
        }

        const bucketsResponse = await listBucketsTool.invoke({});
        this.logger.debug(`Buckets response: ${JSON.stringify(bucketsResponse)}`);

        // Handle different response formats properly
        let buckets: any[] = [];

        try {
            if (bucketsResponse) {
                // Case 1: Response is already a proper object with buckets array
                if (typeof bucketsResponse === 'object' &&
                    bucketsResponse.buckets &&
                    Array.isArray(bucketsResponse.buckets)) {
                    buckets = bucketsResponse.buckets;
                    this.logger.log(`Found ${buckets.length} S3 buckets from object structure`);
                }
                // Case 2: Response is a string that needs parsing
                else if (typeof bucketsResponse === 'string') {
                    try {
                        const parsed = JSON.parse(bucketsResponse);
                        if (parsed.buckets && Array.isArray(parsed.buckets)) {
                            buckets = parsed.buckets;
                            this.logger.log(`Found ${buckets.length} S3 buckets from JSON string`);
                        }
                    } catch (e) {
                        this.logger.warn(`Failed to parse buckets string response: ${e.message}`);
                    }
                }
                // Case 3: Direct array response
                else if (Array.isArray(bucketsResponse)) {
                    buckets = bucketsResponse;
                    this.logger.log(`Found ${buckets.length} S3 buckets from direct array`);
                }
                // Fallback: Try to extract any bucket information from the response
                else {
                    this.logger.warn(`Unexpected buckets response format: ${typeof bucketsResponse}`);
                    // Try to identify any bucket-like objects in the response
                    if (typeof bucketsResponse === 'object') {
                        for (const key in bucketsResponse) {
                            if (Array.isArray(bucketsResponse[key])) {
                                const possibleBuckets = bucketsResponse[key];
                                if (possibleBuckets.length > 0 &&
                                    possibleBuckets[0].name &&
                                    typeof possibleBuckets[0].name === 'string') {
                                    buckets = possibleBuckets;
                                    this.logger.log(`Found ${buckets.length} S3 buckets from nested property ${key}`);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Error processing buckets response: ${error.message}`);
        }

        // Log the actual bucket data for debugging
        if (buckets.length > 0) {
            this.logger.debug(`First bucket: ${JSON.stringify(buckets[0])}`);
        } else {
            this.logger.warn('No valid S3 buckets identified');
            return results;
        }

        this.logger.log(`Found ${buckets.length} S3 buckets to search`);

        // For each bucket, search for objects related to the query with improved tool finding
        const searchObjectsTool = this.mcpClientService.getToolByName('search_objects');
        if (!searchObjectsTool) {
            this.logger.warn('S3 search_objects tool not available');
            throw new Error('S3 search_objects tool not available');
        }

        // Get content tool with improved finding
        const getObjectContentTool = this.mcpClientService.getToolByName('get_object_content');
        if (!getObjectContentTool) {
            this.logger.warn('S3 get_object_content tool not available');
            throw new Error('S3 get_object_content tool not available');
        }

        // Process each bucket sequentially to avoid overwhelming services
        for (const bucket of buckets) {
            try {
                const bucketName = bucket.name || bucket.Name || bucket.bucket_name || bucket;
                if (!bucketName || typeof bucketName !== 'string') {
                    this.logger.warn(`Invalid bucket name: ${JSON.stringify(bucket)}`);
                    continue;
                }

                this.logger.log(`Searching bucket: ${bucketName}`);

                try {
                    const searchResponse = await searchObjectsTool.invoke({
                        bucket: bucketName,
                        query: query,
                        max_results: 5  // Limit results 
                    });

                    // Process search response
                    let objects: any[] = [];

                    if (searchResponse) {
                        if (typeof searchResponse === 'object' &&
                            searchResponse.objects &&
                            Array.isArray(searchResponse.objects)) {
                            objects = searchResponse.objects;
                        } else if (Array.isArray(searchResponse)) {
                            objects = searchResponse;
                        }
                    }

                    this.logger.log(`Found ${objects.length} matching objects in bucket ${bucketName}`);

                    // Get content for each matching object
                    for (const obj of objects) {
                        try {
                            // Get the key from object
                            const objKey = obj.key || obj.Key || obj.object_key;
                            if (!objKey || typeof objKey !== 'string') {
                                this.logger.warn(`Invalid object key: ${JSON.stringify(obj)}`);
                                continue;
                            }

                            this.logger.log(`Retrieving content for object: ${objKey}`);

                            const contentResponse = await getObjectContentTool.invoke({
                                bucket: bucketName,
                                key: objKey,
                                max_size: 2 * 1024 * 1024  // 2MB limit
                            });

                            // Process content response
                            let content = '';
                            let contentType = '';

                            if (contentResponse) {
                                if (typeof contentResponse === 'object') {
                                    content = contentResponse.content || '';
                                    contentType = contentResponse.content_type || '';
                                } else if (typeof contentResponse === 'string') {
                                    content = contentResponse;
                                }
                            }

                            if (!content) {
                                this.logger.warn(`No content retrieved for ${objKey}`);
                                continue;
                            }

                            // Create enhanced metadata
                            const metadata = {
                                size: obj.size || 0,
                                lastModified: obj.last_modified || obj.lastModified || new Date().toISOString(),
                                contentType: contentType || 'text/plain',
                                storageClass: obj.storage_class || obj.storageClass || 'STANDARD',
                                bucket: bucketName,
                                key: objKey,
                                path: `s3://${bucketName}/${objKey}`,
                                contentPreview: content.substring(0, 150) + (content.length > 150 ? '...' : '')
                            };

                            // Add to results
                            results.push({
                                content,
                                source: `s3://${bucketName}/${objKey}`,
                                metadata
                            });

                            this.logger.log(`Successfully retrieved content for object: ${objKey}`);
                        } catch (error) {
                            this.logger.warn(`Error getting content for object: ${error.message}`);
                        }
                    }
                } catch (error) {
                    this.logger.warn(`Error searching bucket ${bucketName}: ${error.message}`);
                }
            } catch (error) {
                this.logger.warn(`Error processing bucket: ${error.message}`);
            }
        }

        this.logger.log(`Completed S3 search, found ${results.length} relevant documents`);
        return results;
    }

    /**
 * Search Postgres for relevant information using vector search or text fallback
 */
    private async searchPostgres(query: string): Promise<RagResult[]> {
        const results: RagResult[] = [];

        try {
            // Get tools with improved tool finding
            const tools = await this.mcpClientService.getTools();

            // Debug available tools
            this.logger.debug(`Available tool names: ${tools.map(t => t.name).join(', ')}`);

            const queryTool = this.mcpClientService.getToolByName('query');

            if (!queryTool) {
                this.logger.warn('Postgres query tool not available');
                this.logger.debug(`Available tools: ${tools.map(t => t.name).join(', ')}`);
                throw new Error('Postgres query tool not available');
            }

            this.logger.log(`Found Postgres query tool: ${queryTool.name}`);

            try {
                // Check if vector extension is available
                const checkVectorSql = `
            SELECT COUNT(*) as count
            FROM pg_extension 
            WHERE extname = 'vector';
            `;

                const vectorEnabledResponse = await queryTool.invoke({ sql: checkVectorSql });
                this.logger.debug(`Vector extension check result: ${vectorEnabledResponse}`);

                // More robust check for vector extension
                let hasVector = false;

                if (vectorEnabledResponse) {
                    hasVector = !vectorEnabledResponse.includes('No results found') &&
                        !vectorEnabledResponse.includes('Error') &&
                        vectorEnabledResponse.includes('count') &&
                        !vectorEnabledResponse.includes('count: 0');
                }

                if (hasVector) {
                    this.logger.log('Vector extension is available, performing vector search');

                    try {
                        // Generate embedding for query
                        const queryEmbedding = await this.vectorSearchService.generateEmbedding(query);
                        if (!queryEmbedding || queryEmbedding.length === 0) {
                            throw new Error('Failed to generate embedding for query');
                        }

                        const embeddingString = this.vectorSearchService.formatEmbeddingForPostgres(queryEmbedding);

                        // More robust SQL query for vector search
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
                    LIMIT 5;
                    `;

                        this.logger.log('Executing vector similarity search...');

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

                // First check if the table exists
                const checkTableSql = `
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'support_tickets'
            ) as exists;
            `;

                const tableExists = await queryTool.invoke({ sql: checkTableSql });
                if (!tableExists || tableExists.includes('exists: f')) {
                    this.logger.warn('support_tickets table does not exist');
                    throw new Error('support_tickets table does not exist');
                }

                // Build a robust query with multiple search approaches
                let textSearchSql = `
            SELECT 
              ticket_id, 
              subject, 
              description, 
              customer, 
              metadata, 
              resolution
            FROM support_tickets
            WHERE 1=0`;  // Start with false condition and add OR clauses

                // Add direct match on ticket ID if query looks like a ticket ID
                if (/XYZ-\d+/i.test(query)) {
                    const ticketIdMatch = query.match(/XYZ-\d+/i);
                    if (ticketIdMatch) {
                        textSearchSql += ` OR ticket_id ILIKE '%${ticketIdMatch[0]}%'`;
                    }
                }

                // Add subject/description search
                textSearchSql += ` OR subject ILIKE '%${cleanQuery}%' OR description ILIKE '%${cleanQuery}%'`;

                // Add keyword-based search clauses
                if (keywords.length > 0) {
                    keywords.forEach(keyword => {
                        textSearchSql += ` OR subject ILIKE '%${keyword}%' OR description ILIKE '%${keyword}%'`;
                    });
                }

                // Add JSON field search if the table might have JSONB columns
                textSearchSql += `
            OR customer::text ILIKE '%${cleanQuery}%' 
            OR metadata::text ILIKE '%${cleanQuery}%'
            OR resolution::text ILIKE '%${cleanQuery}%'`;

                textSearchSql += ` LIMIT 5;`;

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

                    const describeTableTool = this.mcpClientService.getToolByName('describe_table');
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
        } catch (error) {
            this.logger.error(`Error in searchPostgres: ${error.message}`);
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