import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { USersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  imports: [
    //registering jwt with the secret from .env (ConfigModule is global in AppModule)
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
    }),
  ],
  //controllers must be listed here, otherwise nest never maps their routes
  controllers: [AuthController, USersController],
  //AuthGuard & RoleGaurd are not listed -> @UseGuards instantiates them
  //from this module's injector (JwtService comes from JwtModule above)
  providers: [AuthService, UsersService],
})
export class AuthDemoModule {}
