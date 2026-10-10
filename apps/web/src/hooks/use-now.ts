"use client";

import { useSyncExternalStore } from "react";

/*
 * One shared one-second clock. Every ticking consumer subscribes to the same
 * interval, so N running timers cost one timer and update in the same frame;
 * the interval stops when the last consumer leaves.
 */
let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    current = Date.now();
    timer = setInterval(() => {
      current = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const idle = () => () => {};
// Stable between ticks, as useSyncExternalStore requires. Subscribing
// refreshes it, and React re-reads it right after subscribing, so a timer
// that mounts while the clock was stopped never shows a stale time.
const read = () => current;

/**
 * Current time, ticking once a second while `active` (frozen otherwise).
 * Keep the consumer as small as possible (a timer label, not a list): each
 * tick re-renders it.
 */
export function useNow(active: boolean) {
  return useSyncExternalStore(active ? subscribe : idle, read, read);
}
