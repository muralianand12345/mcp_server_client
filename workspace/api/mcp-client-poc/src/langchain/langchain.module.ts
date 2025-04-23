import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReactAgentService } from './agents/react-agent.service';
import { McpClientService } from './clients/mcp-client.service';

@Module({
    imports: [ConfigModule],
    providers: [ReactAgentService, McpClientService],
    exports: [ReactAgentService, McpClientService],
})

export class LangchainModule { }