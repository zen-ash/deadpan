import { makeRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '@deadpan/shared';
import { useState } from 'react';

export function Landing() {
  const [code, setCode] = useState('');
  const valid = normalizeRoomCode(code);

  return (
    <main className="center-page landing">
      <h1 className="wordmark big">DEADPAN</h1>
      <p className="tagline">One of you is lying. The detective is listening.</p>

      <button className="button primary huge" onClick={() => location.assign(`/host/${makeRoomCode()}`)}>
        Create a room
      </button>
      <p className="muted small">Do this on the laptop that will be the big screen.</p>

      <form
        className="join-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) location.assign(`/play/${valid}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={ROOM_CODE_LENGTH}
          placeholder="CODE"
          aria-label="Room code"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        <button className="button" type="submit" disabled={!valid}>
          Join
        </button>
      </form>
      <p className="muted small">
        On a phone, scan the QR code on the big screen, or type <b>{location.host}/play/CODE</b>.
      </p>
    </main>
  );
}
