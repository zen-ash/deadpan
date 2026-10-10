// NTP-style clock sync with the server: offset = server time − local time, taken as the
// median of the last five ping/pong exchanges. Exchanges that took much longer than the fastest
// one are left out: a slow round trip is usually lopsided, which skews its offset.

const SAMPLES = 5;

export class ClockSync {
  /** Add to Date.now() to get server time. */
  offset = 0;
  rtt = 0;
  private samples: { offset: number; rtt: number }[] = [];

  get synced() {
    return this.samples.length >= 3;
  }

  /** Feed a pong: `c` is the Date.now() the ping was sent at, `s` the server's clock. */
  onPong(c: number, s: number) {
    const now = Date.now();
    const rtt = now - c;
    if (rtt < 0 || rtt > 10_000) return;
    this.samples.push({ offset: s + rtt / 2 - now, rtt });
    if (this.samples.length > SAMPLES) this.samples.shift();
    const fastest = Math.min(...this.samples.map((x) => x.rtt));
    const good = this.samples.filter((x) => x.rtt <= Math.max(fastest * 2, fastest + 100));
    this.offset = median(good.map((x) => x.offset));
    this.rtt = median(good.map((x) => x.rtt));
  }

  toServer(local: number): number {
    return local + this.offset;
  }

  toLocal(server: number): number {
    return server - this.offset;
  }

  now(): number {
    return Date.now() + this.offset;
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
