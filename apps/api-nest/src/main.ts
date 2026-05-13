import './telemetry'; // Must be first — starts OTel SDK before any NestJS module loads
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

function openApiEnabled(): boolean {
  const v = process.env.OPENAPI_ENABLED;
  if (v == null || String(v).trim() === '') return false;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  if (openApiEnabled()) {
    const config = new DocumentBuilder()
      .setTitle('Vahan360 API')
      .setDescription(
        'Nest control-plane: health, control status, ingest/system reads. With Express `API_V2_PROXY_ENABLED`, callers may use `/api/v2/*` (path rewritten to these routes).',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  const raw = process.env.NEST_API_PORT ?? '4000';
  const port = Number.parseInt(raw, 10);
  const listenPort = Number.isFinite(port) ? port : 4000;
  await app.listen(listenPort);
  if (openApiEnabled()) {
    logger.log(`OpenAPI: http://0.0.0.0:${listenPort}/docs`);
  }
}

void bootstrap();
