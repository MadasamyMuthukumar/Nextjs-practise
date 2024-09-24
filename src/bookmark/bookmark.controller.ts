import { Body, Controller, Delete, Get, HttpCode, HttpException, HttpStatus, Param, ParseIntPipe, Patch, Post, Query, Scope, UseGuards } from '@nestjs/common';
import { BookmarkService } from './bookmark.service';
import { JwtGaurd } from 'src/auth/gaurds';
import { GetUser } from 'src/auth/decorators';
import { Prisma, User } from '@prisma/client';
import { CreateBookmarkDto, EditBookmarkDto } from './dto';
import { SkipThrottle, Throttle } from '@nestjs/throttler';


// @SkipThrottle()  //this entrie controller will skip the limiting
@UseGuards(JwtGaurd)
@Controller({
    path: 'bookmarks',
    // scope: Scope.REQUEST  it will create new instance of controller for every request
    // If your controller requires access to data that changes with each request (e.g., user authentication, request parameters), using Scope.REQUEST allows you to create a fresh instance of the controller for each request.
})
export class BookmarkController {
    /**
     * the reason for passing user id to all fns is]
     * we can check if a bookmark belongs to certain user or not
     * while deleting we need to make sure that not deleting someone else bookmark
     * while getting only get the bookmarks of certain user
     */
    constructor(private bookmarkService: BookmarkService) { }

    @Get()
    getBookmarks(@GetUser('id') userId: number,
        // @Query('role') role?:'Intern'|'Studnet'|'Teacher' we can take optional queries
    ) {
        try {
            return this.bookmarkService.getBookmarks(userId)
        } catch (err) {
            throw new HttpException('Error while getting', HttpStatus.INTERNAL_SERVER_ERROR, { cause: err })
        }
    }

    @Get('/:id')
    getBookmarkById(@GetUser('id') userId: number,
        @Param('id', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.NOT_ACCEPTABLE })) bookmarkId: number) {
        return this.bookmarkService.getBookmarkById(userId, bookmarkId)

    }
    // @SkipThrottle({default:false}) //this one route alone obey to limits
    @Post('create')
    createBookmark(@GetUser('id') userId: number, @Body() dto: Prisma.BookmarkCreateInput) {
        return this.bookmarkService.createBookmark(userId, dto)
    }

    // @Throttle({short:{ttl:1000, limit:1}})   //overriding defined throttle
    @Patch('/edit/:id')
    editBookmarkById(@GetUser('id') userId: number, @Body() dto: EditBookmarkDto,
        @Param('id', ParseIntPipe) bookmarkId: number
    ) {
        return this.bookmarkService.editBookmarkById(userId, dto, bookmarkId)
    }


    @HttpCode(HttpStatus.NO_CONTENT)
    @Delete('/delete/:id')
    deleteBookmarkById(@GetUser('id') userId: number,
        @Param('id', ParseIntPipe) bookmarkId: number) {
        return this.bookmarkService.deleteBookmarkById(userId, bookmarkId)
    }
  
}
