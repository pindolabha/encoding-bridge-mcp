export class PathMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(pathKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(pathKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.tails.set(pathKey, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(pathKey) === tail) this.tails.delete(pathKey);
    }
  }
}

export const pathMutex = new PathMutex();
