import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { ChatModule } from './modules/chat/chat.module';

@Module({
    imports: [
        ConfigModule,
        ChatModule
    ],
})
export class AppModule { }