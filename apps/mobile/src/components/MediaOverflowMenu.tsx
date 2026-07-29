import type { AnchorRect, MediaAsset } from '@tradieos/shared';
import {
  getAnchoredMenuPosition,
  buildMediaMenuActionConfig,
  getFallbackMenuAnchor,
  isValidAnchorRect,
  mediaDisplayTitle,
  mediaMenuNoun,
  mediaMenuRemoveLabel,
  mediaMenuViewLabel,
} from '@tradieos/shared';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ActionSheetIOS,
  type GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colours } from '../theme';

const MENU_WIDTH = 248;
const MENU_ACTION_HEIGHT = 44;
const MENU_GAP = 8;
const MENU_TITLE_HEIGHT = 36;
const MENU_VERTICAL_PADDING = 20;
const MEASURE_FALLBACK_MS = 200;
const IOS_ACTION_DELAY_MS = 280;

export function MediaOverflowMenu({
  busy,
  canArchive,
  canRestore,
  media,
  onArchive,
  onClose,
  onEdit,
  onOpen,
  onRestore,
  onView,
  open,
}: {
  busy?: boolean;
  canArchive: boolean;
  canRestore: boolean;
  media: MediaAsset;
  onArchive(): void;
  onClose(): void;
  onEdit?(): void;
  onOpen(): void;
  onRestore(): void;
  onView(): void;
  open: boolean;
}) {
  const noun = mediaMenuNoun(media);
  const anchorRef = useRef<View>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureRequestRef = useRef(0);
  const actionSheetOpenRef = useRef(false);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const [backdropEnabled, setBackdropEnabled] = useState(false);
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const displayTitle = mediaDisplayTitle(media);
  const actionCount =
    2 +
    (onEdit && !media.archivedAt ? 1 : 0) +
    (canArchive ? 1 : 0) +
    (canRestore ? 1 : 0);
  const menuHeight =
    MENU_VERTICAL_PADDING +
    MENU_TITLE_HEIGHT +
    actionCount * MENU_ACTION_HEIGHT;
  const menuPosition = getAnchoredMenuPosition({
    anchorRect:
      anchorRect ??
      getFallbackMenuAnchor({ insets, menuWidth: MENU_WIDTH, viewport }),
    gap: MENU_GAP,
    insets,
    menuHeight,
    menuWidth: MENU_WIDTH,
    viewport,
  });

  const closeMenu = useCallback(() => {
    clearFallbackTimer(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    actionSheetOpenRef.current = false;
    measureRequestRef.current += 1;
    setAnchorRect(null);
    setBackdropEnabled(false);
    onClose();
  }, [onClose]);

  useFocusEffect(
    useCallback(() => {
      return () => closeMenu();
    }, [closeMenu]),
  );

  useEffect(() => {
    logMediaMenu('MEDIA_MENU_COMPONENT_MOUNTED', {
      mediaId: media.id,
      menuVisible: open,
      selectedMediaId: media.id,
    });
    return () => {
      clearFallbackTimer(fallbackTimerRef.current);
    };
  }, []);

  function openMenu() {
    logMediaMenu('MEDIA_ELLIPSIS_NATIVE_PRESS', {
      disabled: Boolean(busy),
      mediaId: media.id,
      menuVisible: open,
      screen: 'MediaOverflowMenu',
      selectedMediaId: media.id,
      timestamp: new Date().toISOString(),
    });

    if (Platform.OS === 'ios') {
      openIosActionSheet();
      return;
    }

    const requestId = measureRequestRef.current + 1;
    measureRequestRef.current = requestId;
    clearFallbackTimer(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    setBackdropEnabled(false);

    logMediaMenu('MEDIA_MENU_PRESS', {
      anchorRefExists: Boolean(anchorRef.current),
      mediaId: media.id,
      menuVisible: open,
      selectedMediaId: media.id,
    });

    setAnchorRect(
      getFallbackMenuAnchor({ insets, menuWidth: MENU_WIDTH, viewport }),
    );
    onOpen();
    logMediaMenu('MEDIA_MENU_VISIBILITY_SET_TRUE', {
      mediaId: media.id,
      menuVisible: true,
      selectedMediaId: media.id,
    });
    requestAnimationFrame(() => setBackdropEnabled(true));

    fallbackTimerRef.current = setTimeout(() => {
      if (measureRequestRef.current !== requestId) return;
      logMediaMenu('MEDIA_MENU_MEASURE_TIMEOUT_FALLBACK', {
        mediaId: media.id,
        menuVisible: true,
        selectedMediaId: media.id,
      });
    }, MEASURE_FALLBACK_MS);

    if (!anchorRef.current) {
      logMediaMenu('MEDIA_MENU_MEASUREMENT_FAILED', {
        anchorRefExists: false,
        mediaId: media.id,
        menuVisible: true,
        selectedMediaId: media.id,
      });
      return;
    }

    logMediaMenu('MEDIA_MENU_MEASURE_STARTED', {
      anchorRefExists: true,
      mediaId: media.id,
      menuVisible: true,
      selectedMediaId: media.id,
    });

    requestAnimationFrame(() => {
      anchorRef.current?.measureInWindow((x, y, width, height) => {
        if (measureRequestRef.current !== requestId) return;
        clearFallbackTimer(fallbackTimerRef.current);
        fallbackTimerRef.current = null;

        const measuredRect = { height, width, x, y };
        const usedFallback = !isValidAnchorRect(measuredRect);
        logMediaMenu('MEDIA_MENU_MEASURE_RESULT', {
          ...measuredRect,
          anchorRefExists: Boolean(anchorRef.current),
          mediaId: media.id,
          menuVisible: true,
          selectedMediaId: media.id,
          usedFallback,
        });

        if (!usedFallback) {
          setAnchorRect(measuredRect);
          logMediaMenu('MEDIA_MENU_ANCHOR_STORED', {
            ...measuredRect,
            mediaId: media.id,
            menuVisible: true,
            selectedMediaId: media.id,
          });
        }
      });
    });
  }

  function runAndClose(action: () => void) {
    setAnchorRect(null);
    action();
  }

  function openIosActionSheet() {
    if (actionSheetOpenRef.current || busy) return;
    actionSheetOpenRef.current = true;
    const actions = buildIosActions({
      canArchive,
      canRestore,
      media,
      onArchive,
      onClose,
      onEdit,
      onOpen,
      onRestore,
      onView,
    });

    logMediaMenu('MEDIA_MENU_IOS_ACTION_SHEET_OPEN', {
      actionCount: actions.options.length,
      mediaId: media.id,
      menuVisible: true,
      selectedMediaId: media.id,
    });

    onOpen();
    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: actions.cancelButtonIndex,
        destructiveButtonIndex: actions.destructiveButtonIndex,
        options: actions.options,
        title: displayTitle,
        userInterfaceStyle: 'light',
      },
      (selectedIndex) => {
        logMediaMenu('MEDIA_MENU_IOS_ACTION_SELECTED', {
          mediaId: media.id,
          menuVisible: false,
          selectedAction: actions.keys[selectedIndex] ?? 'UNKNOWN',
          selectedIndex,
          selectedMediaId: media.id,
        });
        actionSheetOpenRef.current = false;
        onClose();
        const selectedAction = actions.keys[selectedIndex];
        if (!selectedAction || selectedAction === 'CANCEL') return;
        const handler = actions.handlers[selectedIndex];
        if (handler) {
          setTimeout(handler, IOS_ACTION_DELAY_MS);
        }
      },
    );
  }

  function stopMenuPress(event: GestureResponderEvent) {
    event.stopPropagation();
  }

  return (
    <>
      <View collapsable={false} ref={anchorRef} style={styles.ellipsisAnchor}>
        <Pressable
          accessibilityLabel={`More options for ${displayTitle}`}
          accessibilityRole="button"
          disabled={busy}
          onPress={openMenu}
          style={styles.ellipsis}
        >
          {busy ? (
            <ActivityIndicator color={colours.primary} size="small" />
          ) : (
            <Text style={styles.ellipsisText}>•••</Text>
          )}
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={closeMenu}
        transparent
        visible={Platform.OS !== 'ios' && open}
      >
        <Pressable
          accessibilityLabel="Close media actions menu"
          accessibilityRole="button"
          onPress={() => {
            logMediaMenu('MENU_BACKDROP_PRESS', {
              backdropEnabled,
              mediaId: media.id,
              menuVisible: open,
              selectedMediaId: media.id,
            });
            if (backdropEnabled) closeMenu();
          }}
          onTouchMove={closeMenu}
          style={styles.backdrop}
        >
          <Pressable
            accessibilityLabel={`Media actions for ${displayTitle}`}
            accessibilityRole="menu"
            onPress={stopMenuPress}
            style={[
              styles.menuCard,
              {
                left: menuPosition.left,
                top: menuPosition.top,
                width: MENU_WIDTH,
              },
            ]}
          >
            <Text numberOfLines={2} style={styles.menuTitle}>
              {displayTitle}
            </Text>
            <MenuAction
              label={mediaMenuViewLabel(media)}
              onPress={() => runAndClose(onView)}
            />
            {onEdit && !media.archivedAt ? (
              <MenuAction
                label="Edit details"
                onPress={() => runAndClose(onEdit)}
              />
            ) : null}
            {canArchive ? (
              <MenuAction
                destructive
                label={mediaMenuRemoveLabel(media)}
                onPress={() => runAndClose(onArchive)}
              />
            ) : null}
            {canRestore ? (
              <MenuAction
                label={`Restore ${noun}`}
                onPress={() => runAndClose(onRestore)}
              />
            ) : null}
            <MenuAction label="Cancel" onPress={closeMenu} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function buildIosActions({
  canArchive,
  canRestore,
  media,
  onArchive,
  onClose,
  onEdit,
  onOpen,
  onRestore,
  onView,
}: {
  canArchive: boolean;
  canRestore: boolean;
  media: MediaAsset;
  onArchive(): void;
  onClose(): void;
  onEdit?(): void;
  onOpen(): void;
  onRestore(): void;
  onView(): void;
}) {
  const config = buildMediaMenuActionConfig({
    canArchive,
    canEdit: Boolean(onEdit),
    canRestore,
    media,
  });
  const handlerByKey = {
    ARCHIVE: onArchive,
    CANCEL: onClose,
    EDIT: onEdit ?? onClose,
    RESTORE: onRestore,
    VIEW: onView,
  };
  const handlers = config.keys.map((key) => handlerByKey[key]);

  return {
    cancelButtonIndex: config.cancelButtonIndex,
    destructiveButtonIndex: config.destructiveButtonIndex,
    handlers,
    keys: config.keys,
    options: config.options,
  };
}

export function MediaRemovalConfirmation({
  busy,
  media,
  onCancel,
  onConfirm,
  visible,
}: {
  busy?: boolean;
  media: MediaAsset | null;
  onCancel(): void;
  onConfirm(): void;
  visible: boolean;
}) {
  if (!media) return null;
  const noun = mediaMenuNoun(media);
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>Remove this {noun}?</Text>
          <Text style={styles.confirmBody}>
            This {noun} will be hidden from normal job views. Its audit history
            will be retained.
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCancel}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onConfirm}
              style={styles.dangerButton}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : null}
              <Text style={styles.dangerText}>Remove {noun}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MenuAction({
  destructive,
  label,
  onPress,
}: {
  destructive?: boolean;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="menuitem"
      onPress={onPress}
      style={styles.menuAction}
    >
      <Text style={[styles.menuActionText, destructive && styles.destructive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function clearFallbackTimer(timer: ReturnType<typeof setTimeout> | null) {
  if (timer) clearTimeout(timer);
}

function logMediaMenu(
  event: string,
  details: Record<string, boolean | number | string | null>,
) {
  if (__DEV__) {
    console.info(`[TradieOS:${event}]`, details);
  }
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    flex: 1,
  },
  confirmActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 18,
  },
  confirmBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  confirmBody: { color: colours.muted, lineHeight: 21, marginTop: 8 },
  confirmCard: {
    backgroundColor: colours.card,
    borderRadius: 22,
    maxWidth: 520,
    padding: 20,
    width: '100%',
  },
  confirmTitle: { color: colours.ink, fontSize: 22, fontWeight: '900' },
  dangerButton: {
    alignItems: 'center',
    backgroundColor: '#BE123C',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  dangerText: { color: '#FFFFFF', fontWeight: '900' },
  destructive: { color: '#BE123C' },
  ellipsis: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  ellipsisAnchor: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    right: 8,
    top: 8,
    width: 44,
    zIndex: 2,
  },
  ellipsisText: { color: colours.ink, fontSize: 16, fontWeight: '900' },
  menuAction: {
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: MENU_ACTION_HEIGHT,
    paddingHorizontal: 14,
  },
  menuActionText: { color: colours.ink, fontWeight: '900' },
  menuCard: {
    backgroundColor: colours.card,
    borderColor: colours.border,
    borderRadius: 18,
    borderWidth: 1,
    elevation: 8,
    gap: 4,
    padding: 10,
    position: 'absolute',
    shadowColor: '#0F172A',
    shadowOffset: { height: 10, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 24,
  },
  menuTitle: {
    color: colours.muted,
    fontSize: 12,
    fontWeight: '800',
    maxWidth: '100%',
    minHeight: MENU_TITLE_HEIGHT,
    padding: 8,
  },
  secondaryButton: {
    borderColor: colours.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  secondaryText: { color: colours.muted, fontWeight: '900' },
});
