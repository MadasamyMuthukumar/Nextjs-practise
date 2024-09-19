import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthDto } from "./dto";

@Controller('auth')  //common route
export class AuthController {
    //dependency injection of AuthService
    constructor(private authService: AuthService) { }

    //routes for auth/sigin
    @HttpCode(HttpStatus.OK)
    /**While sigin we are not going to creating anythin in db. 
     * so by using httpcode changing the stauts code to 201(since we are uing post req)->200
    */
    @Post('signin')
    // signin(@Body('email') email:String, @Body('password', ParseIntPipe) password: String)
    signin(@Body() dto: AuthDto) {   //taking the  body from the request (dto->data transfer object)
        return this.authService.signin(dto) //nest js will handle any datatype
        // return {msg:"dfsdfsd"}
    }
    //routes for auth/signup
    @Post('signup')
    signup(@Body() dto: AuthDto) {
        return this.authService.signup(dto)
    }
}