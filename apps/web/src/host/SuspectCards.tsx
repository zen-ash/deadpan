import { ringBox, type Slot } from './layout';
import type { SuspectView } from './Room';
import { SuspectCard, type CardMoment } from './SuspectCard';

/** The face outline from the design, for an empty seat: 200 × 240 units, face 208 tall. */
const SEAT_PATH = 'M100 16C152 16 180 54 181 106C182 162 156 206 100 224C44 206 18 162 19 106C20 54 48 16 100 16Z';

interface Props {
  suspects: SuspectView[];
  /** One slot per suspect, then one for the empty seats if there are any. */
  slots: Slot[];
  /** Seats still free in the lobby; shown as one dashed placeholder. */
  openSeats: number;
  activeId: string | null;
  moment: CardMoment;
}

/** The suspect cards and the things drawn around the faces, as page elements over the 3D room. */
export function SuspectCards({ suspects, slots, openSeats, activeId, moment }: Props) {
  const seat = openSeats > 0 ? slots[suspects.length] : undefined;
  const active = suspects.findIndex((s) => s.player.id === activeId);
  // Gold marks who's on the spot; after the reveal the gold belongs to "See the evidence".
  const ring = active >= 0 && slots[active] && moment !== 'lobby' && moment !== 'revealed' ? ringBox(slots[active]!) : null;
  // The outline is drawn so the face inside it matches a real face's height.
  const seatH = seat ? (seat.faceH * 240) / 208 : 0;
  const seatBox = seat ? { x: seat.faceX - (seatH * 200) / 480, y: seat.faceY - seatH / 2, w: (seatH * 200) / 240, h: seatH } : null;

  return (
    <>
      <div className="face-decor" aria-hidden>
        {ring && (
          <span
            className="face-ring"
            style={{ width: ring.d, height: ring.d, transform: `translate(${ring.x.toFixed(1)}px, ${ring.y.toFixed(1)}px)` }}
          />
        )}
        {seatBox && (
          <svg
            className="seat-outline"
            viewBox="0 0 200 240"
            width={seatBox.w}
            height={seatBox.h}
            style={{ transform: `translate(${seatBox.x.toFixed(1)}px, ${seatBox.y.toFixed(1)}px)` }}
          >
            <path d={SEAT_PATH} vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>

      <div className="suspect-cards">
        {suspects.map((s, i) => {
          const slot = slots[i];
          if (!slot) return null;
          const dimmed =
            !s.benched &&
            ((moment === 'revealed' && !s.stamp) || ((moment === 'calibrating' || moment === 'questioning') && activeId !== null && activeId !== s.player.id));
          return (
            <div
              key={s.player.id}
              className={`card-anchor ${s.benched ? 'benched' : dimmed ? 'dimmed' : ''}`}
              style={{ transform: `translate(${slot.cardX.toFixed(1)}px, ${slot.cardY.toFixed(1)}px) scale(${slot.cardScale.toFixed(3)})` }}
            >
              <SuspectCard
                player={s.player}
                variant={slot.variant}
                moment={moment}
                drift={s.drift}
                lastAnswer={s.lastAnswer}
                active={activeId === s.player.id && moment !== 'revealed'}
                benched={s.benched}
                role={s.role}
                stamp={s.stamp}
              />
            </div>
          );
        })}
        {seat && (
          <div
            className="card-anchor"
            style={{ transform: `translate(${seat.cardX.toFixed(1)}px, ${seat.cardY.toFixed(1)}px) scale(${seat.cardScale.toFixed(3)})` }}
          >
            <div className="open-seat">
              <span className="open-seat-title">
                {openSeats} open {openSeats === 1 ? 'seat' : 'seats'}
              </span>
              <span className="open-seat-sub">Scan the code to join</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
