import { makeRoomCode, MAX_PLAYERS, normalizeRoomCode, ROOM_CODE_LENGTH } from '@deadpan/shared';
import { useState } from 'react';
import { Emblems, LockIcon, numberWord } from '../ui';

export function Landing() {
  const [code, setCode] = useState('');
  const valid = normalizeRoomCode(code);

  return (
    <div className="landing">
      <header className="site-bar">
        <span className="wordmark">DEADPAN</span>
        <span className="site-bar-aside">A party game for up to {numberWord(MAX_PLAYERS)} players</span>
      </header>

      <main className="landing-main">
        <Emblems />
        <h1 className="landing-title">Deadpan.</h1>
        <p className="landing-tagline">One of you is lying. The detective is listening.</p>

        <div className="landing-create">
          <button className="btn black" onClick={() => location.assign(`/host/${makeRoomCode()}`)}>
            Create a room
          </button>
          <p className="helper">Do this on the laptop that will be the big screen.</p>
        </div>

        <p className="divider">or join a room</p>

        <form
          className="landing-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) location.assign(`/play/${valid}`);
          }}
        >
          <div className="join-pill">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={ROOM_CODE_LENGTH}
              placeholder="Room code"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <button className="btn soft" type="submit" disabled={!valid}>
              Join
            </button>
          </div>
          <p className="helper">On a phone? Scan the QR code on the big screen.</p>
        </form>

        <p className="footnote">
          <LockIcon />
          <span>Video never leaves your phone. Only numbers do.</span>
        </p>
      </main>
    </div>
  );
}
