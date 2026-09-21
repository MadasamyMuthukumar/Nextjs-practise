import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer, WsException } from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { WebsocketDemoService } from "./websocket-demo.service";
import { SkipThrottle } from "@nestjs/throttler";


// the global ThrottlerGuard (APP_GUARD) runs on @SubscribeMessage handlers too, and it
// reads req/res positionally via switchToHttp() — in a ws context that makes `res` the
// message payload, so res.header(...) throws on every event. both names are listed
// because app.module registers named throttlers ('long'/'short'), not 'default'.
@SkipThrottle({  long: true, short:true})
@WebSocketGateway({
    origin: '*'
})
export class WebsocketDemoGateway implements OnGatewayConnection, OnGatewayDisconnect {

    constructor(
        private readonly chatService: WebsocketDemoService
    ) { }

    @WebSocketServer() server: Server


    async handleConnection(client: Socket, ...args: any[]) {

        const userId = this.getAuthIdFromHandshake(client)

        const isUser = this.chatService.getUser(userId)

        if (!isUser) {
            client.disconnect(true)
            throw new WsException('error')
        }

        client.data.userId = userId

        await client.join(`user:${userId}`)

        client.emit('connected', {
            message: 'user connected',
            userId: userId
        })


    }


    async handleDisconnect(client: any) {
        console.log('cliet disconnected')
    }


    @SubscribeMessage('join_group')
    async joinGroup(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { groupId: string }
    ) {
        const userId = this.requireUserId(client)

        const isUser = this.chatService.getUser(userId)

        if (!isUser) throw new WsException('no user')

        const groupExists = this.chatService.groupExists(body.groupId)
        const groupMemberExists = this.chatService.isGroupMember(userId, body.groupId)

        if (!groupExists || !groupMemberExists) throw new WsException('Not valid group or member')

        client.join(`group:${body.groupId}`)

        client.emit('group_joined', {
            grupdId: body.groupId,
            userId
        })

        this.server.to(`group:${body.groupId}`).emit('group_joined', {
            groupId: body.groupId,
            userId
        })


        return {
            ok: true,
            groupId: body.groupId,
            userId
        }

    }



    @SubscribeMessage('send_private_message')
    async sendPrivateMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { receiverId: string, message: string }
    ) {
        const receiverId = body.receiverId

        const userId = this.requireUserId(client)

        const isUser = this.chatService.getUser(receiverId)

        if (!isUser) throw new WsException('no user')

        this.server.to(`user:${receiverId}`).emit('private_message', {
            message: body.message
        })

        client.emit('private_message', {
            message: body.message
        })

        return {
            ok: true,
            message: body.message
        }
    }


    @SubscribeMessage('send_group_message')
    async sendGroupMessage(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { groupId: string, message: string }
    ) {
        const userId = this.requireUserId(client)

        const isUser = this.chatService.getUser(userId)

        if (!isUser) throw new WsException('no user')

        const groupExists = this.chatService.groupExists(body.groupId)
        const groupMemberExists = this.chatService.isGroupMember(userId, body.groupId)

        if (!groupExists || !groupMemberExists) throw new WsException('Not valid group or member')

        this.server.to(`group:${body.groupId}`).emit('group_message', {
            message: body.message
        })

        return {
            ok: true,
            message: body.message
        }




    }


    private requireUserId(client: Socket) {
          return client.data.userId ?? null
    } 

    private getAuthIdFromHandshake(client: Socket): string | null {

        // socket.io types a query param as string | string[] because ?userId=a&userId=b is legal
        const query = client.handshake.query?.userId

        const userId = Array.isArray(query) ? query[0] : query

        return typeof userId === 'string' && userId.length > 0 ? userId : null

    }



}