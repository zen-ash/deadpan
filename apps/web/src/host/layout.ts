// Where each suspect's face and card go on the big screen, worked out in screen pixels from the
// free area: right of the QR panel in the lobby, the full width between the subtitles and the
// evidence chips during a round. The 3D faces and the DOM cards both read the same slots.

export type CardVariant = 'lobby' | 'full' | 'compact';

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
  lobby: { w: 270, h: 104 },
  full: { w: 330, h: 316 },
  compact: { w: 300, h: 206 },
};

/** Face width over height, for the neon meshes. */
const FACE_ASPECT = 0.8;
/** Width a face takes beside its card, leaving room for the calibration ring. */
const FACE_BOX = 0.9;
const GAP = 14;
const BESIDE_GAP = 18;
const MAX_SCALE = 1.15;

/**
 * Up to 4 suspects share one row with cards under their faces. 5–6 go in two rows (3 + 3 or
 * 3 + 2) with compact cards beside their faces, so both rows fit the screen's height.
 */
export function layoutSuspects(n: number, area: Area, inRound: boolean, viewportH: number): Slot[] {
  if (n <= 0 || area.w <= 0 || area.h <= 0) return [];
  const twoRows = n >= 5;
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
    faceH = Math.min(rowH * 0.92, (slotW * 0.96 - card.w * scale - BESIDE_GAP) / FACE_BOX, viewportH * 0.34);
  } else {
    scale = Math.min(MAX_SCALE, (slotW * 0.92) / card.w, (rowH * 0.55) / card.h);
    faceH = Math.min(rowH - card.h * scale - GAP, (slotW * 0.85) / FACE_ASPECT, viewportH * 0.36);
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

/** The free area for suspects, given the window and what the overlay covers. */
export function stageArea(viewport: { w: number; h: number }, inRound: boolean, lobbyPanelRight: number): Area {
  const margin = 24;
  if (!inRound) {
    const x = lobbyPanelRight + margin;
    const y = 64;
    return { x, y, w: viewport.w - x - margin, h: viewport.h - y - margin };
  }
  // Subtitles and the verdict above, evidence chips below.
  const top = Math.max(200, viewport.h * 0.25);
  const bottom = Math.max(72, viewport.h * 0.09);
  return { x: margin, y: top, w: viewport.w - margin * 2, h: viewport.h - top - bottom };
}
