import { Body, Controller, Delete, Get, Param, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard";
import { RoleGaurd } from "../auth/role.guard";
import { Roles } from "../auth/role.decorator";
import { ROLES } from "./roles.type";
import { SkipThrottle } from "@nestjs/throttler";



@SkipThrottle({ long: true, short: true })  //must name both throttlers - bare SkipThrottle() targets 'default', which this app does not register
@Controller('users')
export class USersController {

    @UseGuards(AuthGuard)
    @Get()
    async getProfile(
        @Req() req: any
    ){
        return {
           user: req.user
        }  
    }


    @UseGuards(AuthGuard, RoleGaurd)
    @Roles(ROLES.ADMIN)
    @Delete(':id')
    async deleteUser(@Param('id') id: string){
         
     return {
        message: `deleted ${id}`
     }
    }
}