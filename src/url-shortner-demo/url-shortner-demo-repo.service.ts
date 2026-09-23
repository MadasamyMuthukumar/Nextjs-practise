import { BadRequestException, Injectable } from "@nestjs/common";

export interface Url {
    shortCode: string,
    longUrl: string,
    expired_at: Date | null,
    clicksCount: number,
    createdAt: Date | null,
    lastClickedAt: Date | null,
    customAlias: string | null
}

@Injectable()
export class UrlShortnerDemoRepoService {
    constructor() {}

    private urls = new Map<string, Url>()


    findByShortcode(shortCode: string): Url | undefined {
        return this.urls.get(shortCode)
    }

    exists(shortCode: string): boolean {
        return this.urls.has(shortCode)
    }

    create(urlObject: Url) {
        const isShortcodeExists = this.urls.has(urlObject.shortCode)

        if (isShortcodeExists) throw new BadRequestException(`shortcode "${urlObject.shortCode}" is already taken`)

        this.urls.set(urlObject.shortCode, urlObject)

        return urlObject
    }

    incrementClickCount(shortCode: string): void {
    const record = this.urls.get(shortCode);

    if (!record) {
      return;
    }

    record.clicksCount += 1;
    record.lastClickedAt = new Date();
  }
}
