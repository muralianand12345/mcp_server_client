import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule, {
        logger: new ConsoleLogger({
            prefix: 'MCP API',
        }),
    });

    // Apply validation globally
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,
        transform: true,
    }));

    const configService = app.get(ConfigService);
    const port = configService.get('app.port');

    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();