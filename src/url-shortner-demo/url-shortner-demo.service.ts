import { BadRequestException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { Url, UrlShortnerDemoRepoService } from "./url-shortner-demo-repo.service";
import { CreateUrlDto } from "./dto/create-url.dto";
import { randomInt } from "crypto";




@Injectable()
export class UrlShortnerDemoService {
    constructor(
        private readonly urlreposervice: UrlShortnerDemoRepoService
    ) { }

    private readonly randomCOde = 'asdfghjkwertyuioxcvbnm123456789sdfghjzxcvbnm'

    private readonly baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'

    async createUrl(dto: CreateUrlDto) {
        const customAlias = dto.customAlias

        if (customAlias && this.urlreposervice.exists(customAlias)) {
            throw new BadRequestException(`customAlias "${customAlias}" is already taken`)
        }

        //a custom alias is used as-is, otherwise generate one that is not taken yet
        const shortCode = customAlias ?? this.generateUniqueShortCode()

        const record: Url = {
            shortCode: shortCode,
            longUrl: dto.longUrl,
            clicksCount: 0,
            lastClickedAt: null,
            createdAt: new Date(),
            //no ttl given -> null means the link never expires
            expired_at: dto.expiresInMinutes
                ? new Date(Date.now() + dto.expiresInMinutes * 60_000)
                : null,
            customAlias: customAlias ?? null
        }

        this.urlreposervice.create(record)

        return {
            shortCode: record.shortCode,
            shortUrl: `${this.baseUrl}/url/${record.shortCode}`,
            longUrl: record.longUrl,
            expired_at: record.expired_at
        }
    }


    async redirect(shortCode: string) {
        const record = this.urlreposervice.findByShortcode(shortCode)

        if (!record) throw new NotFoundException(`no url found for shortcode "${shortCode}"`)

        //expired only when the expiry timestamp is already in the past
        if (record.expired_at && record.expired_at <= new Date()) {
            throw new GoneException(`shortcode "${shortCode}" has expired`)
        }

        this.urlreposervice.incrementClickCount(shortCode)

        return record.longUrl
    }

    async getStats(shortCode: string) {
        const record = this.urlreposervice.findByShortcode(shortCode)

        if (!record) throw new NotFoundException(`no url found for shortcode "${shortCode}"`)

        return record
    }

    private generateUniqueShortCode(): string {
        //generated codes can collide, so retry a few times before giving up
        for (let attempt = 0; attempt < 5; attempt++) {
            const code = this.generateShortCode()
            if (!this.urlreposervice.exists(code)) return code
        }

        throw new BadRequestException('could not generate a unique shortcode, please retry')
    }

    private generateShortCode() {
        let code = ''
        for (let i = 0; i < 7; i++) {
            code += this.randomCOde[
                randomInt(0, this.randomCOde.length)
            ]
        }

        return code
    }
}
