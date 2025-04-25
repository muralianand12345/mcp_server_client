import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

// Define interface for tool names
interface ToolNameVariants {
    [key: string]: string[];
}

// Define interface for tool categories
interface RequiredToolSets {
    s3: ToolNameVariants;
    postgres: ToolNameVariants;
}

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
    private client: MultiServerMCPClient;
    private tools: any[] = [];
    private readonly logger = new Logger(McpClientService.name);
    private isInitialized = false;
    private connectionMonitorInterval: NodeJS.Timeout | null = null;

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
        try {
            // Get MCP server configuration
            const mcpServers = this.configService.get('app.mcp');

            // Log all server endpoints for debugging
            Object.entries(mcpServers).forEach(([name, config]: [string, any]) => {
                this.logger.log(`MCP Server ${name}: ${config.url} (enabled: ${config.enabled})`);
            });

            // Create the client
            this.client = new MultiServerMCPClient(mcpServers);
            this.logger.log('MCP client instance created');

            // Connect with retry logic
            await this.connectWithRetry();

            // Start connection monitoring 
            this.startConnectionMonitoring();
        } catch (error) {
            this.logger.error(`Failed to initialize MCP client: ${error.message}`);
        }
    }

    async onModuleDestroy() {
        // Stop the connection monitoring
        if (this.connectionMonitorInterval) {
            clearInterval(this.connectionMonitorInterval);
            this.connectionMonitorInterval = null;
            this.logger.log('MCP connection monitoring stopped');
        }

        // Close the client connection
        if (this.client?.close) {
            try {
                await this.client.close();
                this.logger.log('MCP client closed successfully');
            } catch (error) {
                this.logger.error(`Error closing MCP client: ${error.message}`);
            }
        }
    }

    /**
     * Connect to MCP servers with retry logic
     */
    private async connectWithRetry(): Promise<void> {
        // Add retry logic with delay
        let attempts = 0;
        const maxAttempts = 15; // Increased retries
        const initialRetryDelay = 2000; // Start with 2 seconds
        let retryDelay = initialRetryDelay;

        while (attempts < maxAttempts && !this.isInitialized) {
            attempts++;
            this.logger.log(`Attempt ${attempts}/${maxAttempts} to get tools from MCP servers...`);

            try {
                // Get tools from both servers
                const tools = await this.client.getTools();

                if (tools && tools.length > 0) {
                    this.tools = tools;
                    this.isInitialized = true;

                    // Log available tools
                    this.logger.log(`Successfully loaded ${tools.length} tools:`);
                    const s3Tools = tools.filter(t => ['list_buckets', 'search_objects', 'get_object_content'].includes(t.name));
                    const pgTools = tools.filter(t => ['query', 'list_schemas', 'describe_table'].includes(t.name));

                    this.logger.log(`- S3 tools available: ${s3Tools.length}`);
                    this.logger.log(`- Postgres tools available: ${pgTools.length}`);

                    // Log all tool names
                    tools.forEach(tool => {
                        this.logger.log(`- ${tool.name}`);
                    });

                    break;
                } else {
                    this.logger.warn('No tools found, will retry after delay');
                }
            } catch (error) {
                this.logger.error(`Error getting tools (attempt ${attempts}): ${error.message}`);
                // Exponential backoff with jitter for retries (max 20 seconds)
                retryDelay = Math.min(retryDelay * 1.5, 20000);
                retryDelay += Math.random() * 1000; // Add jitter
            }

            // Wait before next attempt
            this.logger.log(`Waiting ${Math.round(retryDelay / 1000)} seconds before next attempt...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }

        if (!this.isInitialized) {
            this.logger.error(`Failed to initialize MCP client after ${maxAttempts} attempts`);
            throw new Error(`Failed to connect to MCP servers after ${maxAttempts} attempts`);
        }
    }

    /**
     * Start periodic connection monitoring
     */
    private startConnectionMonitoring(): void {
        // Check connection every 30 seconds
        this.connectionMonitorInterval = setInterval(async () => {
            if (!this.isInitialized || this.tools.length === 0) {
                this.logger.warn('Connection monitoring: MCP connection is down, attempting to reconnect...');
                await this.refreshTools();
            }
        }, 30000);

        this.logger.log('MCP connection monitoring started');
    }

    /**
     * Get all available tools
     */
    async getTools() {
        if (this.tools.length === 0) {
            this.logger.warn('No tools available, attempting to fetch again');
            await this.refreshTools();
        }

        return this.tools;
    }

    /**
     * Refresh the tools from the MCP servers
     */
    private async refreshTools(): Promise<void> {
        try {
            const tools = await this.client.getTools();
            if (tools && tools.length > 0) {
                this.tools = tools;
                this.isInitialized = true;
                this.logger.log(`Refreshed tools: ${tools.length} available`);
            } else {
                this.logger.warn('No tools returned from refresh attempt');
            }
        } catch (error) {
            this.logger.error(`Failed to refresh tools: ${error.message}`);
        }
    }

    /**
     * Helper method to check if specific tools are available
     */
    hasRequiredTools(): boolean {
        // Define required tool categories and possible names
        const requiredToolSets: RequiredToolSets = {
            s3: {
                listBuckets: ['list_buckets', 'mcp__s3__list_buckets', 'listbuckets'],
                searchObjects: ['search_objects', 'mcp__s3__search_objects', 'searchobjects'],
                getObjectContent: ['get_object_content', 'mcp__s3__get_object_content', 'getobjectcontent']
            },
            postgres: {
                query: ['query', 'mcp__postgres__query', 'execute_query', 'sql'],
                listSchemas: ['list_schemas', 'mcp__postgres__list_schemas', 'listschemas'],
                describeTable: ['describe_table', 'mcp__postgres__describe_table', 'describetable']
            }
        };

        const availableToolNames = this.tools.map(tool => tool.name.toLowerCase());

        // Check for S3 tools
        const missingS3Tools: string[] = [];
        Object.entries(requiredToolSets.s3).forEach(([key, nameVariants]) => {
            if (!nameVariants.some(variant => availableToolNames.some(name => name.includes(variant.toLowerCase())))) {
                missingS3Tools.push(key);
            }
        });

        // Check for Postgres tools
        const missingPgTools: string[] = [];
        Object.entries(requiredToolSets.postgres).forEach(([key, nameVariants]) => {
            if (!nameVariants.some(variant => availableToolNames.some(name => name.includes(variant.toLowerCase())))) {
                missingPgTools.push(key);
            }
        });

        if (missingS3Tools.length > 0) {
            this.logger.warn(`Missing S3 tools: ${missingS3Tools.join(', ')}`);
        }

        if (missingPgTools.length > 0) {
            this.logger.warn(`Missing Postgres tools: ${missingPgTools.join(', ')}`);
        }

        return missingS3Tools.length === 0 && missingPgTools.length === 0;
    }

    /**
     * Get a specific tool by name
     */
    getToolByName(name: string) {
        // Try with exact name first
        let tool = this.tools.find(tool => tool.name === name);

        // If not found, try with mcp prefixes or more flexible matching
        if (!tool) {
            // Check for prefixed versions (e.g., mcp__s3__list_buckets)
            tool = this.tools.find(tool =>
                tool.name === `mcp__s3__${name}` ||
                tool.name === `mcp__postgres__${name}`);

            // If still not found, try more flexible matching
            if (!tool && name) {
                // For common tool names, try partial matching
                const normalizedName = name.toLowerCase();

                if (normalizedName.includes('bucket')) {
                    tool = this.tools.find(t =>
                        t.name.toLowerCase().includes('bucket') ||
                        t.name.toLowerCase().includes('list'));
                } else if (normalizedName.includes('query')) {
                    tool = this.tools.find(t =>
                        t.name.toLowerCase().includes('query') ||
                        t.name.toLowerCase().includes('sql'));
                } else if (normalizedName.includes('object')) {
                    tool = this.tools.find(t =>
                        t.name.toLowerCase().includes('object') ||
                        t.name.toLowerCase().includes('content'));
                }

                if (tool) {
                    this.logger.log(`Found tool "${tool.name}" using flexible matching for "${name}"`);
                }
            }
        }

        return tool;
    }

    /**
     * Get diagnostic information about the MCP client
     */
    getDiagnostics() {
        const s3Tools = this.tools.filter(t =>
            ['list_buckets', 'search_objects', 'get_object_content'].includes(t.name)
        );

        const pgTools = this.tools.filter(t =>
            ['query', 'list_schemas', 'describe_table'].includes(t.name)
        );

        return {
            status: this.isInitialized ? 'connected' : 'disconnected',
            totalTools: this.tools.length,
            s3ToolsAvailable: s3Tools.length,
            pgToolsAvailable: pgTools.length,
            hasAllRequiredTools: this.hasRequiredTools(),
            allToolNames: this.tools.map(t => t.name)
        };
    }
}