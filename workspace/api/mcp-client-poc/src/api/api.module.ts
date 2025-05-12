import { Module } from '@nestjs/common';
import { ChatModule } from './chat/chat.module';
import { RagDiagnosticsModule } from './rag-diagnostics/rag-diagnostics.module';

@Module({
    imports: [ChatModule, RagDiagnosticsModule],
})
export class ApiModule { }