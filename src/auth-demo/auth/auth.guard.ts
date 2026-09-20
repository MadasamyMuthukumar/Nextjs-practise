import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Observable } from "rxjs";



@Injectable()
export class AuthGuard implements CanActivate {

    constructor(
        private readonly jwtService: JwtService
    ){}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        
        const request = context.switchToHttp().getRequest()

        const authHeader = request.headers.authorization

        if(!authHeader) throw new UnauthorizedException()

        const [type, token] = authHeader.split(' ')

        if(type !='Bearer' || !token) throw new UnauthorizedException()

        try {
            const payload = await this.jwtService.verifyAsync(token)
            request.user = payload
            return true
        }catch{
            // return false
            throw new UnauthorizedException()
        }
    }
}