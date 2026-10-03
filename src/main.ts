import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new IoAdapter(app));

  // Real client IP for Nafath X-Forwarded-For, throttling and the callback IP allow-list.
  // TRUST_PROXY: hop count ("1"), "true", or a comma-separated list of proxy IPs/CIDRs.
  const trustProxy = process.env['TRUST_PROXY'];
  if (trustProxy) {
    app.set(
      'trust proxy',
      /^\d+$/.test(trustProxy)
        ? Number(trustProxy)
        : trustProxy === 'true'
          ? true
          : trustProxy,
    );
  }

  // Security
  app.use( helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),);
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
