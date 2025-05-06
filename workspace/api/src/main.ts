import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from './config/config.service';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // Enable CORS
    app.enableCors();

    // Use validation pipe for DTO validation
    app.useGlobalPipes(new ValidationPipe());

    // Get configuration
    const configService = app.get(ConfigService);
    const port = configService.port;

    await app.listen(port);
    console.log(`Application is running on: http://localhost:${port}`);
}

bootstrap();