import {
  buildMediaMenuActionConfig,
  compactMediaFileName,
  formatMediaCount,
  formatMediaSummary,
  mediaDisplayTitle,
  mediaMenuRemoveLabel,
} from '@tradieos/shared';

const imageMedia = {
  archivedAt: null,
  caption: null,
  category: 'DAMAGE_EVIDENCE',
  mediaType: 'IMAGE',
  originalFileName: 'damage-photo.jpg',
} as const;

const documentMedia = {
  archivedAt: null,
  caption: null,
  category: 'GENERAL_DOCUMENT',
  mediaType: 'PDF',
  originalFileName: 'certificate.pdf',
} as const;

describe('media menu action configuration', () => {
  it('builds iOS-compatible View, Remove photo and Cancel options', () => {
    const config = buildMediaMenuActionConfig({
      canArchive: true,
      canRestore: false,
      media: imageMedia,
    });

    expect(config.options).toEqual(['View photo', 'Remove photo', 'Cancel']);
    expect(config.keys).toEqual(['VIEW', 'ARCHIVE', 'CANCEL']);
    expect(config.destructiveButtonIndex).toBe(1);
    expect(config.cancelButtonIndex).toBe(2);
  });

  it('uses document copy for non-image removal', () => {
    expect(mediaMenuRemoveLabel(documentMedia)).toBe('Remove document');
  });

  it('preserves edit and restore actions without marking restore destructive', () => {
    const config = buildMediaMenuActionConfig({
      canArchive: false,
      canEdit: true,
      canRestore: true,
      media: { ...documentMedia, archivedAt: '2026-07-29T00:00:00.000Z' },
    });

    expect(config.options).toEqual([
      'View document',
      'Restore document',
      'Cancel',
    ]);
    expect(config.keys).toEqual(['VIEW', 'RESTORE', 'CANCEL']);
    expect(config.destructiveButtonIndex).toBeUndefined();
    expect(config.cancelButtonIndex).toBe(2);
  });

  it('keeps edit before destructive remove for active media', () => {
    const config = buildMediaMenuActionConfig({
      canArchive: true,
      canEdit: true,
      canRestore: false,
      media: documentMedia,
    });

    expect(config.options).toEqual([
      'View document',
      'Edit details',
      'Remove document',
      'Cancel',
    ]);
    expect(config.keys).toEqual(['VIEW', 'EDIT', 'ARCHIVE', 'CANCEL']);
    expect(config.destructiveButtonIndex).toBe(2);
    expect(config.cancelButtonIndex).toBe(3);
  });

  it('prefers captions, then generated-file category fallback, then compact filenames', () => {
    expect(
      mediaDisplayTitle({
        ...imageMedia,
        caption: 'Kitchen leak before repair',
      }),
    ).toBe('Kitchen leak before repair');
    expect(
      mediaDisplayTitle({
        ...imageMedia,
        originalFileName: '2DCD3EF4802948E2A934E8B000839A.jpg',
      }),
    ).toBe('Damage evidence');
    expect(
      mediaDisplayTitle({
        ...imageMedia,
        originalFileName: 'customer-supplied-before-photo-long-name.jpg',
      }),
    ).toBe('customer-supplied-befo….jpg');
  });

  it('compacts long filenames while preserving extensions where practical', () => {
    expect(compactMediaFileName('2DCD3EF4-8029-48E2-A934-839A.jpg')).toBe(
      '2DCD3EF4-8029-48E2-A93….jpg',
    );
  });

  it('formats media count grammar correctly', () => {
    expect(formatMediaCount(0, 'photo')).toBe('0 photos');
    expect(formatMediaCount(1, 'photo')).toBe('1 photo');
    expect(formatMediaCount(2, 'photo')).toBe('2 photos');
    expect(formatMediaCount(0, 'document')).toBe('0 documents');
    expect(formatMediaCount(1, 'document')).toBe('1 document');
    expect(formatMediaCount(2, 'document')).toBe('2 documents');
    expect(formatMediaSummary({ documents: 1, photos: 2 })).toBe(
      '2 photos · 1 document',
    );
  });
});
