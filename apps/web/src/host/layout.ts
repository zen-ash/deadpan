// Where each suspect's face and card go on the big screen, worked out in screen pixels from the
// free area: right of the join panel and under "The lineup." in the lobby; below the detective's
// line (measured from the page) during a round. The 3D faces and the DOM cards read the same slots.

/** nametag: just the name, under the face, on a phone-sized screen (a replay opened from a phone). */
export type CardVariant = 'lobby' | 'full' | 'compact' | 'nametag';

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Slot {
  /** Face centre and height, in CSS pixels. */
  faceX: number;
  faceY: number;
  faceH: number;
  /** Card top-left corner and scale. */
  cardX: number;
  cardY: number;
  cardScale: number;
  variant: CardVariant;
}

/**
 * Design size of each card at scale 1. Fonts are sized so that at the smallest scale the layout
 * allows (about 0.85) the text is still readable from about 2 m away.
 */
export const CARD_SIZE: Record<CardVariant, { w: number; h: number }> = {
  lobby: { w: 270, h: 112 },
  full: { w: 320, h: 340 },
  compact: { w: 300, h: 232 },
  nametag: { w: 150, h: 58 },
};

/** Below this width (a phone) the screen gets the narrow layout: faces in a grid with name tags. */
export const NARROW_W = 560;

/** Face width over height, for the meshes. */
const FACE_ASPECT = 0.8;
/** Width a face takes beside its card, leaving room for the gold ring. */
const FACE_BOX = 0.95;
const GAP = 16;
const ROW_GAP = 28;
const BESIDE_GAP = 22;
const MAX_SCALE = 1.15;
/** The most of a row's height a card under its face may take: readable text comes first. */
const CARD_SHARE = 0.68;

/**
 * During a round, up to 4 suspects share one row with cards under their faces, and 5–6 go in two
 * rows (3 + 3 or 3 + 2) with compact cards beside the faces so both rows fit. The lobby is
 * narrower (the join panel takes the left) but its cards are short, so it goes to two rows from 4.
 */
export function layoutSuspects(n: number, area: Area, inRound: boolean, viewportH: number, narrow = false): Slot[] {
  if (n <= 0 || area.w <= 0 || area.h <= 0) return [];
  if (narrow) return layoutNarrow(n, area, viewportH);
  const twoRows = n >= (inRound ? 5 : 4);
  const rows = twoRows ? [Math.ceil(n / 2), Math.floor(n / 2)] : [n];
  const perRow = rows[0]!;
  const variant: CardVariant = !inRound ? 'lobby' : twoRows ? 'compact' : 'full';
  const card = CARD_SIZE[variant];
  const beside = variant === 'compact';
  const slotW = area.w / perRow;
  const rowH = area.h / rows.length;

  let scale: number;
  let faceH: number;
  if (beside) {
    scale = Math.min(MAX_SCALE, (slotW * 0.62) / card.w, (rowH * 0.9) / card.h);
    faceH = Math.min(rowH * 0.86, (slotW * 0.96 - card.w * scale - BESIDE_GAP) / FACE_BOX, viewportH * 0.3);
  } else {
    scale = Math.min(MAX_SCALE, (slotW * 0.9) / card.w, (rowH * CARD_SHARE) / card.h);
    // Two rows keep a gap, so the lower faces don't touch the cards above them.
    const rowGap = rows.length > 1 ? ROW_GAP : 0;
    faceH = Math.min(rowH - card.h * scale - GAP - rowGap, (slotW * 0.8) / FACE_ASPECT, viewportH * (inRound ? 0.28 : 0.3));
  }
  faceH = Math.max(48, faceH);
  const blockH = beside ? Math.max(faceH, card.h * scale) : faceH + GAP + card.h * scale;

  const slots: Slot[] = [];
  rows.forEach((count, r) => {
    const rowTop = area.y + r * rowH + Math.max(0, (rowH - blockH) / 2);
    // A shorter second row is centred under the first.
    const rowLeft = area.x + (area.w - count * slotW) / 2;
    for (let i = 0; i < count && slots.length < n; i++) {
      const slotX = rowLeft + i * slotW;
      if (beside) {
        const faceW = faceH * FACE_BOX;
        const left = slotX + (slotW - (faceW + BESIDE_GAP + card.w * scale)) / 2;
        const faceY = rowTop + blockH / 2;
        slots.push({
          faceX: left + faceW / 2,
          faceY,
          faceH,
          cardX: left + faceW + BESIDE_GAP,
          cardY: faceY - (card.h * scale) / 2,
          cardScale: scale,
          variant,
        });
      } else {
        const faceX = slotX + slotW / 2;
        slots.push({
          faceX,
          faceY: rowTop + faceH / 2,
          faceH,
          cardX: faceX - (card.w * scale) / 2,
          cardY: rowTop + faceH + GAP,
          cardScale: scale,
          variant,
        });
      }
    }
  });
  return slots;
}

/** A phone-sized screen: up to 3 faces a row, each with its name tag under it, centred in the area. */
function layoutNarrow(n: number, area: Area, viewportH: number): Slot[] {
  const cols = Math.min(n, 3);
  const rows = Math.ceil(n / cols);
  const slotW = area.w / cols;
  const tag = CARD_SIZE.nametag;
  const scale = Math.min(1, (slotW - 8) / tag.w);
  const rowH = (area.h - (rows - 1) * GAP) / rows;
  const faceH = Math.max(40, Math.min(rowH - tag.h * scale - 8, (slotW * 0.72) / FACE_ASPECT, viewportH * 0.3));
  const blockH = faceH + 8 + tag.h * scale;
  const top = area.y + Math.max(0, (area.h - (rows * blockH + (rows - 1) * GAP)) / 2);
  const slots: Slot[] = [];
  for (let r = 0; r < rows; r++) {
    const count = Math.min(cols, n - r * cols);
    const left = area.x + (area.w - count * slotW) / 2;
    for (let i = 0; i < count; i++) {
      const faceX = left + i * slotW + slotW / 2;
      const rowTop = top + r * (blockH + GAP);
      slots.push({
        faceX,
        faceY: rowTop + faceH / 2,
        faceH,
        cardX: faceX - (tag.w * scale) / 2,
        cardY: rowTop + faceH + 8,
        cardScale: scale,
        variant: 'nametag',
      });
    }
  }
  return slots;
}

export interface Reserved {
  /** Left edge of the free area: right of the lobby's join panel, or the screen margin. */
  left: number;
  /** Top edge: below "The lineup." or the detective's line. */
  top: number;
  /** Space kept clear along the bottom, for the evidence chips. */
  bottom: number;
}

/** The free area for suspects, given the window and what the overlay covers. */
export function stageArea(viewport: { w: number; h: number }, reserved: Reserved): Area {
  const margin = 24;
  const x = Math.max(margin, reserved.left);
  const y = Math.max(margin, reserved.top);
  return { x, y, w: viewport.w - x - margin, h: viewport.h - y - Math.max(margin, reserved.bottom) };
}

/** The square box, in CSS pixels, of a circle drawn around a slot's face. */
export function ringBox(slot: Slot, k = 1.18) {
  const d = slot.faceH * k;
  return { x: slot.faceX - d / 2, y: slot.faceY - d / 2, d };
}
