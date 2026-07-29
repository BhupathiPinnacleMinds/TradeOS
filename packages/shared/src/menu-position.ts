export type AnchorRect = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type ViewportRect = {
  height: number;
  width: number;
};

export type Insets = {
  bottom: number;
  left?: number;
  right?: number;
  top: number;
};

export type AnchoredMenuPositionInput = {
  anchorRect: AnchorRect;
  gap?: number;
  horizontalMargin?: number;
  insets: Insets;
  menuHeight: number;
  menuWidth: number;
  viewport: ViewportRect;
};

export type FallbackMenuAnchorInput = {
  anchorSize?: number;
  insets: Insets;
  menuWidth: number;
  viewport: ViewportRect;
};

export type AnchoredMenuPosition = {
  left: number;
  placement: 'above' | 'below';
  top: number;
};

export function getAnchoredMenuPosition({
  anchorRect,
  gap = 8,
  horizontalMargin = 12,
  insets,
  menuHeight,
  menuWidth,
  viewport,
}: AnchoredMenuPositionInput): AnchoredMenuPosition {
  const minLeft = Math.max(horizontalMargin, insets.left ?? 0);
  const maxLeft = Math.max(
    minLeft,
    viewport.width - (insets.right ?? 0) - horizontalMargin - menuWidth,
  );
  const preferredLeft = anchorRect.x + anchorRect.width - menuWidth;
  const left = clamp(preferredLeft, minLeft, maxLeft);

  const minTop = Math.max(gap, insets.top + gap);
  const maxTop = Math.max(
    minTop,
    viewport.height - insets.bottom - gap - menuHeight,
  );
  const belowTop = anchorRect.y + anchorRect.height + gap;
  const aboveTop = anchorRect.y - menuHeight - gap;
  const hasRoomBelow = belowTop + menuHeight <= maxTop + menuHeight;
  const hasBetterRoomAbove = belowTop > maxTop && aboveTop >= minTop;
  const placement = hasRoomBelow && !hasBetterRoomAbove ? 'below' : 'above';
  const preferredTop = placement === 'below' ? belowTop : aboveTop;
  const top = clamp(preferredTop, minTop, maxTop);

  return { left, placement, top };
}

export function getFallbackMenuAnchor({
  anchorSize = 44,
  insets,
  menuWidth,
  viewport,
}: FallbackMenuAnchorInput): AnchorRect {
  const x = Math.max(12, viewport.width / 2 + menuWidth / 2 - anchorSize);
  const y = Math.max(insets.top + 96, viewport.height / 2 - anchorSize / 2);
  return { height: anchorSize, width: anchorSize, x, y };
}

export function isValidAnchorRect(rect: AnchorRect) {
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
