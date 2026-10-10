import { useEffect, useRef } from 'react';
import { anchors } from './anchors';
import type { SuspectView } from './Room';
import { SuspectCard } from './SuspectCard';

/**
 * The suspect cards, as ordinary page elements over the room. Each frame they're moved to just
 * under their face, using the positions the 3D scene projects into `anchors`.
 */
export function SuspectCards({ suspects, activeId }: { suspects: SuspectView[]; activeId: string | null }) {
  const refs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    let frame = requestAnimationFrame(function place() {
      for (const [id, el] of refs.current) {
        const a = anchors.get(id);
        if (!a) continue;
        el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px) translateX(-50%) scale(${a.scale.toFixed(3)})`;
        el.style.opacity = '1';
      }
      frame = requestAnimationFrame(place);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="suspect-cards">
      {suspects.map((s) => (
        <div
          key={s.player.id}
          className="card-anchor"
          ref={(el) => {
            if (el) refs.current.set(s.player.id, el);
            else refs.current.delete(s.player.id);
          }}
        >
          <SuspectCard
            player={s.player}
            drift={s.drift}
            lastAnswer={s.lastAnswer}
            active={activeId === s.player.id}
            benched={s.benched}
            badge={s.badge}
          />
        </div>
      ))}
    </div>
  );
}
