import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, MaxLength, MinLength, IsUrl } from "class-validator"


export class CreateUrlDto {
    //require_protocol so express res.redirect() gets an absolute url, not a relative one
    @IsUrl({ require_protocol: true }, { message: 'longUrl must include http:// or https://' })
    @IsNotEmpty()
    longUrl: string

    @IsString()
    @MinLength(3)
    @MaxLength(32)
    @Matches(/^[A-Za-z0-9_-]+$/, { message: 'customAlias may only contain letters, numbers, - and _' })
    @IsOptional()
    customAlias?: string

    //optional ttl - when omitted the link never expires
    @IsInt()
    @Min(1)
    @IsOptional()
    expiresInMinutes?: number
}
