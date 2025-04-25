import { Controller, Get, Post, Body, Headers, Query, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { RagService } from '../../langchain/services/rag.service';
import { McpClientService } from '../../langchain/clients/mcp-client.service';
import { VectorSearchService } from '../../langchain/services/vector-search.service';

@Controller('rag')
export class RagDiagnosticsController {
    private readonly logger = new Logger(RagDiagnosticsController.name);

    constructor(
        private ragService: RagService,
        private mcpClientService: McpClientService,
        private vectorSearchService: VectorSearchService
    ) { }

    @Get('diagnostics')
    async getDiagnostics() {
        try {
            this.logger.log('Performing RAG diagnostics check');

            // Get MCP client diagnostics
            const mcpDiagnostics = this.mcpClientService.getDiagnostics();

            // Try to get a tool and verify if it works
            let toolTestResult = 'not_tested';
            let toolError = null;

            try {
                const listBucketsTool = this.mcpClientService.getToolByName('list_buckets');
                if (listBucketsTool) {
                    const bucketResponse = await listBucketsTool.invoke({});
                    toolTestResult = bucketResponse && bucketResponse.buckets ? 'success' : 'no_data';
                } else {
                    toolTestResult = 'tool_not_found';
                }
            } catch (error) {
                toolTestResult = 'error';
                toolError = error.message;
            }

            // Return diagnostics information
            return {
                status: 'success',
                mcpConnection: mcpDiagnostics,
                toolTest: {
                    result: toolTestResult,
                    error: toolError
                },
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Error in RAG diagnostics: ${error.message}`);
            throw new HttpException(
                `Error getting RAG diagnostics: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('test-query')
    async testRagQuery(@Body() body: { query: string }) {
        try {
            if (!body.query) {
                throw new HttpException(
                    'Query parameter is required',
                    HttpStatus.BAD_REQUEST,
                );
            }

            this.logger.log(`Testing RAG query: "${body.query}"`);

            // Retrieve RAG results directly
            const results = await this.ragService.retrieveRelevantInfo(body.query);

            // Format sources in a readable way
            const formattedSources = results.combinedResults.map((source, index) => ({
                index: index + 1,
                source: source.source,
                contentLength: source.content.length,
                contentPreview: source.content.substring(0, 150) + (source.content.length > 150 ? '...' : ''),
                metadata: source.metadata
            }));

            // Format the RAG context that would be sent to the LLM
            const formattedContext = results.combinedResults.length > 0
                ? this.ragService.formatRagContext(results.combinedResults)
                : 'No context would be generated';

            this.logger.log(`RAG test query completed with ${results.combinedResults.length} results`);

            return {
                status: 'success',
                query: body.query,
                totalResults: results.combinedResults.length,
                s3Results: results.s3Results.length,
                postgresResults: results.postgresResults.length,
                formattedSources,
                contextPreview: formattedContext.substring(0, 500) + (formattedContext.length > 500 ? '...' : ''),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Error testing RAG query: ${error.message}`);
            throw new HttpException(
                `Error testing RAG query: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('test-embedding')
    async testEmbedding(@Body() body: { text: string }) {
        try {
            if (!body.text) {
                throw new HttpException(
                    'Text parameter is required',
                    HttpStatus.BAD_REQUEST,
                );
            }

            this.logger.log(`Testing embedding generation for text: "${body.text.substring(0, 50)}..."`);

            // Generate embedding
            const startTime = Date.now();
            const embedding = await this.vectorSearchService.generateEmbedding(body.text);
            const duration = Date.now() - startTime;

            if (!embedding || embedding.length === 0) {
                throw new HttpException(
                    'Failed to generate embedding',
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }

            this.logger.log(`Successfully generated embedding with ${embedding.length} dimensions in ${duration}ms`);

            return {
                status: 'success',
                inputText: body.text,
                embeddingDimensions: embedding.length,
                embeddingSample: embedding.slice(0, 5),
                processingTimeMs: duration,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Error generating embedding: ${error.message}`);
            throw new HttpException(
                `Error generating embedding: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Post('test-tool')
    async testTool(@Body() body: { toolName: string, params: any }) {
        try {
            if (!body.toolName) {
                throw new HttpException(
                    'Tool name is required',
                    HttpStatus.BAD_REQUEST,
                );
            }

            this.logger.log(`Testing tool: ${body.toolName}`);

            // Get the tool by name
            const tool = this.mcpClientService.getToolByName(body.toolName);

            if (!tool) {
                throw new HttpException(
                    `Tool ${body.toolName} not found`,
                    HttpStatus.NOT_FOUND,
                );
            }

            // Invoke the tool with provided parameters
            const startTime = Date.now();
            const result = await tool.invoke(body.params || {});
            const duration = Date.now() - startTime;

            this.logger.log(`Tool ${body.toolName} executed successfully in ${duration}ms`);

            return {
                status: 'success',
                toolName: body.toolName,
                params: body.params || {},
                result,
                processingTimeMs: duration,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.logger.error(`Error testing tool ${body.toolName}: ${error.message}`);
            throw new HttpException(
                `Error testing tool: ${error.message}`,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    @Get('health')
    async healthCheck() {
        return {
            status: 'up',
            service: 'rag',
            timestamp: new Date().toISOString()
        };
    }
}