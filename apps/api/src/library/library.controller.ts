import { Controller, Get, Param, Query } from '@nestjs/common';
import { LibraryService } from './library.service.js';

/** LB-01, LB-02 · публичный API библиотеки (доступен авторизованным пользователям). */
@Controller('library')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  /** LB-01 · список активных коллекций с количеством единиц. */
  @Get('collections')
  listCollections() {
    return this.library.listCollections();
  }

  /** LB-02 · единицы коллекции (поиск и теги через query). */
  @Get('collections/:id/items')
  listItems(
    @Param('id') id: string,
    @Query('search') search?: string,
    @Query('tags') tags?: string | string[],
  ) {
    const tagArr = tags ? (Array.isArray(tags) ? tags : [tags]) : [];
    return this.library.listItems(id, { search, tags: tagArr });
  }
}
