import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UsersService } from "../users/users.service";
import * as bcrypt from 'bcrypt'


@Injectable()
export class AuthService {

    constructor(
        private readonly jwtService: JwtService,
        private readonly usersService: UsersService
    ){}

    

    async login(email, password){
        const user = this.usersService.findByEmail(email)

        if(!user) throw new UnauthorizedException()

        const isPasswordMatch = await bcrypt.compare(password, user.password)

        if(!isPasswordMatch) throw new UnauthorizedException()

        const payload = {
            sub: user.id,
            email: user.email,
            role: user.role
        }

        const accessToken = await this.jwtService.signAsync(payload)

        return {
            access_token : accessToken
        }


    }
}