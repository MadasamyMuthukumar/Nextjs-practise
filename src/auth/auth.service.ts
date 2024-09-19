import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import { AuthDto } from "./dto";
import * as argon from 'argon2'
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";



//This service will handle two functionalitiess login and signup
@Injectable()
export class AuthService {
    constructor(private prisma: PrismaService, private jwt: JwtService,private config : ConfigService) { }
    //It will store the bussinenss logic for login & singup
    async signin(dto:AuthDto) {
        //check user exists 
        const user = await this.prisma.user.findFirst({
            where: {
                email: dto.email,
            },
        });

        if(!user) throw new ForbiddenException('No user available with this email!')

         const pwMatches =await argon.verify(user.hash , dto.password)

         console.log(pwMatches)
        if(!pwMatches)  throw new ForbiddenException('Password or Email mismatches!')
        // delete user.hash

        // return user

        return this.signToken(user.id , user.email)
    }
    async signup(dto: AuthDto) {
        //generate hash
        const hash = await argon.hash(dto.password)
        //create new user
        try{
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                hash,
            }, //selecting the only fields we want
            // select: {
            //     id: true,
            //     email: true,
            // }
        })
        //retur the created user
        // delete user.hash //deleting the password detail from returned created new user from response not from db
        // return user

        return this.signToken(user.id , user.email)
    }catch(error){
        /**if error is coming from prismaClient error -> if error code p2002(means try to create new record with uniq fields)  */
        if(error instanceof PrismaClientKnownRequestError){
            if(error.code=='P2002'){
                throw new ForbiddenException('Credentials already available!')
            }
        }else{ //or else throw error
            throw error
        }
    }

    }

    //create tokens based on user id & email
    async signToken(userId:number , email:string) : Promise<{access_token: string}>{
        const payload = {
            sub:userId,  //sub-> jwt convention of providing unique field
            email:email
        }
        /**
         * 1st arg-> payload will be user data 
         * 2nd arg -> secrete information attached along with token, only us know that info 
         */
        const token =await this.jwt.signAsync(payload,{
            expiresIn:'15m',
            secret: this.config.get('JWT_SECRET')
        })

        return {
            access_token: token
        }

    }

}