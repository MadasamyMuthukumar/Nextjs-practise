import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "src/prisma/prisma.service";
/**
 * Here we will intercept the token the user passes to us
 * validate it(expiration & secret key)
 * then only allow  the users want to do
 * It also a provide like auth.services so that we can use Injectable
 * and also mention in providers in auth.module
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt'){ //unique name of this guard
    constructor(private config: ConfigService, private prisma: PrismaService){
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey:config.get('JWT_SECRET') 
        })
    }

    //get the information of the user using bearer token
    // validate(payload: any){
    //     //here our token will transform into object {sub: 1, email:'sdd', exp:''} and we can acces as payload inside validate fn
    //     console.log(payload);
    //     // return 'hii'
    //     return payload
    // }

    //get the information of the user and return it back
    async validate(payload:{sub:number , email:string}){
        //taking user object directly from the db
        const user = await this.prisma.user.findUnique({
            where:{
                id:payload.sub
            }
        })
        // return null //going to throw 401 error(means user not found)
        delete user.hash
        return user

    }
}