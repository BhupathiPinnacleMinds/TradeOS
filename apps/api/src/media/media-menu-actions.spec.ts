import {
  type AuthUser,
  type MediaAsset,
  buildMediaMenuActionConfig,
  compactMediaFileName,
  formatMediaCount,
  formatMediaSummary,
  getMediaMenuActionKeyForIndex,
  getMediaMenuOpenDecision,
  isMediaMenuActionForSelectedMedia,
  mediaDisplayTitle,
  mediaMenuRemoveLabel,
  shouldDispatchMediaMenuAction,
} from '@tradieos/shared';
import {
  canArchiveMediaInUi,
  mediaArchiveUnavailableReason,
} from '../../../mobile/src/api/mediaActions';

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
  it('builds View, Remove photo and Cancel options for removable photos', () => {
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

  it('always includes Cancel when Remove is hidden', () => {
    const photoConfig = buildMediaMenuActionConfig({
      canArchive: false,
      canRestore: false,
      media: imageMedia,
    });
    const documentConfig = buildMediaMenuActionConfig({
      canArchive: false,
      canRestore: false,
      media: documentMedia,
    });

    expect(photoConfig.options).toEqual(['View photo', 'Cancel']);
    expect(photoConfig.keys).toEqual(['VIEW', 'CANCEL']);
    expect(photoConfig.cancelButtonIndex).toBe(1);
    expect(documentConfig.options).toEqual(['View document', 'Cancel']);
    expect(documentConfig.keys).toEqual(['VIEW', 'CANCEL']);
    expect(documentConfig.cancelButtonIndex).toBe(1);
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

  it('prefers captions, then friendly category labels, then compact filenames', () => {
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
        category: 'BEFORE_PHOTO',
        originalFileName: 'IMG_9284.jpg',
      }),
    ).toBe('Before photo');
    expect(
      mediaDisplayTitle({
        ...documentMedia,
        category: 'GENERAL_DOCUMENT',
        originalFileName: 'Rajeshwar aadhar card.png',
      }),
    ).toBe('Rajeshwar aadhar card.png');
  });

  it('compacts long filenames while preserving extensions where practical', () => {
    expect(compactMediaFileName('2DCD3EF4-8029-48E2-A934-839A.jpg')).toBe(
      '2DCD3EF4-8029-48E2-A93….jpg',
    );
  });

  it('formats media count grammar correctly', () => {
    expect(formatMediaCount(0, 'photo')).toBe('0 photos');
    expect(formatMediaCount(1, 'photo')).toBe('1 photo');
    expect(formatMediaCount(10, 'photo')).toBe('10 photos');
    expect(formatMediaCount(0, 'document')).toBe('0 documents');
    expect(formatMediaCount(1, 'document')).toBe('1 document');
    expect(formatMediaCount(2, 'document')).toBe('2 documents');
    expect(formatMediaSummary({ documents: 1, photos: 2 })).toBe(
      '2 photos · 1 document',
    );
  });
});

describe('media remove action visibility', () => {
  let dateNowSpy: jest.SpiedFunction<typeof Date.now>;

  beforeAll(() => {
    dateNowSpy = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-07-27T12:00:00.000Z').getTime());
  });

  afterAll(() => {
    dateNowSpy.mockRestore();
  });

  const owner = authUser('OWNER', 'owner-1');
  const admin = authUser('ADMIN', 'admin-1');
  const technician = authUser('TECHNICIAN', 'tech-1');

  it('shows Remove for a technician own recent ordinary photo', () => {
    expect(canArchiveMediaInUi(technician, mediaAsset())).toBe(true);
    expect(mediaArchiveUnavailableReason(technician, mediaAsset())).toBeNull();
  });

  it("hides Remove for another user's upload", () => {
    const asset = mediaAsset({ uploadedByUserId: 'tech-2' });

    expect(canArchiveMediaInUi(technician, asset)).toBe(false);
    expect(mediaArchiveUnavailableReason(technician, asset)).toBe(
      'OTHER_USER_UPLOAD',
    );
  });

  it('hides Remove after the technician correction window expires', () => {
    const asset = mediaAsset({ createdAt: '2026-07-25T11:59:00.000Z' });

    expect(canArchiveMediaInUi(technician, asset)).toBe(false);
    expect(mediaArchiveUnavailableReason(technician, asset)).toBe(
      'CORRECTION_WINDOW_EXPIRED',
    );
  });

  it('hides Remove for protected documents for technicians', () => {
    const asset = mediaAsset({
      category: 'COMPLIANCE_CERTIFICATE',
      mediaType: 'PDF',
    });

    expect(canArchiveMediaInUi(technician, asset)).toBe(false);
    expect(mediaArchiveUnavailableReason(technician, asset)).toBe(
      'TECHNICIAN_DOCUMENT',
    );
  });

  it('hides Remove for technician media on completed appointments', () => {
    const asset = mediaAsset();

    expect(
      canArchiveMediaInUi(technician, asset, {
        appointmentStatus: 'COMPLETED',
      }),
    ).toBe(false);
    expect(
      mediaArchiveUnavailableReason(technician, asset, {
        appointmentStatus: 'COMPLETED',
      }),
    ).toBe('COMPLETED_APPOINTMENT');
  });

  it('shows Remove for Owner/Admin where permitted', () => {
    const protectedDocument = mediaAsset({
      category: 'COMPLIANCE_CERTIFICATE',
      mediaType: 'PDF',
      uploadedByUserId: 'tech-1',
    });

    expect(canArchiveMediaInUi(owner, protectedDocument)).toBe(true);
    expect(canArchiveMediaInUi(admin, protectedDocument)).toBe(true);
  });
});

