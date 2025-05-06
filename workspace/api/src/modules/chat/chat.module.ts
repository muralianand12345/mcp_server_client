import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RagModule } from '../rag/rag.module';
import { AgentModule } from '../agent/agent.module';
import { ToolAgentModule } from '../tool-agent/tool-agent.module';
import { ConfigModule } from '../../config/config.module';

@Module({
    imports: [RagModule, AgentModule, ToolAgentModule, ConfigModule],
    controllers: [ChatController],
    providers: [ChatService],
    exports: [ChatService],
})
export class ChatModule { }