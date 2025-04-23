import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiModule } from './api/api.module';
import { LangchainModule } from './langchain/langchain.module';
import envConfig from './config/env.config';

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            load: [envConfig],
        }),
        ApiModule,
        LangchainModule,
    ],
})
export class AppModule { }