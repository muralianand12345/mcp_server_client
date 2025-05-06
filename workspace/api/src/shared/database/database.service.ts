import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { ConfigService } from '../../config/config.service';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
    private pool: Pool;

    constructor(private configService: ConfigService) {
        this.pool = new Pool({
            connectionString: this.configService.databaseUrl,
        });
    }

    async getClient(): Promise<PoolClient> {
        return this.pool.connect();
    }

    async query(text: string, params?: any[]): Promise<any> {
        try {
            const result = await this.pool.query(text, params);
            return result;
        } catch (error) {
            throw new Error(`Database query error: ${error.message}`);
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.pool.end();
    }
}