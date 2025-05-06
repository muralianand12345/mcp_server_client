import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { OpenAIService } from '../../shared/openai/openai.service';
import { ConfigService } from '../../config/config.service';
import { ConfigModule } from '../../config/config.module';

@Module({
    providers: [AgentService, OpenAIService, ConfigService],
    exports: [AgentService],
    imports: [ConfigModule],
})
export class AgentModule { }