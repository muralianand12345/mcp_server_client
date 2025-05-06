import { Injectable } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
    constructor(private configService: NestConfigService) { }

    get openaiApiKey(): string {
        return this.configService.get<string>('OPENAI_API_KEY') || "";
    }

    get s3BucketName(): string {
        return this.configService.get<string>('S3_BUCKET_NAME') || 'xyz-support-images';
    }

    get databaseUrl(): string {
        return this.configService.get<string>('DATABASE_URL') ||
            'postgresql://neondb_owner:npg_O32abLFEITNG@ep-bold-dawn-a1ru8bmh-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
    }

    get mcpS3Url(): string {
        return this.configService.get<string>('MCP_S3_URL') || 'http://localhost:8001/sse';
    }

    get mcpPostgresUrl(): string {
        return this.configService.get<string>('MCP_POSTGRES_URL') || 'http://localhost:8002/sse';
    }

    get port(): number {
        return parseInt(this.configService.get<string>('PORT') || '3000', 10);
    }
}