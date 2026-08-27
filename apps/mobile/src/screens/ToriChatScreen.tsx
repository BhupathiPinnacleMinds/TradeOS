import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import type {
  ToriActionConfirmResponse,
  ToriActionDraft,
  ToriChatMessage,
  ToriContext,
  ToriSnapshot,
} from '@tradieos/shared';
import { formatAudCents } from '@tradieos/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  confirmToriActionRequest,
  toriChatRequest,
  toriSummaryRequest,
} from '../api/client';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { keyboardAvoidingBehavior } from '../components/keyboardAvoidance';
import { colours } from '../theme';

const USER_MESSAGE_PREFIX = 'user-';
let localMessageSequence = 0;

function nextLocalMessageId(prefix: string) {
  localMessageSequence += 1;
  return `${prefix}-${Date.now()}-${localMessageSequence}`;
}

function newUserMessage(content: string): ToriChatMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: nextLocalMessageId(USER_MESSAGE_PREFIX),
    role: 'user',
  };
}

function friendlyToriError(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (
      error.status === 404 ||
      /Cannot (POST|GET|PATCH|PUT|DELETE)\b/i.test(error.message)
    ) {
      return 'Tori is temporarily unavailable. Your TradieOS data is unchanged.';
    }
    if (error.status === 401) {
      return 'Your session has expired. Please log in again.';
    }
    if (error.status === 403) {
      return "Tori can't do that with your current role.";
    }
    if (error.code === 'TORI_DRAFT_STALE') {
      return 'This action changed since Tori prepared it. Ask Tori to refresh the draft.';
    }
    if (error.status && error.status >= 500) {
      return 'Tori is temporarily unavailable. Your TradieOS data is unchanged.';
    }
    return error.message;
  }
  return 'Tori is temporarily unavailable. Your TradieOS data is unchanged.';
}

function markDraftStatus(
  messages: ToriChatMessage[],
  draftId: string,
  status: ToriActionDraft['status'],
) {
  return messages.map((message) =>
    message.actionDraft?.id === draftId
      ? {
          ...message,
          actionDraft: { ...message.actionDraft, status },
        }
      : message,
  );
}

