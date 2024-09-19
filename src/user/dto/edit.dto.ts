import { IsEmail, IsEnum, IsOptional, IsString } from "class-validator"

export class EditUserDto {
    //all fields are optional so that any one of field can be updated
    @IsEmail()
    @IsOptional()
    email?:string

    @IsString()
    @IsOptional()
    firstName?:string

    @IsString()
    @IsOptional()
    lastName?:string

    // @IsEnum(['Intern','Student','Teacher'],{
    //     message:"valid role required!"
    // })
    // role:'Intern' | 'Student' | 'Teacher'
}