/**
 * A binary min-heap of (cost, item) pairs in one flat array, for the travel and route searches. Reused across
 * searches without allocating; ties leave in the same order every run, so searches stay deterministic.
 */
export class CostHeap {
  private readonly entries: number[] = [];

  get size() { return this.entries.length / 2; }

  clear() { this.entries.length = 0; }

  push(cost: number, item: number) {
    const heap = this.entries;
    heap.push(cost, item);
    let child = heap.length / 2 - 1;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (heap[parent * 2] <= heap[child * 2]) break;
      [heap[parent * 2], heap[child * 2]] = [heap[child * 2], heap[parent * 2]];
      [heap[parent * 2 + 1], heap[child * 2 + 1]] = [heap[child * 2 + 1], heap[parent * 2 + 1]];
      child = parent;
    }
  }

  /** The cheapest entry, removed: [cost, item]. */
  pop(): [number, number] {
    const heap = this.entries;
    const top: [number, number] = [heap[0], heap[1]];
    const lastItem = heap.pop()!, lastCost = heap.pop()!;
    if (heap.length) {
      heap[0] = lastCost; heap[1] = lastItem;
      let parent = 0;
      const size = heap.length / 2;
      for (;;) {
        const left = parent * 2 + 1, right = left + 1;
        let smallest = parent;
        if (left < size && heap[left * 2] < heap[smallest * 2]) smallest = left;
        if (right < size && heap[right * 2] < heap[smallest * 2]) smallest = right;
        if (smallest === parent) break;
        [heap[parent * 2], heap[smallest * 2]] = [heap[smallest * 2], heap[parent * 2]];
        [heap[parent * 2 + 1], heap[smallest * 2 + 1]] = [heap[smallest * 2 + 1], heap[parent * 2 + 1]];
        parent = smallest;
      }
    }
    return top;
  }
}
