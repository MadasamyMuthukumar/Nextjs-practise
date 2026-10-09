import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomInt } from "crypto";

interface Paste {
    shorCode: string
    content: string,
    expiredAt: Date | null
    createdAt: Date | null
}


@Injectable()
export class PastebinService {

    private paste = new Map<string, Paste>()
    private randomCode = 'AasdfghjkASDFGHJWERTYUIOZXCVBNMsdfghjkQwertyuioSDFGH12345678'
    constructor() { }


    createPaste(paste: Paste) {

        if (paste.content.length > 1_000_000)
            throw new BadRequestException()

        let shortCode = this.generateCode()

        while (this.paste.has(shortCode)) {
            shortCode = this.generateCode()
        }

        this.paste.set(shortCode, paste)

        return {
            code: shortCode,
            paste: paste
        }

    }

    async getPaste(shortcode: string) {
        const paste = this.paste.get(shortcode);

        if (!paste) {
            throw new NotFoundException('Paste not found');
        }

        if (paste.expiredAt && paste.expiredAt <= new Date()) {
            this.paste.delete(shortcode);
            throw new NotFoundException('Paste expired');
        }

        return paste;
    }


    private generateCode() {
        let code = ''

        for (let i = 0; i < 8; i++) {
            code += this.randomCode[
                randomInt(0, this.randomCode.length)
            ]
        }

        return code
    }
}