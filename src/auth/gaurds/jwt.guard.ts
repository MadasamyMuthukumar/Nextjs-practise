import { AuthGuard } from "@nestjs/passport";

//Creating separate file instead of directly using UseGaurd(AuthGaurd('jwt))
//now we can use UseGaurd(JwtGaurd)
export class JwtGaurd extends AuthGuard('jwt'){
    constructor(){
        super()
    }
}