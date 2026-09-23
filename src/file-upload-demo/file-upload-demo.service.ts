/// <reference types="multer" />
import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "crypto";
import { fromBuffer } from "file-type";
import * as path from "path";


@Injectable()
export class FileUploadDemoService {

    private readonly allowedTypes: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.pdf': 'application/pdf'
    }

    async validate(file: Express.Multer.File) {

        if (!file) throw new BadRequestException()

        const safename = path.posix.basename(
            path.win32.basename(file.originalname)
        )

        const extension = path.extname(safename).toLowerCase()

        const expectedType = this.allowedTypes[extension]

        if (!expectedType || file.mimetype != expectedType) throw new BadRequestException()

        const detected = await fromBuffer(file.buffer)

        if (!detected || detected.mime !== expectedType) throw new BadRequestException()

        const hash = createHash('sha256').update(file.buffer).digest('hex')

        return {
            ok: "success",
            filename: safename,
            mime: detected.mime,
            ext: detected.ext,
            hash
        }


    }
}
