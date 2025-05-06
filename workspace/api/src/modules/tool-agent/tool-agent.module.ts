import { Module } from '@nestjs/common';
import { ToolAgentService } from './tool-agent.service';
import { OpenAIService } from '../../shared/openai/openai.service';
import { ConfigService } from '../../config/config.service';
import { ConfigModule } from '../../config/config.module';

@Module({
    providers: [ToolAgentService, OpenAIService, ConfigService],
    exports: [ToolAgentService],
    imports: [ConfigModule],
})
export class ToolAgentModule { }