import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class ListenerService implements OnModuleInit {
  onModuleInit() {
    console.log('ListenerService initialized');
  }

  // Listen for the 'bookmark.created' event
  @OnEvent('bookmark.created')
  handleBookmarkCreatedEvent(payload: any) {
    console.log('Bookmark Created:', payload);
  }

  @OnEvent('aysnc.event',{ async:true})
    async fn(){
  //await logic
    }
}