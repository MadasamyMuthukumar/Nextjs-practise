import { ArrayNotEmpty, IsArray, IsEmail, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"


export class CreateGroupPostDto{
    @IsString()
    @IsNotEmpty()
    title:string

    @IsString()
    description:string

    @IsNumber({},{each: true}) //each true will check for each element in an array
    @IsNotEmpty({each:true})
    @IsArray()
    @ArrayNotEmpty()
    userIds: number[]
}