import { EPGProgram } from '../types/iptv';

export class EPGService {
  public static getCurrentProgram(programs: EPGProgram[]): EPGProgram | null {
    const now = Date.now();
    return programs.find((p) => now >= p.start && now < p.end) || programs[0] || null;
  }

  public static getNextProgram(programs: EPGProgram[]): EPGProgram | null {
    const now = Date.now();
    const currentIndex = programs.findIndex((p) => now >= p.start && now < p.end);
    if (currentIndex !== -1 && currentIndex + 1 < programs.length) {
      return programs[currentIndex + 1];
    }
    return programs.find((p) => p.start > now) || null;
  }

  public static getProgressPercentage(program: EPGProgram): number {
    const now = Date.now();
    if (now <= program.start) return 0;
    if (now >= program.end) return 100;
    const total = program.end - program.start;
    const elapsed = now - program.start;
    return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
  }

  public static formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  public static formatDuration(startMs: number, endMs: number): string {
    const totalMins = Math.round((endMs - startMs) / (60 * 1000));
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    if (hours > 0) {
      return `${hours}h ${mins.toString().padStart(2, '0')}m`;
    }
    return `${mins} min`;
  }

  public static getRemainingMinutes(program: EPGProgram): number {
    const now = Date.now();
    if (now >= program.end) return 0;
    return Math.max(0, Math.round((program.end - now) / (60 * 1000)));
  }
}
