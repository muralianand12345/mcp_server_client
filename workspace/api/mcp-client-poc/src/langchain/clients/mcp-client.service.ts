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
        const mcpServers = this.configService.get('app.mcp');
        this.client = new MultiServerMCPClient(mcpServers);
    }

    async onModuleDestroy() {
        if (this.client?.close) {
            await this.client.close();
        }
    }

    async getTools() {
        this.logger.log(this.tools)
        return await this.client.getTools();
    }
}