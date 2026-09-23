import { Module } from "@nestjs/common";
import { UrlShortnerController } from "./url-shortner.controller";
import { UrlShortnerDemoService } from "./url-shortner-demo.service";
import { UrlShortnerDemoRepoService } from "./url-shortner-demo-repo.service";


@Module({
    imports: [],
    controllers: [UrlShortnerController],
    providers: [UrlShortnerDemoService, UrlShortnerDemoRepoService]
})


export class UrlShortnerDemoModule {}
