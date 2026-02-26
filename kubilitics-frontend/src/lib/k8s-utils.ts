/**
 * parseQuantityToNum converts a Kubernetes quantity string (e.g. "500m", "1Gi", "128Mi")
 * to a pure number for comparison and calculation.
 *
 * Units handled:
 * - CPU: m (milli-cores)
 * - Memory: Ki, Mi, Gi, Ti, Pi, Ei (binary powers of 1024)
 * - Memory: k, M, G, T, P, E (decimal powers of 1000)
 */
export function parseQuantityToNum(q: string | number | undefined | null): number | null {
    if (q === undefined || q === null || q === '') return null;
    if (typeof q === 'number') return q;

    const s = String(q).trim();
    if (s === '0') return 0;

    // Regular expression to match number and unit
    // Matches: "100", "500m", "1.5Gi", "1024Ki"
    const match = s.match(/^([0-9.]+)([a-zA-Z]*)$/);
    if (!match) return null;

    const value = parseFloat(match[1]);
    const unit = match[2];

    if (isNaN(value)) return null;
    if (!unit) return value;

    const multipliers: Record<string, number> = {
        'n': 1e-9,
        'u': 1e-6,
        'm': 1e-3,
        'k': 1e3,
        'M': 1e6,
        'G': 1e9,
        'T': 1e12,
        'P': 1e15,
        'E': 1e18,
        'Ki': 1024,
        'Mi': 1024 ** 2,
        'Gi': 1024 ** 3,
        'Ti': 1024 ** 4,
        'Pi': 1024 ** 5,
        'Ei': 1024 ** 6,
    };

    const multiplier = multipliers[unit];
    if (multiplier !== undefined) {
        return value * multiplier;
    }

    return value;
}

/**
 * formatUsagePercent calculates the usage percentage between 'used' and 'hard' quantities.
 */
export function formatUsagePercent(used: string | undefined | null, hard: string | undefined | null): number | null {
    const uNum = parseQuantityToNum(used || '0');
    const hNum = parseQuantityToNum(hard);

    if (hNum === null || hNum <= 0 || uNum === null) return null;
    return Math.round((uNum / hNum) * 100);
}
