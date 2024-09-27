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


    async getUser(){
        // return await this.prisma.user.findMany({ include:{ UserSetting:true}}) or
                        // {
                        //     userSetting:{
                        //         select:{
                        //             smsEnabled:true
                        //         }
                        //     }
                        // }
        //this will incldue the userSettings details as well along with user feilds
    }
}
