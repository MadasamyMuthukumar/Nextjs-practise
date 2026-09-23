import { Body, Controller, Get, Param, Post, Res } from "@nestjs/common";
import { UrlShortnerDemoService } from "./url-shortner-demo.service";
import { Response } from 'express'


@Controller('url')
export class UrlShortnerController {
    constructor(
        private readonly urlshorterService : UrlShortnerDemoService
    ){}


    @Post('create')
    async creatUrl(@Body() data: any){
        return this.urlshorterService.createUrl(data)
    }


    @Get(':shortcode')
    async redirect(
        @Param('shortcode') code: string,
        @Res() res: Response
    ){
        const url = await this.urlshorterService.redirect(code)
        return res.redirect(302, url)

    }
}