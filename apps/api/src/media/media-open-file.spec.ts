import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');

function mobileSource(relativePath: string) {
  return readFileSync(join(repoRoot, 'apps/mobile/src', relativePath), 'utf8');
}

function mobilePackageJson() {
  return JSON.parse(
    readFileSync(join(repoRoot, 'apps/mobile/package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
}

describe('mobile media Open file flow', () => {
  it('keeps secure preview on the authenticated inline download path', () => {
    const viewer = mobileSource('screens/MediaViewerScreen.tsx');

    expect(viewer).toContain(
      "await downloadAuthenticatedMediaFile(token, mediaItem, 'inline')",
    );
    expect(viewer).toContain('setPreviewUri(');
    expect(viewer).toContain('source={{ uri: previewUri }}');
  });

  it('downloads private media with auth before external opening', () => {
    const viewer = mobileSource('screens/MediaViewerScreen.tsx');

    expect(viewer).toContain('await mediaDownloadRequest(token, media.id);');
    expect(viewer).toContain(
      "await downloadAuthenticatedMediaFile(\n        token,\n        media,\n        'attachment',\n      )",
    );
    expect(viewer).toContain('await openDownloadedMediaFile(localUri, media);');
    expect(viewer).not.toContain('await Linking.openURL(localUri);');
  });

  it('includes auth headers in the private media download request', () => {
    const helper = mobileSource('api/mediaFiles.ts');

    expect(helper).toContain(
      'const url = buildApiUrl(buildMediaFilePath(media.id, disposition));',
    );
    expect(helper).toContain('headers: buildAuthenticatedHeaders(token)');
    expect(helper).toContain('FileSystem.downloadAsync(url, localUri, {');
  });

  it('verifies the local file exists before opening it externally', () => {
    const helper = mobileSource('api/mediaFiles.ts');

    expect(helper).toContain('FileSystem.getInfoAsync(localUri)');
    expect(helper).toContain('if (!fileInfo?.exists)');
    expect(helper).toContain("'MEDIA_DOWNLOAD_FAILED'");
  });

  it('opens Android files through a grantable content URI instead of protected remote or raw file URLs', () => {
    const helper = mobileSource('api/mediaFiles.ts');

    expect(helper).toContain(
      "import * as IntentLauncher from 'expo-intent-launcher';",
    );
    expect(helper).toContain('FileSystem.getContentUriAsync(localUri)');
    expect(helper).toContain('IntentLauncher.startActivityAsync');
    expect(helper).toContain('data: contentUri');
    expect(helper).toContain('flags: ANDROID_GRANT_READ_URI_PERMISSION');
    expect(helper).toContain('type: mediaOpenMimeType(media)');
  });

  it('preserves image and PDF MIME types for Android external viewers', () => {
    const helper = mobileSource('api/mediaFiles.ts');

    expect(helper).toContain('export function mediaOpenMimeType');
    expect(helper).toContain(
      "if (media.mediaType === 'IMAGE') return 'image/*';",
    );
    expect(helper).toContain(
      "if (media.mediaType === 'PDF') return 'application/pdf';",
    );
    expect(helper).toContain("return 'application/octet-stream';");
  });

  it('keeps retry routed through the same safe open operation', () => {
    const viewer = mobileSource('screens/MediaViewerScreen.tsx');

    expect(viewer).toContain('async function openDownload()');
    expect(viewer).toContain('onPress={openDownload}');
    expect(viewer).toContain('Retry');
  });

  it('adds the Expo Android intent dependency directly to the mobile app', () => {
    const packageJson = mobilePackageJson();

    expect(packageJson.dependencies?.['expo-intent-launcher']).toBeDefined();
  });
});
