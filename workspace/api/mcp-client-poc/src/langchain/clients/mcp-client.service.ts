import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
    private client: MultiServerMCPClient;
    private tools: any[] = [];
    private readonly logger = new Logger(McpClientService.name);
    private isInitialized = false;

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
        try {
            // Get MCP server configuration
            const mcpServers = this.configService.get('app.mcp');
            this.logger.log(`Initializing MCP client with servers: ${JSON.stringify(mcpServers)}`);

            // Create the client
            this.client = new MultiServerMCPClient(mcpServers);

            // Add retry logic with delay
            let attempts = 0;
            const maxAttempts = 10; // Increased from 5
            const retryDelay = 5000; // 5 seconds

            while (attempts < maxAttempts && !this.isInitialized) {
                attempts++;
                this.logger.log(`Attempt ${attempts}/${maxAttempts} to get tools from MCP servers`);

                try {
                    // Get tools from both servers
                    const tools = await this.client.getTools();

                    if (tools && tools.length > 0) {
                        this.tools = tools;
                        this.isInitialized = true;

                        // Log available tools
                        this.logger.log(`Successfully loaded ${tools.length} tools:`);
                        tools.forEach(tool => {
                            this.logger.log(`- ${tool.name}: ${tool.description}`);
                        });

                        break;
                    } else {
                        this.logger.warn('No tools found, will retry after delay');
                    }
                } catch (error) {
                    this.logger.error(`Error getting tools (attempt ${attempts}): ${error.message}`);
                }

                // Wait before next attempt
                this.logger.log(`Waiting ${retryDelay / 1000} seconds before next attempt...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }

            if (!this.isInitialized) {
                this.logger.error(`Failed to initialize MCP client after ${maxAttempts} attempts`);
            }
        } catch (error) {
            this.logger.error(`Failed to initialize MCP client: ${error.message}`);
        }
    }

    async onModuleDestroy() {
        if (this.client?.close) {
            try {
                await this.client.close();
                this.logger.log('MCP client closed successfully');
            } catch (error) {
                this.logger.error(`Error closing MCP client: ${error.message}`);
            }
        }
    }

    async getTools() {
        if (this.tools.length === 0) {
            this.logger.warn('No tools available, attempting to fetch again');
            try {
                const tools = await this.client.getTools();
                if (tools && tools.length > 0) {
                    this.tools = tools;
                    this.logger.log(`Refreshed tools: ${tools.length} available`);
                }
            } catch (error) {
                this.logger.error(`Failed to refresh tools: ${error.message}`);
            }
        }

        if (this.tools.length === 0) {
            this.logger.warn('Still no tools available after refresh attempt');
        }

        return this.tools;
    }

    // Helper method to check if specific tools are available
    hasRequiredTools(): boolean {
        const requiredS3Tools = ['list_buckets', 'search_objects', 'get_object_content'];
        const requiredPgTools = ['query', 'list_schemas', 'describe_table'];

        const availableToolNames = this.tools.map(tool => tool.name);

        const missingS3Tools = requiredS3Tools.filter(tool => !availableToolNames.includes(tool));
        const missingPgTools = requiredPgTools.filter(tool => !availableToolNames.includes(tool));

        if (missingS3Tools.length > 0) {
            this.logger.warn(`Missing S3 tools: ${missingS3Tools.join(', ')}`);
        }

        if (missingPgTools.length > 0) {
            this.logger.warn(`Missing Postgres tools: ${missingPgTools.join(', ')}`);
        }

        return missingS3Tools.length === 0 && missingPgTools.length === 0;
    }
}