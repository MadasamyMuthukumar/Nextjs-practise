import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { BookmarkModule } from './bookmark/bookmark.module';
import { PrismaModule } from './prisma/prisma.module';
import { ConfigModule } from '@nestjs/config';
import { ServiceController } from './service/service.controller';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ListenerModule } from './listener/listener.module';
@Module({
  imports: [ConfigModule.forRoot({
    isGlobal:true //making cofigService globally available 
  }), //this will add our env file to all our application
     AuthModule, UserModule, BookmarkModule, PrismaModule,
     //we are defining two limits here short & long
    ThrottlerModule.forRoot([
      {
        name:'long',
      ttl:60000,
      limit:3  //limiting 3 request per minute
    },
    {
      name:'short',
      ttl:1000,
      limit:2
    }
  ]) , EventEmitterModule.forRoot() , ScheduleModule.forRoot(), ListenerModule], 
  controllers: [AppController, ServiceController],

  providers: [AppService,{
    provide:APP_GUARD,   //providing rate limiting to all our controller routes
    useClass:ThrottlerGuard
  }],
})
export class AppModule {}
