import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  //providing global validation pipe so that the class validators will work
  app.useGlobalPipes(new ValidationPipe({
    whitelist:true  //will stirp out the data from req that are not defined in dto
  }))
  await app.listen(3000);
}
bootstrap();
