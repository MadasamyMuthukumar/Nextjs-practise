import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { User } from '@prisma/client';
import { Request } from 'express';
import { GetUser } from 'src/auth/decorators';
import { JwtGaurd } from 'src/auth/gaurds';
import { EditUserDto } from './dto';
import { UserService } from './user.service';

// @UseGuards(AuthGuard('jwt'))  //using jwt guard strategy
@UseGuards(JwtGaurd) //everything in userController requires valid token
@Controller('users')
export class UserController {
    constructor(private userService: UserService) { }

    @Get('me')  //getting current user
    // getUser(@Req() req: Request){
    getUser(@GetUser('id') id: number, @GetUser() user: User) { //the type User is coming from prisma clinet, it generates type for schemas
        /**What ever the value the valdidate fn returns that will be append to
         * the req object, we can access it
        */
        // console.log(req.user);

        // return id
        return user
    }

    @Patch('edit')
    editUser(@GetUser('id') id: number,@Body() dto:EditUserDto){
        /**getting id from the validated token result object and 
         * updating that user data
        */
       console.log(dto);
       
       return this.userService.editUser(id,dto)

    }

}

/**
 *(@Req() req: Request) we are not supposed to use req object of express directly 
 we can create custom decorator to get user object
 */