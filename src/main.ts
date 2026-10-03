import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { parseTrustProxy } from './common/utils/trust-proxy';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));

  // Real client IP for Nafath X-Forwarded-For, throttling and the callback IP allow-list.
  // TRUST_PROXY: number of proxies in front of the app ("1") or a comma-separated list of
  // proxy IPs/CIDRs. "true" is rejected: it trusts the client-controlled X-Forwarded-For.
  const trustProxy = parseTrustProxy(process.env['TRUST_PROXY']);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
    Logger.log(`trust proxy = ${trustProxy}`, 'Bootstrap');
  }

  // Security
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.enableCors({ origin: '*' });

  // Global prefix
  app.setGlobalPrefix('api/v1');

  // Global pipes, interceptors, filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Aqar API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env['PORT'] ?? 3000;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}/api/v1`);
  console.log(`📄 Swagger docs at http://localhost:${port}/api/docs`);
}

void bootstrap();
