import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReactAgentService } from './agents/react-agent.service';
import { McpClientService } from './clients/mcp-client.service';
import { RagService } from './services/rag.service';
import { ChatStorageService } from './services/chat-storage.service';
import { VectorSearchService } from './services/vector-search.service';

@Module({
    imports: [ConfigModule],
    providers: [
        ReactAgentService,
        McpClientService,
        RagService,
        ChatStorageService,
        VectorSearchService
    ],
    exports: [
        ReactAgentService,
        McpClientService,
        RagService,
        ChatStorageService,
        VectorSearchService
    ],
})

export class LangchainModule { }