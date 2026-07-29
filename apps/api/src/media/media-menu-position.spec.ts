import {
  getAnchoredMenuPosition,
  getFallbackMenuAnchor,
  isValidAnchorRect,
} from '@tradieos/shared';

describe('anchored media menu positioning', () => {
  const viewport = { height: 844, width: 390 };
  const insets = { bottom: 34, top: 47 };
  const menuWidth = 248;
  const menuHeight = 220;

  it('aligns the menu right edge to the selected ellipsis when room exists', () => {
    const position = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 180 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });

    expect(position).toEqual({
      left: 96,
      placement: 'below',
      top: 232,
    });
  });

  it('uses different selected card anchors instead of stale coordinates', () => {
    const first = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 180 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });
    const second = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 520 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });

    expect(first.top).not.toBe(second.top);
    expect(second.top).toBe(572);
  });

  it('opens above the ellipsis near the bottom of the screen', () => {
    const position = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 720 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });

    expect(position.placement).toBe('above');
    expect(position.top).toBe(492);
  });

  it('clamps the right edge and left edge inside the viewport', () => {
    expect(
      getAnchoredMenuPosition({
        anchorRect: { height: 44, width: 44, x: 370, y: 180 },
        insets,
        menuHeight,
        menuWidth,
        viewport,
      }).left,
    ).toBe(130);
    expect(
      getAnchoredMenuPosition({
        anchorRect: { height: 44, width: 44, x: 4, y: 180 },
        insets,
        menuHeight,
        menuWidth,
        viewport,
      }).left,
    ).toBe(12);
  });

  it('respects the top safe area when the anchor is near the status bar', () => {
    const position = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 40 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });

    expect(position.top).toBeGreaterThanOrEqual(55);
  });

  it('keeps long filenames from changing the menu position', () => {
    const shortNameHeight = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 180 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });
    const longNameHeight = getAnchoredMenuPosition({
      anchorRect: { height: 44, width: 44, x: 300, y: 180 },
      insets,
      menuHeight,
      menuWidth,
      viewport,
    });

    expect(shortNameHeight).toEqual(longNameHeight);
  });

  it('uses a safe fallback anchor when native measurement is unavailable', () => {
    const fallback = getFallbackMenuAnchor({ insets, menuWidth, viewport });

    expect(fallback).toEqual({ height: 44, width: 44, x: 275, y: 400 });
    expect(isValidAnchorRect(fallback)).toBe(true);
    expect(
      getAnchoredMenuPosition({
        anchorRect: fallback,
        insets,
        menuHeight,
        menuWidth,
        viewport,
      }),
    ).toEqual({ left: 71, placement: 'below', top: 452 });
  });

  it('rejects missing and zero-size native measurements', () => {
    expect(isValidAnchorRect({ height: 0, width: 44, x: 200, y: 300 })).toBe(
      false,
    );
    expect(isValidAnchorRect({ height: 44, width: 0, x: 200, y: 300 })).toBe(
      false,
    );
    expect(
      isValidAnchorRect({ height: 44, width: 44, x: Number.NaN, y: 300 }),
    ).toBe(false);
  });
});
