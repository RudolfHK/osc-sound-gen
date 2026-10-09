/// <reference lib="webworker" />
/**
 * A metronome for the schedulers. Browsers throttle main-thread timers in
 * background tabs (to once a second, or less), far longer than the 120 ms the
 * schedulers look ahead — playback would break up as soon as the tab lost
 * focus. Timers inside a worker keep running, so the tick comes from here.
 */

export type TickerRequest = { cmd: 'start'; ms: number } | { cmd: 'stop' };

let timer: ReturnType<typeof setInterval> | null = null;

self.onmessage = (e: MessageEvent<TickerRequest>) => {
  if (timer !== null) clearInterval(timer);
  timer = null;
  if (e.data.cmd === 'start') {
    timer = setInterval(() => (self as unknown as Worker).postMessage(0), e.data.ms);
  }
};
