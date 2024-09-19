import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  //providing global validation pipe so that the class validators will work
  app.useGlobalPipes(new ValidationPipe({
    whitelist:true  //will stirp out the data from req that are not defined in dto
  }))
  // app.setGlobalPrefix('/api') // /api will be the global prefix for all apis
  app.enableCors() //everyone can access this api

  // app.enableCors({
  //   origin: 'https://example.com', // Only allow this origin
  //   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Allowed methods
  //   allowedHeaders: 'Content-Type, Authorization', // Allowed headers
  //   credentials: true, // Allow credentials
  // });
  await app.listen(3000);
}
bootstrap();


/**
 *  dynamically allowing origins based on incoming requests, 
 * you can use a function for the origin option. 
 * This function receives the request's origin and can conditionally allow or deny it.
 */

// app.enableCors({
//   origin: (origin, callback) => {
//     const allowedOrigins = ['https://example1.com', 'https://example2.com', 'https://example3.com'];
//     if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
//       // Allow the request if the origin is in the allowed list or if there's no origin (e.g., in server-to-server requests)
//       callback(null, true);
//     } else {
//       // Deny the request
//       callback(new Error('Not allowed by CORS'));
//     }
//   },
//   methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
//   allowedHeaders: 'Content-Type, Authorization',
//   credentials: true,
// });
