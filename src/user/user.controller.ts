import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';

@Controller('users')
export class UserController {
    constructor(){}

    @UseGuards(AuthGuard('jwt'))  //using jwt guard strategy
    @Get('me')  //getting current user
    getUser(@Req() req: Request){
        /**What ever the value the valdidate fn returns that will be append to
         * the req object, we can access it
        */
        console.log(req.user);
        
        return req.user
    }
}
