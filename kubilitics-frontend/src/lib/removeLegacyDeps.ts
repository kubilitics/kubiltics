/**
 * removeLegacyDeps — Identifies Three.js, Cytoscape, and other legacy 3D/graph
 * library imports that should be removed from the codebase.
 *
 * Decision: see topology3dEvaluation.md — we standardize on @xyflow/react.
 *
 * Usage:
 *   Run as a script:  npx tsx src/lib/removeLegacyDeps.ts
 *   Import in tests:  import { LEGACY_PACKAGES, scanForLegacyImports } from './removeLegacyDeps'
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, extname } from 'path';

// ─── Legacy packages that should NOT be in the codebase ─────────────────────

export const LEGACY_PACKAGES = [
  // Three.js ecosystem
  'three',
  '@react-three/fiber',
  '@react-three/drei',
  '@react-three/postprocessing',
  '@react-three/rapier',

  // Cytoscape ecosystem
  'cytoscape',
  'cytoscape-dagre',
  'cytoscape-cola',
  'cytoscape-cose-bilkent',
  'cytoscape-fcose',
  'react-cytoscapejs',

  // Other graph/3D libraries superseded by @xyflow/react
  'sigma',
  'graphology',
  'graphology-layout',
  'graphology-layout-forceatlas2',
  'vis-network',
  'vis-data',
  'd3-force',
  'd3-force-3d',
  'ngraph.graph',
  'ngraph.forcelayout',
] as const;

export type LegacyPackage = (typeof LEGACY_PACKAGES)[number];

// ─── Import detection patterns ──────────────────────────────────────────────

const IMPORT_PATTERNS = LEGACY_PACKAGES.map((pkg) => ({
  package: pkg,
  // Match: import ... from 'pkg' / import ... from "pkg" / require('pkg') / require("pkg")
  regex: new RegExp(
    `(?:import\\s+.*?from\\s+['"]${escapeRegex(pkg)}(?:/[^'"]*)?['"]|require\\s*\\(\\s*['"]${escapeRegex(pkg)}(?:/[^'"]*)?['"]\\s*\\))`,
    'gm',
  ),
}));

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LegacyImportHit {
  file: string;
  line: number;
  content: string;
  package: string;
}

export interface PackageJsonHit {
  package: string;
  section: 'dependencies' | 'devDependencies' | 'peerDependencies';
  version: string;
}

export interface ScanResult {
  imports: LegacyImportHit[];
  packageJsonHits: PackageJsonHit[];
  clean: boolean;
}

// ─── Scanner ────────────────────────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.vite', 'coverage']);

/**
 * Scan a directory tree for legacy 3D/graph library imports.
 */
export function scanForLegacyImports(rootDir: string): ScanResult {
  const imports: LegacyImportHit[] = [];
  const packageJsonHits: PackageJsonHit[] = [];

  // Scan source files
  walkDir(rootDir, (filePath) => {
    const ext = extname(filePath);
    if (!SCAN_EXTENSIONS.has(ext)) return;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const pattern of IMPORT_PATTERNS) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.regex.test(lines[i])) {
          imports.push({
            file: relative(rootDir, filePath),
            line: i + 1,
            content: lines[i].trim(),
            package: pattern.package,
          });
        }
        // Reset regex lastIndex since we use 'g' flag
        pattern.regex.lastIndex = 0;
      }
    }
  });

  // Scan package.json
  try {
    const pkgPath = join(rootDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    const sections = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

    for (const section of sections) {
      const deps = pkg[section] ?? {};
      for (const legacyPkg of LEGACY_PACKAGES) {
        if (legacyPkg in deps) {
          packageJsonHits.push({
            package: legacyPkg,
            section,
            version: deps[legacyPkg],
          });
        }
      }
    }
  } catch {
    // package.json not found or invalid — skip
  }

  return {
    imports,
    packageJsonHits,
    clean: imports.length === 0 && packageJsonHits.length === 0,
  };
}

function walkDir(dir: string, callback: (filePath: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (stat.isFile()) {
      callback(fullPath);
    }
  }
}

// ─── CLI Entry Point ────────────────────────────────────────────────────────

function main(): void {
  const rootDir = process.argv[2] ?? process.cwd();

  const result = scanForLegacyImports(rootDir);

  if (result.clean) {
    process.exit(0);
  }

  const total = result.imports.length + result.packageJsonHits.length;
  process.exit(1);
}

// Run if executed directly (not imported)
if (typeof require !== 'undefined' && require.main === module) {
  main();
} else if (import.meta.url && import.meta.url.endsWith(process.argv[1] ?? '')) {
  main();
}
