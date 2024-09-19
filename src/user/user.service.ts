import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EditUserDto } from './dto';

@Injectable()
export class UserService {

    constructor(private prisma:PrismaService){}

    async editUser(id:number, dto:EditUserDto){
        //taking id and deleting
        const user = await this.prisma.user.update({
            where:{
                id,
            },
            data:{
                ...dto
            }
        })

        delete user.hash
        return user

    }
}
