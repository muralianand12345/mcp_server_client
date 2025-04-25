import { Module } from '@nestjs/common';
import { RagDiagnosticsController } from './rag-diagnostics.controller';
import { LangchainModule } from '../../langchain/langchain.module';

@Module({
    imports: [LangchainModule],
    controllers: [RagDiagnosticsController],
})
export class RagDiagnosticsModule { }