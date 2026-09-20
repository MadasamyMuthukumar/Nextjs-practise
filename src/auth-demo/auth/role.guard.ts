import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { ROLE_KEY } from "./role.decorator";



@Injectable()
export class RoleGaurd implements CanActivate {

    constructor(
        private readonly reflector: Reflector
    ){}
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredRoles = this.reflector.getAllAndOverride(ROLE_KEY, [ context.getHandler(), context.getClass() ])

        if(!requiredRoles) return true

        const user = context.switchToHttp().getRequest()?.user

        if(!user) throw new ForbiddenException()

        const isValid = requiredRoles.includes(user.role)

        if(!isValid) throw new ForbiddenException()

        return true
    }
}