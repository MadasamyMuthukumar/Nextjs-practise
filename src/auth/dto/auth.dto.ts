import { IsEmail, IsNotEmpty, IsString } from "class-validator"

/**defining the type of data from the request , since we are using class validation and
 * transformers we have to declare types as class not interface or type */ 
export class AuthDto {
    @IsEmail()
    @IsNotEmpty()
    email:string;

    @IsString()
    @IsNotEmpty()
    password: string;
}