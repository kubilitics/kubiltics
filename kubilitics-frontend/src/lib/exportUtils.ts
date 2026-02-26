/**
 * Shared utilities for exporting resource list data as JSON, YAML (data), CSV, and Kubernetes YAML manifests.
 */

export function escapeCsvCell(value: string | number): string {
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function yamlValue(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const s = String(v);
  const needsQuotes =
    s === '' ||
    s.includes('\n') ||
    s.includes(':') ||
    s.includes('#') ||
    /^[\s\-\[\]{}&*!|>'%@`]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Serialize an array of plain objects to YAML (list of maps). */
export function objectsToYaml(items: Record<string, unknown>[]): string {
  const lines: string[] = [];
  for (const obj of items) {
    const entries = Object.entries(obj);
    if (entries.length === 0) {
      lines.push('- {}');
      continue;
    }
    const [firstKey, firstVal] = entries[0];
    lines.push(`- ${firstKey}: ${yamlValue(firstVal as string | number)}`);
    for (let i = 1; i < entries.length; i++) {
      const [k, v] = entries[i];
      lines.push(`  ${k}: ${yamlValue(v as string | number)}`);
    }
  }
  return lines.join('\n');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Build CSV string from headers and row arrays (values already escaped). */
export function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) => row.join(','));
  return [headerLine, ...dataLines].join('\n');
}

/** Download a single resource (or any object) as JSON. Use on detail pages for "Export as JSON". */
export function downloadResourceJson(resource: object, filename: string): void {
  const blob = new Blob([JSON.stringify(resource, null, 2)], { type: 'application/json' });
  downloadBlob(blob, filename);
}
