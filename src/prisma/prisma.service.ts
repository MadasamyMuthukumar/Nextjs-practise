import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
//prisma client allows to connect with db, and has all methods
export class PrismaService extends PrismaClient {
    constructor(config: ConfigService){
        // calling the constructor of  prismaClient(need to pass db url)
        super({
            datasources:{
                db:{
                    url:config.get('DATABASE_URL')
                }
            }
        })
    }

}
