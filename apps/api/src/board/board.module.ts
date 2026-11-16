import { Global, Module } from '@nestjs/common';
import { CreatorBoardController, PublicBoardController } from './board.controller.js';
import { BoardService } from './board.service.js';

@Global()
@Module({ controllers: [PublicBoardController, CreatorBoardController], providers: [BoardService], exports: [BoardService] })
export class BoardModule {}