describe('media overflow menu interaction guards', () => {
  it('exports the menu open decision helper as a callable shared package function', () => {
    expect(typeof getMediaMenuOpenDecision).toBe('function');
    expect(typeof isMediaMenuActionForSelectedMedia).toBe('function');
  });

  it('allows one tap to open a closed media menu', () => {
    expect(
      getMediaMenuOpenDecision({
        busy: false,
        isOpen: false,
        isOpening: false,
      }),
    ).toEqual({ shouldOpen: true });
  });

  it('blocks repeated rapid taps while measurement or native sheet opening is in progress', () => {
    expect(
      getMediaMenuOpenDecision({
        busy: false,
        isOpen: false,
        isOpening: true,
      }),
    ).toEqual({ reason: 'OPENING', shouldOpen: false });
  });

  it('does not create a duplicate menu when the menu is already open', () => {
    expect(
      getMediaMenuOpenDecision({
        busy: false,
        isOpen: true,
        isOpening: false,
      }),
    ).toEqual({ reason: 'ALREADY_OPEN', shouldOpen: false });
  });

  it('keeps selected actions scoped to the selected media item', () => {
    expect(isMediaMenuActionForSelectedMedia('media-1', 'media-1')).toBe(true);
    expect(isMediaMenuActionForSelectedMedia('media-2', 'media-1')).toBe(false);
    expect(isMediaMenuActionForSelectedMedia(null, 'media-1')).toBe(false);
  });

  it('treats Cancel as a non-destructive close action for removable and non-removable media', () => {
    const removable = buildMediaMenuActionConfig({
      canArchive: true,
      canRestore: false,
      media: imageMedia,
    });
    const nonRemovable = buildMediaMenuActionConfig({
      canArchive: false,
      canRestore: false,
      media: imageMedia,
    });

    expect(removable.keys[removable.keys.length - 1]).toBe('CANCEL');
    expect(removable.cancelButtonIndex).toBe(removable.keys.length - 1);
    expect(removable.destructiveButtonIndex).toBe(1);
    expect(nonRemovable.keys).toEqual(['VIEW', 'CANCEL']);
    expect(nonRemovable.cancelButtonIndex).toBe(1);
    expect(nonRemovable.destructiveButtonIndex).toBeUndefined();
  });

  it('maps iOS action sheet indexes to View, Remove and Cancel actions', () => {
    const config = buildMediaMenuActionConfig({
      canArchive: true,
      canRestore: false,
      media: imageMedia,
    });

    expect(getMediaMenuActionKeyForIndex(config, 0)).toBe('VIEW');
    expect(getMediaMenuActionKeyForIndex(config, 1)).toBe('ARCHIVE');
    expect(getMediaMenuActionKeyForIndex(config, 2)).toBe('CANCEL');
    expect(getMediaMenuActionKeyForIndex(config, 99)).toBeNull();
  });

  it('dispatches View and Remove only for the selected media item and never for Cancel', () => {
    expect(
      shouldDispatchMediaMenuAction({
        actionKey: 'VIEW',
        mediaId: 'media-1',
        selectedMediaId: 'media-1',
      }),
    ).toBe(true);
    expect(
      shouldDispatchMediaMenuAction({
        actionKey: 'ARCHIVE',
        mediaId: 'media-1',
        selectedMediaId: 'media-1',
      }),
    ).toBe(true);
    expect(
      shouldDispatchMediaMenuAction({
        actionKey: 'CANCEL',
        mediaId: 'media-1',
        selectedMediaId: 'media-1',
      }),
    ).toBe(false);
    expect(
      shouldDispatchMediaMenuAction({
        actionKey: 'VIEW',
        mediaId: 'media-1',
        selectedMediaId: 'media-2',
      }),
    ).toBe(false);
  });
});

function authUser(role: AuthUser['role'], id: string): AuthUser {
  return {
    business: {
      abn: '12345678901',
      address: '1 Demo Street',
      email: 'office@example.test',
      gstRegistered: true,
      id: 'business-1',
      name: 'Demo Tradie Co',
      phone: '0400000000',
      postcode: '3000',
      state: 'VIC',
      suburb: 'Melbourne',
      timezone: 'Australia/Melbourne',
      tradeType: 'Electrical',
    },
    businessId: 'business-1',
    email: `${id}@example.test`,
    firstName: 'Demo',
    id,
    isActive: true,
    lastName: 'User',
    role,
  };
}

function mediaAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    ...imageMedia,
    appointmentId: 'appointment-1',
    businessId: 'business-1',
    checksum: null,
    createdAt: '2026-07-27T11:00:00.000Z',
    customerId: 'customer-1',
    durationSeconds: null,
    fileSizeBytes: 512,
    height: 1200,
    id: 'media-1',
    isCustomerVisible: false,
    jobId: 'job-1',
    mimeType: 'image/jpeg',
    notes: null,
    processingStatus: 'COMPLETED',
    storageProvider: 'local',
    updatedAt: '2026-07-27T11:00:00.000Z',
    uploadedBy: null,
    uploadedByUserId: 'tech-1',
    uploadStatus: 'COMPLETED',
    width: 1600,
    ...overrides,
  };
}
