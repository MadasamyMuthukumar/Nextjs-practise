import { Injectable } from '@nestjs/common';
import { CreateBookmarkDto, EditBookmarkDto } from './dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserCreatedEvent } from 'src/events/user-created.event';

@Injectable()
export class BookmarkService {
    constructor(private prisma:PrismaService, private emitter:EventEmitter2){}
    
    /**Getting all the bookmarks from specified userId */
    async getBookmarks(userId:number){
        const bookmarks= await this.prisma.bookmark.findMany({
            where:{
                userId
            }
        })
        return bookmarks

    }


   async getBookmarkById(userId:number , bookmarkId:number){
    console.log(userId, bookmarkId);
    
    /**getting specific bookmark of specified user by using bookmarkid and userid  */
     const bookmark =  await this.prisma.bookmark.findUnique({
        where:{
            userId,
            id:bookmarkId
        }
     }) 
     if(!bookmark) return 'no data availble'
     return bookmark
    }


    async createBookmark(userId:number , dto:CreateBookmarkDto){
        /**creating bookmark for specified user only */
        const bookmark = await this.prisma.bookmark.create({
            data:{
                userId,
                ...dto
            }
        })

        this.emitter.emit('bookmark.created',bookmark)
        return bookmark
  
    }

   
   async editBookmarkById(userId:number , dto:EditBookmarkDto, bookmarkId:number){
    console.log('here');
    
        const editedBookmark =  await this.prisma.bookmark.update({
            where:{
                userId,
                id:bookmarkId
            },
            data:{
                id:bookmarkId,
                ...dto
            }
        })
        return editedBookmark

        //or else 
        /**
         * 1.take book mark alone by Id.
         * throw error if book mark not exist || bookmar.userId!=userId
         * then update the specific bookmark by its id
         */
    }


    async deleteBookmarkById(userId:number , bookmarkId:number){
        const deletedBookmark = await this.prisma.bookmark.delete({
            where:{
                userId,
                id:bookmarkId
            }
        })
        return deletedBookmark
    }
}
