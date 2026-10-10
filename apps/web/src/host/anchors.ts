// Where each suspect's card should sit on screen, written by the 3D scene every frame and read by
// the card overlay. Kept outside React so moving the cards never re-renders anything.

export interface Anchor {
  /** CSS pixels from the top-left of the room canvas. */
  x: number;
  y: number;
  /** Shrinks cards as the camera pulls back for more players. */
  scale: number;
}

export const anchors = new Map<string, Anchor>();
