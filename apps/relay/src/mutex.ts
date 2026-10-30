/** FIFO mutex safe under concurrent waiters (no lost wakeups). */
export class Mutex {
  private locked = false;
  private readonly queue: Array<() => void> = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      if (!this.locked) {
        this.locked = true;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.locked = false;
      }
    }
  }
}