export function ToriChatScreen() {
  const { token } = useAuth();
  const tabBarHeight = useBottomTabBarHeight();
  const scrollRef = useRef<ScrollView | null>(null);
  const [snapshot, setSnapshot] = useState<ToriSnapshot | null>(null);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [providerMessage, setProviderMessage] = useState('');
  const [messages, setMessages] = useState<ToriChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [toriContext, setToriContext] = useState<ToriContext>({});

  const recentMessages = useMemo(
    () =>
      messages
        .slice(-6)
        .map((message) => ({ content: message.content, role: message.role })),
    [messages],
  );

  const loadSummary = useCallback(async () => {
    if (!token) return;
    try {
      const response = await toriSummaryRequest(token);
      setSnapshot(response.snapshot);
      setPrompts(response.suggestedPrompts);
      setProviderMessage(response.provider.message);
    } catch (summaryError) {
      setError(friendlyToriError(summaryError));
    }
  }, [token]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollToEnd({ animated: true }),
    );
  }, [messages]);

  async function sendMessage(messageText = input) {
    const content = messageText.trim();
    if (!token || !content || isLoading) return;
    setError('');
    setInput('');
    setIsLoading(true);
    const userMessage = newUserMessage(content);
    setMessages((current) => [...current, userMessage]);
    try {
      const response = await toriChatRequest(token, {
        context: toriContext,
        message: content,
        recentMessages,
      });
      setSnapshot(response.snapshot);
      setPrompts(response.suggestedPrompts);
      setProviderMessage(response.provider.message);
      if (response.context) setToriContext(response.context);
      setMessages((current) => [...current, response.message]);
    } catch (chatError) {
      setInput(content);
      setMessages((current) => [
        ...current,
        {
          content: friendlyToriError(chatError),
          createdAt: new Date().toISOString(),
          id: nextLocalMessageId('assistant-error'),
          role: 'assistant',
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmDraft(draft: ToriActionDraft) {
    if (!token || busyDraftId) return;
    setBusyDraftId(draft.id);
    setError('');
    try {
      const result = await confirmToriActionRequest(token, draft.id, { draft });
      await loadSummary();
      if (result.context) setToriContext(result.context);
      setMessages((current) => [
        ...markDraftStatus(current, draft.id, 'COMPLETED'),
        {
          content: formatActionResult(result),
          createdAt: new Date().toISOString(),
          id: nextLocalMessageId('assistant-result'),
          role: 'assistant',
        },
        ...(result.nextMessage ? [result.nextMessage] : []),
      ]);
    } catch (confirmError) {
      setMessages((current) => [
        ...current,
        {
          content: friendlyToriError(confirmError),
          createdAt: new Date().toISOString(),
          id: `assistant-confirm-error-${Date.now()}`,
          role: 'assistant',
        },
      ]);
    } finally {
      setBusyDraftId(null);
    }
  }

  function cancelDraft(draftId: string) {
    setMessages((current) =>
      current.map((message) =>
        message.actionDraft?.id === draftId
          ? {
              ...message,
              actionDraft: { ...message.actionDraft, status: 'CANCELLED' },
              content: `${message.content}\n\nDraft cancelled. No TradieOS data changed.`,
            }
          : message,
      ),
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'android' ? 'padding' : keyboardAvoidingBehavior
        }
        keyboardVerticalOffset={tabBarHeight}
        style={styles.keyboard}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          keyboardDismissMode={
            Platform.OS === 'ios' ? 'interactive' : 'on-drag'
          }
          keyboardShouldPersistTaps="handled"
          style={styles.chatList}
        >
          <View style={styles.header}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>T</Text>
            </View>
            <View style={styles.headerText}>
              <Text style={styles.title}>Tori</Text>
              <Text style={styles.body}>
                Ask about your work or prepare an action.
              </Text>
            </View>
          </View>

          <View style={styles.safety}>
            <Text style={styles.safetyTitle}>You're always in control</Text>
            <Text style={styles.safetyBody}>
              Tori can draft and recommend. Nothing is changed, sent, quoted or
              invoiced until you confirm.
            </Text>
          </View>

          {providerMessage ? (
            <Text style={styles.provider}>{providerMessage}</Text>
          ) : null}

          {snapshot ? <SnapshotCards snapshot={snapshot} /> : null}

          {prompts.length ? (
            <View style={styles.promptWrap}>
              {prompts.map((prompt, promptIndex) => (
                <Pressable
                  accessibilityRole="button"
                  key={`prompt-${promptIndex}-${prompt}`}
                  onPress={() => void sendMessage(prompt)}
                  style={({ pressed }) => [
                    styles.promptChip,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.promptText}>{prompt}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>What can I help with?</Text>
              <Text style={styles.emptyBody}>
                Try asking about today, overdue invoices, unassigned
                appointments, or quote follow-ups.
              </Text>
            </View>
          ) : null}

          {messages.map((message) => (
            <MessageBubble
              busyDraftId={busyDraftId}
              key={message.id}
              message={message}
              onCancelDraft={cancelDraft}
              onConfirmDraft={confirmDraft}
            />
          ))}

          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colours.tori} />
              <Text style={styles.loadingText}>Tori is checking TradieOS…</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.inputBar}>
          <TextInput
            accessibilityLabel="Ask Tori"
            multiline
            onChangeText={setInput}
            placeholder="Ask Tori…"
            placeholderTextColor={colours.muted}
            style={styles.input}
            value={input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isLoading || !input.trim()}
            onPress={() => {
              Keyboard.dismiss();
              void sendMessage();
            }}
            style={({ pressed }) => [
              styles.sendButton,
              (!input.trim() || isLoading) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SnapshotCards({ snapshot }: { snapshot: ToriSnapshot }) {
  const cards = [
    ['Today', String(snapshot.todayAppointments)],
    ['Unassigned', String(snapshot.unassignedAppointments)],
    ['Quotes waiting', String(snapshot.quotesAwaitingResponse)],
    ['Outstanding', formatAudCents(snapshot.outstandingInvoicesCents)],
    ['Overdue', formatAudCents(snapshot.overdueInvoicesCents)],
  ];
  return (
    <View style={styles.snapshotGrid}>
      {cards.map(([label, value]) => (
        <View key={label} style={styles.snapshotCard}>
          <Text style={styles.snapshotValue}>{value}</Text>
          <Text style={styles.snapshotLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function MessageBubble({
  busyDraftId,
  message,
  onCancelDraft,
  onConfirmDraft,
}: {
  busyDraftId: string | null;
  message: ToriChatMessage;
  onCancelDraft(draftId: string): void;
  onConfirmDraft(draft: ToriActionDraft): void;
}) {
  const isUser = message.role === 'user';
  return (
    <View
      style={[styles.message, isUser ? styles.userMessage : styles.toriMessage]}
    >
      <Text style={[styles.messageText, isUser && styles.userMessageText]}>
        {message.content}
      </Text>
      {message.actionDraft ? (
        <ActionDraftCard
          busy={busyDraftId === message.actionDraft.id}
          draft={message.actionDraft}
          onCancel={() => onCancelDraft(message.actionDraft!.id)}
          onConfirm={() => onConfirmDraft(message.actionDraft!)}
        />
      ) : null}
    </View>
  );
}

function ActionDraftCard({
  busy,
  draft,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  draft: ToriActionDraft;
  onCancel(): void;
  onConfirm(): void;
}) {
  const actionLabel = formatDraftActionLabel(draft);
  const confirmLabel = formatDraftConfirmLabel(draft);
  const isTerminal =
    draft.status === 'COMPLETED' ||
    draft.status === 'CANCELLED' ||
    draft.status === 'STALE';
  return (
    <View style={styles.draftCard}>
      <Text style={styles.draftType}>{actionLabel}</Text>
      <Text style={styles.draftTitle}>{draft.title}</Text>
      <Text style={styles.draftBody}>{draft.description}</Text>
      {draft.proposedChanges.map((change, changeIndex) => (
        <View
          key={`${draft.id}-change-${changeIndex}-${change.label}`}
          style={styles.changeRow}
        >
          <Text style={styles.changeLabel}>{change.label}</Text>
          <Text style={styles.changeValue}>
            {change.from ? `${change.from} → ` : ''}
            {change.to}
          </Text>
        </View>
      ))}
      {draft.warnings.map((warning, warningIndex) => (
        <Text
          key={`${draft.id}-warning-${warningIndex}-${warning}`}
          style={styles.warning}
        >
          {warning}
        </Text>
      ))}
      {isTerminal ? (
        <Text style={styles.draftStatus}>
          {draft.status === 'COMPLETED'
            ? `✓ ${completedDraftLabel(draft)}`
            : draft.status === 'CANCELLED'
              ? 'Draft cancelled'
              : 'Draft expired'}
        </Text>
      ) : null}
      {!isTerminal ? (
        <View style={styles.draftActions}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
            style={({ pressed }) => [
              styles.secondaryButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || draft.validationState === 'CONFLICT'}
            onPress={onConfirm}
            style={({ pressed }) => [
              styles.confirmButton,
              (busy || draft.validationState === 'CONFLICT') && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.confirmText}>
              {busy ? 'Confirming…' : confirmLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function completedDraftLabel(draft: ToriActionDraft) {
  switch (draft.type) {
    case 'CREATE_CUSTOMER_AND_JOB':
      return 'Customer and job created';
    case 'CREATE_CUSTOMER':
      return 'Customer created';
    case 'CREATE_JOB':
      return 'Job created';
    case 'CREATE_APPOINTMENT':
      return 'Appointment created';
    default:
      return 'Action completed';
  }
}

function formatDraftActionLabel(draft: ToriActionDraft) {
  return draft.type.replaceAll('_', ' ');
}

function formatDraftConfirmLabel(draft: ToriActionDraft) {
  switch (draft.type) {
    case 'CREATE_CUSTOMER':
      return 'Create customer';
    case 'CREATE_JOB':
      return 'Create job';
    case 'CREATE_CUSTOMER_AND_JOB':
      return 'Create customer & job';
    case 'CANCEL_APPOINTMENT':
      return 'Cancel appointment';
    case 'SEND_CUSTOMER_MESSAGE':
      return 'Confirm message';
    default:
      return 'Confirm';
  }
}

function formatActionResult(result: ToriActionConfirmResponse) {
  return [
    result.message,
    ...result.details.map((detail) => `${detail.label}: ${detail.value}`),
  ].join('\n');
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    backgroundColor: colours.tori,
    borderRadius: 24,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  body: {
    color: colours.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  changeLabel: {
    color: colours.muted,
    fontSize: 13,
  },
  changeRow: {
    gap: 4,
    marginTop: 10,
  },
  changeValue: {
    color: colours.ink,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  confirmButton: {
    alignItems: 'center',
    backgroundColor: colours.tori,
    borderRadius: 14,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  confirmText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  chatList: {
    flex: 1,
  },
  content: {
    gap: 16,
    padding: 20,
    paddingBottom: 28,
  },
  disabled: {
    opacity: 0.45,
  },
  draftActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  draftBody: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  draftStatus: {
    color: '#047857',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 20,
    marginTop: 14,
  },
  draftCard: {
    backgroundColor: '#F8FAFC',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  draftTitle: {
    color: colours.ink,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  draftType: {
    color: colours.tori,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  empty: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
  },
  emptyBody: {
    color: colours.muted,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyTitle: {
    color: colours.ink,
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 6,
  },
  error: {
    color: '#B91C1C',
    fontSize: 14,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 14,
  },
  headerText: {
    flex: 1,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    color: colours.ink,
    flex: 1,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  inputBar: {
    alignItems: 'flex-end',
    backgroundColor: colours.background,
    borderColor: colours.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 14,
  },
  keyboard: {
    flex: 1,
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
  },
  loadingText: {
    color: colours.muted,
    fontSize: 14,
  },
  message: {
    borderRadius: 20,
    maxWidth: '92%',
    padding: 14,
  },
  messageText: {
    color: colours.ink,
    fontSize: 15,
    lineHeight: 22,
  },
  pressed: {
    opacity: 0.76,
  },
  promptChip: {
    backgroundColor: '#FFFFFF',
    borderColor: '#DDD6FE',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  promptText: {
    color: colours.tori,
    fontSize: 13,
    fontWeight: '800',
  },
  promptWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  provider: {
    color: colours.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  safeArea: {
    backgroundColor: colours.background,
    flex: 1,
  },
  safety: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
  },
  safetyBody: {
    color: '#5B21B6',
    fontSize: 14,
    lineHeight: 20,
  },
  safetyTitle: {
    color: '#4C1D95',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  secondaryButtonText: {
    color: colours.ink,
    fontSize: 14,
    fontWeight: '800',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colours.tori,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 18,
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  snapshotCard: {
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    flexBasis: '30%',
    flexGrow: 1,
    padding: 14,
  },
  snapshotGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  snapshotLabel: {
    color: colours.muted,
    fontSize: 12,
    marginTop: 4,
  },
  snapshotValue: {
    color: colours.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  title: {
    color: colours.ink,
    fontSize: 28,
    fontWeight: '800',
  },
  toriMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderColor: colours.border,
    borderWidth: 1,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: colours.tori,
  },
  userMessageText: {
    color: '#FFFFFF',
  },
  warning: {
    color: colours.warning,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
    marginTop: 10,
  },
});
