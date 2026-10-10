import type { Slot } from './layout';
import type { SuspectView } from './Room';
import { SuspectCard } from './SuspectCard';

/** The suspect cards, as ordinary page elements over the room, at the slots from layout.ts. */
export function SuspectCards({ suspects, slots, activeId }: { suspects: SuspectView[]; slots: Slot[]; activeId: string | null }) {
  return (
    <div className="suspect-cards">
      {suspects.map((s, i) => {
        const slot = slots[i];
        if (!slot) return null;
        return (
          <div
            key={s.player.id}
            className="card-anchor"
            style={{ transform: `translate(${slot.cardX.toFixed(1)}px, ${slot.cardY.toFixed(1)}px) scale(${slot.cardScale.toFixed(3)})` }}
          >
            <SuspectCard
              player={s.player}
              variant={slot.variant}
              drift={s.drift}
              lastAnswer={s.lastAnswer}
              active={activeId === s.player.id}
              benched={s.benched}
              badge={s.badge}
            />
          </div>
        );
      })}
    </div>
  );
}
