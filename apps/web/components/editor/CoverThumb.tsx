import { type ReactNode } from 'react';
import { mediaUrl } from '../../lib/editor/media';

/** TPL-02, ME-01 · the cover of a template or of a saved element: a small picture, or nothing. */
export function CoverThumb({ id }: { id: string | null }): ReactNode {
  if (!id) return null;
  return <img src={mediaUrl(id)} alt="" width={36} height={36} data-testid="cover-thumb" style={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 6, flex: 'none' }} />;
}
