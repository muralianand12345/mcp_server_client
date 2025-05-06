import { Module } from '@nestjs/common';
import { RagService } from './rag.service';
import { DatabaseService } from '../../shared/database/database.service';
import { OpenAIService } from '../../shared/openai/openai.service';
import { ConfigService } from '../../config/config.service';
import { ConfigModule } from '../../config/config.module';

@Module({
    providers: [RagService, DatabaseService, OpenAIService, ConfigService],
    exports: [RagService],
    imports: [ConfigModule],
})
export class RagModule { }