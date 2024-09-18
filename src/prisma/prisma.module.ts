import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

//This module used for db connections
@Global()  //by making it global, prisma service is available for all the modules in our app
            //in otherwords exporting prisma service to all modules
@Module({
  providers: [PrismaService],
  exports: [PrismaService]   //exporting prisma service so that other module can import and use this service
})
export class PrismaModule {}
