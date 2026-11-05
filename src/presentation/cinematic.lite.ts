/** LITE stand-in for presentation/cinematic.ts: there is no cinematic space in the Telegram package. */
import type { CinematicChange, CinematicContext, CinematicLevel } from "./full/cinematicController";
export type { CinematicLevel, CinematicContext, CinematicChange };

export function cinematicCeiling(_tier: "basic" | "enhanced" | "ultra", _flagship: boolean): CinematicLevel {
  return 0;
}

export class CinematicSpace {
  readonly currentLevel: CinematicLevel = 0;
  constructor(_scene: unknown, _seed: number) {}
  force(_level: CinematicLevel | null): void {}
  update(_dt: number, _fade: number, _ctx: CinematicContext): CinematicChange | null {
    return null;
  }
  stats(): { level: CinematicLevel; baseline: unknown; changes: unknown[]; blocked: number[] } {
    return { level: 0, baseline: null, changes: [], blocked: [] };
  }
  dispose(): void {}
}
