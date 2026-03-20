import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseCpu(cpu: string): number {
  if (!cpu) return 0;
  if (cpu.endsWith('m')) return parseInt(cpu, 10);
  return parseFloat(cpu) * 1000;
}

export function parseMemory(memory: string): number {
  if (!memory) return 0;
  if (memory.endsWith('Ki')) return parseInt(memory, 10) * 1024;
  if (memory.endsWith('Mi')) return parseInt(memory, 10) * 1024 * 1024;
  if (memory.endsWith('Gi')) return parseInt(memory, 10) * 1024 * 1024 * 1024;
  if (memory.endsWith('Ti')) return parseInt(memory, 10) * 1024 * 1024 * 1024 * 1024;
  return parseInt(memory, 10);
}
