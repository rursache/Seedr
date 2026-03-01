import { createLogger } from '../utils/logger.js';

const logger = createLogger('scheduler');

export interface ScheduledTask {
  infoHash: string;
  nextRun: number; // timestamp ms
}

/**
 * Priority queue scheduler for announce timing.
 * Sorted by next run time. Polled every second by the seed manager.
 */
export class Scheduler {
  private queue: ScheduledTask[] = [];

  schedule(infoHash: string, delayMs: number): void {
    // Add +-10% jitter to the interval
    const jitter = 0.9 + Math.random() * 0.2;
    const nextRun = Date.now() + Math.floor(delayMs * jitter);

    // Remove existing entry for this torrent
    this.queue = this.queue.filter((t) => t.infoHash !== infoHash);

    // Insert sorted by nextRun
    const idx = this.queue.findIndex((t) => t.nextRun > nextRun);
    if (idx === -1) {
      this.queue.push({ infoHash, nextRun });
    } else {
      this.queue.splice(idx, 0, { infoHash, nextRun });
    }

    logger.debug(
      { infoHash: infoHash.slice(0, 8), delayMs: Math.floor(delayMs * jitter) },
      'Scheduled announce'
    );
  }

  /**
   * Get all tasks that are due (nextRun <= now).
   * Removes them from the queue.
   */
  getDueTasks(): ScheduledTask[] {
    const now = Date.now();
    const due: ScheduledTask[] = [];

    while (this.queue.length > 0 && this.queue[0]!.nextRun <= now) {
      due.push(this.queue.shift()!);
    }

    return due;
  }

  remove(infoHash: string): void {
    this.queue = this.queue.filter((t) => t.infoHash !== infoHash);
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }

  getNextRunTime(infoHash: string): number | null {
    const task = this.queue.find((t) => t.infoHash === infoHash);
    return task ? task.nextRun : null;
  }
}
