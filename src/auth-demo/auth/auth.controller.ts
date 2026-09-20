import { Body, Controller, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SkipThrottle } from "@nestjs/throttler";



@SkipThrottle({ long: true, short: true })  //must name both throttlers - bare SkipThrottle() targets 'default', which this app does not register
@Controller('auth')
export class AuthController {

    constructor(
        private readonly authservice: AuthService
    ){}

    @Post('login')
    async login(@Body() body: {email: string, password: string}){
        return this.authservice.login(body.email, body.password)
    }
}