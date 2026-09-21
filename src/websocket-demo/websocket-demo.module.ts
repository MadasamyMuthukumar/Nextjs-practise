import { Module } from "@nestjs/common";
import { WebsocketDemoService } from "./websocket-demo.service";
import { WebsocketDemoGateway } from "./websocket-demo.gateway";





@Module({
    imports:[],
    providers: [WebsocketDemoService, WebsocketDemoGateway],
    controllers:[]
})
export class WebsocketDemoModule {}