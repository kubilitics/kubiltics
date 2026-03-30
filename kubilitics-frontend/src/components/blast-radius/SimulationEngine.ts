/**
 * SimulationEngine — Pure TypeScript class for wave-by-wave failure simulation.
 *
 * Fires discrete 800ms wave steps using setTimeout (not rAF).
 * Each wave callback receives the wave index and cumulative set of affected node IDs.
 */
import type { BlastWave } from '@/services/api/types';

export class SimulationEngine {
  private waves: BlastWave[];
  private currentWave: number;
  private isRunning: boolean;
  private timerId: ReturnType<typeof setTimeout> | null;
  private onWaveCallback: ((wave: number, affectedNodes: Set<string>) => void) | null;
  private onCompleteCallback: (() => void) | null;
  private cumulativeAffected: Set<string>;

  private static readonly WAVE_INTERVAL_MS = 800;

  constructor(waves: BlastWave[]) {
    this.waves = waves;
    this.currentWave = -1;
    this.isRunning = false;
    this.timerId = null;
    this.onWaveCallback = null;
    this.onCompleteCallback = null;
    this.cumulativeAffected = new Set<string>();
  }

  /** Begin the wave-by-wave animation from the current position. */
  start(): void {
    if (this.isRunning) return;
    if (this.currentWave >= this.waves.length - 1) {
      // Already at the end — reset first
      this.reset();
    }
    this.isRunning = true;
    this.scheduleNextWave();
  }

  /** Pause the simulation at the current wave. */
  stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  /** Reset to the beginning — clears all accumulated state. */
  reset(): void {
    this.stop();
    this.currentWave = -1;
    this.cumulativeAffected = new Set<string>();
  }

  /** Register a callback fired when each wave completes. */
  onWave(cb: (wave: number, affectedNodes: Set<string>) => void): void {
    this.onWaveCallback = cb;
  }

  /** Register a callback fired when the entire simulation completes. */
  onComplete(cb: () => void): void {
    this.onCompleteCallback = cb;
  }

  getCurrentWave(): number {
    return this.currentWave;
  }

  getTotalWaves(): number {
    return this.waves.length;
  }

  /** Returns all node IDs affected up to and including the current wave. */
  getAffectedNodes(): Set<string> {
    return new Set(this.cumulativeAffected);
  }

  isActive(): boolean {
    return this.isRunning;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private scheduleNextWave(): void {
    this.timerId = setTimeout(() => {
      this.advanceWave();
    }, SimulationEngine.WAVE_INTERVAL_MS);
  }

  private advanceWave(): void {
    if (!this.isRunning) return;

    this.currentWave += 1;
    if (this.currentWave >= this.waves.length) {
      this.isRunning = false;
      this.onCompleteCallback?.();
      return;
    }

    // Add resources from this wave to cumulative set
    const wave = this.waves[this.currentWave];
    for (const resource of wave.resources) {
      const nodeId = `${resource.kind}/${resource.namespace}/${resource.name}`;
      this.cumulativeAffected.add(nodeId);
    }

    this.onWaveCallback?.(this.currentWave, this.getAffectedNodes());

    // Schedule next wave
    if (this.currentWave < this.waves.length - 1) {
      this.scheduleNextWave();
    } else {
      this.isRunning = false;
      this.onCompleteCallback?.();
    }
  }
}
