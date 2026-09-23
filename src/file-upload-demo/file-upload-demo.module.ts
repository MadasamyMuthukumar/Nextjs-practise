import { Module } from "@nestjs/common";
import { FileUploadDemoController } from "./file-upload-demo.controller";
import { FileUploadDemoService } from "./file-upload-demo.service";


@Module({
    imports: [],
    controllers: [FileUploadDemoController],
    providers: [FileUploadDemoService]
})


export class FileUploadDemoModule {}
