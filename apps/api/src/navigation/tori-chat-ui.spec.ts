import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..', '..');

function readWorkspaceFile(path: string) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

describe('Tori chat mobile/API contracts', () => {
  it('posts chat requests to the agreed Tori route', () => {
    const client = readWorkspaceFile('apps/mobile/src/api/client.ts');

    expect(client).toContain("'/ai/tori/chat'");
    expect(client).toContain("method: 'POST'");
  });

  it('maps raw route failures to friendly Tori errors', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain('/Cannot (POST|GET|PATCH|PUT|DELETE)\\b/i');
    expect(screen).toContain(
      'Tori is temporarily unavailable. Your TradieOS data is unchanged.',
    );
  });

  it('keeps the Tori composer in a keyboard-aware fixed bottom container', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain('<KeyboardAvoidingView');
    expect(screen).toContain('keyboardVerticalOffset');
    expect(screen).toContain('useBottomTabBarHeight');
    expect(screen).toContain('keyboardDismissMode');
    expect(screen).toContain('style={styles.chatList}');
    expect(screen).toContain('style={styles.inputBar}');
  });

  it('prevents duplicate sends while Tori is pending and restores failed input', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain('if (!token || !content || isLoading) return;');
    expect(screen).toContain('disabled={isLoading || !input.trim()}');
    expect(screen).toContain('setInput(content);');
  });

  it('stores returned Tori context and sends it with the next chat request', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain(
      'const [toriContext, setToriContext] = useState<ToriContext>({});',
    );
    expect(screen).toContain('context: toriContext');
    expect(screen).toContain(
      'if (response.context) setToriContext(response.context);',
    );
    expect(screen).toContain(
      'if (result.context) setToriContext(result.context);',
    );
  });

  it('labels action drafts with the action type and specific confirm text', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain('formatDraftActionLabel');
    expect(screen).toContain('CREATE_CUSTOMER_AND_JOB');
    expect(screen).toContain('Create customer & job');
    expect(screen).toContain('styles.draftType');
  });

  it('renders completed or cancelled action drafts as non-actionable outcome cards', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain("draft.status === 'COMPLETED'");
    expect(screen).toContain('completedDraftLabel');
    expect(screen).toContain('Draft cancelled');
    expect(screen).toContain('markDraftStatus(current, draft.id,');
  });

  it('uses stable unique keys for repeated Tori text, warnings and prompts', () => {
    const screen = readWorkspaceFile(
      'apps/mobile/src/screens/ToriChatScreen.tsx',
    );

    expect(screen).toContain('nextLocalMessageId');
    expect(screen).toContain('promptIndex');
    expect(screen).toContain('changeIndex');
    expect(screen).toContain('warningIndex');
    expect(screen).toContain('draft.id}-warning');
  });
});
