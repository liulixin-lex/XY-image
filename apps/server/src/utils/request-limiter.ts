// In-process and bounded: deploy one API instance until a shared limiter is added.
export class RequestLimiter {
  private readonly windows = new Map<
    string,
    { count: number; until: number }
  >();
  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly maxEntries = 4096,
  ) {}

  take(key: string, now = Date.now()): number {
    let window = this.windows.get(key);
    if (!window || window.until <= now) {
      if (this.windows.size >= this.maxEntries) {
        for (const [id, item] of this.windows) {
          if (item.until <= now) this.windows.delete(id);
        }
        // Do not evict active windows: rotating identities must not reset limits.
        if (!this.windows.has(key) && this.windows.size >= this.maxEntries)
          return Math.ceil(this.windowMs / 1000);
      }
      window = { count: 0, until: now + this.windowMs };
      this.windows.set(key, window);
    }
    if (++window.count > this.limit)
      return Math.max(1, Math.ceil((window.until - now) / 1000));
    return 0;
  }
}
