import { Injectable } from "@nestjs/common";

export interface User {
   id: string,
   name: string
}

export interface Group {
   id: string,
   name: string,
   members: Set<string>
}

@Injectable()
export class WebsocketDemoService {
    constructor(){}


    private users = new Map<String, User>([
        ['u1', { id: 'u1', name: 'guna'}],
        ['u2', { id: 'u2', name: 'vimal'}],
        ['u3', { id: 'u3', name: 'sathya'}]
    ])


    private groups = new Map<string, Group>([
         ['g1', { id: 'g1', name:'Engineering', members: new Set(['u1', 'u2', 'u3'])}],
         ['g2', { id: 'g2', name:'Cricket', members: new Set(['u1', 'u3'])}]
    ])


    getUser(id: string){
         return this.users.get(id)
    }

    groupExists(id){
       return this.groups.has(id)
    }

    isGroupMember(userId, groupId){
        return this.groups.get(groupId)?.members.has(userId) ?? false
    }
}