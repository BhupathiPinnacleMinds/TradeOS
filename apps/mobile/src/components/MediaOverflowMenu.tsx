import type { AnchorRect, MediaAsset } from '@tradieos/shared';
import {
  getAnchoredMenuPosition,
  buildMediaMenuActionConfig,
  getFallbackMenuAnchor,
  getMediaMenuOpenDecision,
  getMediaMenuActionKeyForIndex,
  isValidAnchorRect,
  isMediaMenuActionForSelectedMedia,
  mediaDisplayTitle,
  mediaMenuNoun,
  shouldDispatchMediaMenuAction,
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
const ACTION_DELAY_MS = 180;

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
  const anchorRef = useRef<View>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isOpeningRef = useRef(false);
  const measureRequestRef = useRef(0);
  const callbacksRef = useRef({
    onArchive,
    onClose,
    onEdit,
    onOpen,
    onRestore,
    onView,
  });
  const selectedMediaIdRef = useRef<string | null>(null);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const [backdropEnabled, setBackdropEnabled] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isNativeActionSheetOpen, setIsNativeActionSheetOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const displayTitle = mediaDisplayTitle(media);
  const actionConfig = buildMediaMenuActionConfig({
    canArchive,
    canEdit: Boolean(onEdit),
    canRestore,
    media,
  });
  const actionCount = actionConfig.options.length;
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

  useEffect(() => {
    callbacksRef.current = {
      onArchive,
      onClose,
      onEdit,
      onOpen,
      onRestore,
      onView,
    };
  }, [onArchive, onClose, onEdit, onOpen, onRestore, onView]);

  const closeMenu = useCallback(() => {
    clearFallbackTimer(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    isOpeningRef.current = false;
    measureRequestRef.current += 1;
    selectedMediaIdRef.current = null;
    setAnchorRect(null);
    setBackdropEnabled(false);
    setIsOpening(false);
    setIsNativeActionSheetOpen(false);
    callbacksRef.current.onClose();
  }, []);

  useFocusEffect(
    useCallback(() => {
      return () => closeMenu();
    }, [closeMenu]),
  );

  useEffect(() => {
    return () => {
      clearFallbackTimer(fallbackTimerRef.current);
    };
  }, []);

  function markOpening() {
    isOpeningRef.current = true;
    selectedMediaIdRef.current = media.id;
    setIsOpening(true);
  }

  function markOpened() {
    isOpeningRef.current = false;
    setIsOpening(false);
  }

  function openMenu(event?: GestureResponderEvent) {
    event?.stopPropagation();

    const decision = getMediaMenuOpenDecision({
      busy,
      isOpen: open || isNativeActionSheetOpen,
      isOpening: isOpeningRef.current || isOpening,
    });

    if (!decision.shouldOpen) {
      logMediaMenu('MEDIA_MENU_OPEN_IGNORED', {
        mediaId: media.id,
        menuVisible: open,
        reason: decision.reason,
      });
      return;
    }

    const requestId = measureRequestRef.current + 1;
    measureRequestRef.current = requestId;
    clearFallbackTimer(fallbackTimerRef.current);
    fallbackTimerRef.current = null;
    setBackdropEnabled(false);
    markOpening();

    if (usesNativeActionSheet()) {
      openNativeActionSheet();
      return;
    }

    setAnchorRect(
      getFallbackMenuAnchor({ insets, menuWidth: MENU_WIDTH, viewport }),
    );
    onOpen();
    requestAnimationFrame(() => setBackdropEnabled(true));

    fallbackTimerRef.current = setTimeout(() => {
      if (measureRequestRef.current !== requestId) return;
      markOpened();
      logMediaMenu('MEDIA_MENU_DISPLAYED', {
        mediaId: media.id,
        presentation: 'fallback-anchor',
      });
    }, MEASURE_FALLBACK_MS);

    if (!anchorRef.current) {
      markOpened();
      return;
    }

    requestAnimationFrame(() => {
      try {
        anchorRef.current?.measureInWindow((x, y, width, height) => {
          if (measureRequestRef.current !== requestId) return;
          clearFallbackTimer(fallbackTimerRef.current);
          fallbackTimerRef.current = null;
          markOpened();

          const measuredRect = { height, width, x, y };
          const usedFallback = !isValidAnchorRect(measuredRect);

          if (!usedFallback) {
            setAnchorRect(measuredRect);
          }
          logMediaMenu('MEDIA_MENU_DISPLAYED', {
            mediaId: media.id,
            presentation: usedFallback ? 'fallback-anchor' : 'measured-anchor',
          });
        });
      } catch {
        if (measureRequestRef.current !== requestId) return;
        clearFallbackTimer(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
        markOpened();
      }
    });
  }

  function runAndClose(action: () => void) {
    closeMenu();
    setTimeout(action, ACTION_DELAY_MS);
  }

  function handleActionPress(actionKey: (typeof actionConfig.keys)[number]) {
    if (
      !isMediaMenuActionForSelectedMedia(selectedMediaIdRef.current, media.id)
    ) {
      closeMenu();
      return;
    }
    if (actionKey === 'CANCEL') {
      closeMenu();
      return;
    }
    const handlers = {
      ARCHIVE: callbacksRef.current.onArchive,
      EDIT: callbacksRef.current.onEdit,
      RESTORE: callbacksRef.current.onRestore,
      VIEW: callbacksRef.current.onView,
    };
    const handler = handlers[actionKey];
    if (handler) runAndClose(handler);
  }

  function dispatchNativeActionSheetSelection(selectedIndex: number) {
    const actionKey = getMediaMenuActionKeyForIndex(
      actionConfig,
      selectedIndex,
    );
    const selectedMediaId = media.id;
    logMediaMenu('MEDIA_MENU_ACTION_SELECTED', {
      actionName: actionKey ?? 'UNKNOWN',
      buttonIndex: selectedIndex,
      mediaId: selectedMediaId,
    });

    if (!actionKey || actionKey === 'CANCEL') {
      closeMenu();
      return;
    }

    if (
      !shouldDispatchMediaMenuAction({
        actionKey,
        mediaId: selectedMediaId,
        selectedMediaId: selectedMediaIdRef.current,
      })
    ) {
      logMediaMenu('MEDIA_MENU_ACTION_FAILED', {
        actionName: actionKey,
        buttonIndex: selectedIndex,
        mediaId: selectedMediaId,
        reason: 'STALE_MEDIA_SELECTION',
      });
      closeMenu();
      return;
    }

    const handlers = {
      ARCHIVE: callbacksRef.current.onArchive,
      EDIT: callbacksRef.current.onEdit,
      RESTORE: callbacksRef.current.onRestore,
      VIEW: callbacksRef.current.onView,
    };
    const handler = handlers[actionKey];
    if (!handler) {
      closeMenu();
      return;
    }

    const logName =
      actionKey === 'VIEW'
        ? 'MEDIA_MENU_VIEW_EXECUTED'
        : actionKey === 'ARCHIVE'
          ? 'MEDIA_MENU_REMOVE_REQUESTED'
          : 'MEDIA_MENU_ACTION_SELECTED';
    closeMenu();
    setTimeout(() => {
      logMediaMenu(logName, {
        actionName: actionKey,
        buttonIndex: selectedIndex,
        mediaId: selectedMediaId,
      });
      handler();
    }, ACTION_DELAY_MS);
  }

  function openNativeActionSheet() {
    setIsNativeActionSheetOpen(true);
    callbacksRef.current.onOpen();
    logMediaMenu('MEDIA_MENU_DISPLAYED', {
      mediaId: media.id,
      presentation: 'native-sheet',
    });

    ActionSheetIOS.showActionSheetWithOptions(
      {
        cancelButtonIndex: actionConfig.cancelButtonIndex,
        destructiveButtonIndex: actionConfig.destructiveButtonIndex,
        options: actionConfig.options,
        title: displayTitle,
        userInterfaceStyle: 'light',
      },
      (selectedIndex) => {
        dispatchNativeActionSheetSelection(selectedIndex);
      },
    );
  }

  function usesNativeActionSheet() {
    return (
      Platform.OS === 'ios' &&
      typeof ActionSheetIOS.showActionSheetWithOptions === 'function'
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
          disabled={busy || isOpening}
          hitSlop={8}
          onPress={openMenu}
          style={styles.ellipsis}
        >
          {busy ? (
            <ActivityIndicator color={colours.primary} size="small" />
          ) : (
            <View style={styles.ellipsisIcon} pointerEvents="none">
              <View style={styles.ellipsisDot} />
              <View style={styles.ellipsisDot} />
              <View style={styles.ellipsisDot} />
            </View>
          )}
        </Pressable>
      </View>
      <Modal
        animationType="fade"
        onRequestClose={closeMenu}
        transparent
        visible={open && !isNativeActionSheetOpen}
      >
        <Pressable
          accessibilityLabel="Close media actions menu"
          accessibilityRole="button"
          onPress={() => {
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
            {actionConfig.keys.map((actionKey, index) => {
              const label = actionConfig.options[index];
              if (!label) return null;
              return (
                <MenuAction
                  destructive={index === actionConfig.destructiveButtonIndex}
                  key={actionKey}
                  label={label}
                  onPress={() => handleActionPress(actionKey)}
                />
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
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
    marginTop: -22,
    position: 'absolute',
    right: 8,
    top: '50%',
    width: 44,
    zIndex: 2,
  },
  ellipsisDot: {
    backgroundColor: colours.ink,
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  ellipsisIcon: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
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
