import { Injectable } from "@nestjs/common";
import * as bcrypt from 'bcrypt'
import { ROLES } from "./roles.type";

@Injectable()
export class UsersService {

    private Users = [
        {
            id: 1,
            email: 'user1@gmail.com',
            password: bcrypt.hashSync('user1', 10),
            role: ROLES.ADMIN
        },
          {
            id: 2,
            email: 'user2@gmail.com',
            password: bcrypt.hashSync('user2', 10),
            role: ROLES.USER
        }
    ]

    findByEmail(email) {
        return this.Users.find(user => user.email== email)
    }

    createUser(email, password, role){
        this.Users.push({
            id: this.Users.length +1,
            email,
            password,
            role
        })
    }
}