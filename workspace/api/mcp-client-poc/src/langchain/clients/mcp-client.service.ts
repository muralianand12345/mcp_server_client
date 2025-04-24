import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

@Injectable()
export class McpClientService implements OnModuleInit, OnModuleDestroy {
    private client: MultiServerMCPClient;
    private tools: any[] = [];
    private readonly logger = new Logger(McpClientService.name);

    constructor(private configService: ConfigService) { }

    async onModuleInit() {
        try {
            const mcpServers = this.configService.get('app.mcp');
            this.client = new MultiServerMCPClient(mcpServers);
            // Add retry logic with delay
            let attempts = 0;
            const maxAttempts = 5;

            while (attempts < maxAttempts) {
                try {
                    const tools = await this.client.getTools();

                    if (tools && tools.length > 0) {
                        this.tools = tools;
                        break;
                    } else {
                        this.logger.warn('No tools found, will retry after delay');
                    }
                } catch (error) {
                    this.logger.error(`Error getting tools: ${error.message}`);
                }

                attempts++;
                // Wait 5 seconds before next attempt
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } catch (error) {
            this.logger.error(`Failed to initialize MCP client: ${error.message}`);
        }
    }

    async onModuleDestroy() {
        if (this.client?.close) {
            await this.client.close();
        }
    }

    async getTools() {
        if (this.tools.length === 0) {
            this.logger.warn('No tools available, attempting to fetch again');
            try {
                const tools = await this.client.getTools();
                if (tools && tools.length > 0) {
                    this.tools = tools;
                }
            } catch (error) {
                this.logger.error(`Failed to refresh tools: ${error.message}`);
            }
        }
        return this.tools.length > 0 ? this.tools : await this.client.getTools();
    }
}