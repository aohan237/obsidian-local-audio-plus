interface QueueItem<T> {
  value: T;
  attempts: number;
}

export class UniqueQueue<T> {
  private queue: QueueItem<T>[] = [];

  push(value: T, attempts: number): void {
    if (attempts < 1) return;
    this.remove(value);
    this.queue.push({ value, attempts });
  }

  remove(value: T): void {
    this.queue = this.queue.filter((item) => item.value !== value);
  }

  clear(): void {
    this.queue = [];
  }

  iterationQueue(): T[] {
    const next = new UniqueQueue<T>();
    const iteration: T[] = [];

    for (const item of this.queue) {
      iteration.push(item.value);
      if (item.attempts > 1) {
        next.push(item.value, item.attempts - 1);
      }
    }

    this.queue = next.queue;
    return iteration;
  }
}
