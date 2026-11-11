import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { type Response } from 'express';
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

  /** LB-02 · items by numbers (?ids=a,b): what the editor needs to draw the library files that the document refers to. */
  @Get('items')
  items(@Query('ids') ids?: string) {
    return this.library.itemsByIds((ids ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  }

  /** LB-02 · the file of an item for the editor of a signed-in person. */
  @Get('items/:id/file')
  async file(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { path, mime } = await this.library.fileOf(id);
    await new Promise<void>((resolve, reject) => {
      res.sendFile(
        path,
        { headers: { 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' }, dotfiles: 'allow' },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
}
