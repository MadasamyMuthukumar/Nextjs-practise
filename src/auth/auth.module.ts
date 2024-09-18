import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategy';

@Module({
    imports:[JwtModule.register({})],  //registering the jwt module so that it services can be accessible
    controllers: [AuthController],
    providers: [AuthService, JwtStrategy],
})

export class AuthModule {}
