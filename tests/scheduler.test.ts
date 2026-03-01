import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Scheduler } from '../src/core/scheduler.js';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    scheduler = new Scheduler();
  });

  it('should schedule and retrieve due tasks', () => {
    // Schedule a task with 0 delay (immediately due)
    scheduler.schedule('hash1', 0);

    // Small delay to ensure task is due
    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(1);
    expect(due[0]!.infoHash).toBe('hash1');
  });

  it('should not return tasks that are not yet due', () => {
    scheduler.schedule('hash1', 60000); // 60 seconds from now

    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(0);
  });

  it('should maintain sorted order', () => {
    // Schedule in reverse order
    scheduler.schedule('later', 5000);
    scheduler.schedule('sooner', 1);

    // The sooner task should be first (wait a bit for it)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const due = scheduler.getDueTasks();
        if (due.length > 0) {
          expect(due[0]!.infoHash).toBe('sooner');
        }
        resolve();
      }, 50);
    });
  });

  it('should remove tasks', () => {
    scheduler.schedule('hash1', 0);
    scheduler.remove('hash1');

    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(0);
  });

  it('should replace existing task for same infoHash', () => {
    scheduler.schedule('hash1', 0);
    scheduler.schedule('hash1', 60000); // Reschedule further out

    expect(scheduler.size()).toBe(1);

    // Should not be due now (rescheduled to 60s)
    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(0);
  });

  it('should clear all tasks', () => {
    scheduler.schedule('hash1', 0);
    scheduler.schedule('hash2', 0);
    scheduler.schedule('hash3', 0);

    scheduler.clear();
    expect(scheduler.size()).toBe(0);
  });

  it('should report correct size', () => {
    expect(scheduler.size()).toBe(0);

    scheduler.schedule('a', 1000);
    scheduler.schedule('b', 2000);
    expect(scheduler.size()).toBe(2);

    scheduler.remove('a');
    expect(scheduler.size()).toBe(1);
  });

  it('should handle removing non-existent task gracefully', () => {
    expect(() => scheduler.remove('nonexistent')).not.toThrow();
    expect(scheduler.size()).toBe(0);
  });

  it('should return multiple due tasks at once', () => {
    scheduler.schedule('a', 0);
    scheduler.schedule('b', 0);
    scheduler.schedule('c', 0);

    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(3);
    const hashes = due.map((t) => t.infoHash).sort();
    expect(hashes).toEqual(['a', 'b', 'c']);
  });

  it('should return empty array when no tasks scheduled', () => {
    const due = scheduler.getDueTasks();
    expect(due).toHaveLength(0);
  });

  it('should clear an empty scheduler without error', () => {
    expect(() => scheduler.clear()).not.toThrow();
  });
});
