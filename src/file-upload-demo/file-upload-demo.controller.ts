import { Controller, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { FileUploadDemoService } from "./file-upload-demo.service";
import { SkipThrottle } from "@nestjs/throttler";

@SkipThrottle({ long: true, short: true})
@Controller('files')
export class FileUploadDemoController {
    constructor(
        private readonly fileService: FileUploadDemoService
    ){}

    @UseInterceptors(FileInterceptor('file',{
        storage: memoryStorage(),
        limits: {
            files:1,
            fileSize: 10 * 1024 * 1024
        }
    }))
    @Post('upload')
    async uploadFile(
        @UploadedFile() file: Express.Multer.File
    ){
          const fileUpload = await this.fileService.validate(file)
          return fileUpload;
    }
}