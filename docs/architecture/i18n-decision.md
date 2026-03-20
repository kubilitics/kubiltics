# i18n Architecture Decision Record

**Status:** Under evaluation
**Audience:** Frontend engineers, product team
**Last updated:** 2026-03-16

---

## Table of Contents

1. [Context](#1-context)
2. [Current State](#2-current-state)
3. [Options: Keep vs Remove i18next](#3-options-keep-vs-remove-i18next)
4. [String Extraction Strategy](#4-string-extraction-strategy)
5. [Recommendation](#5-recommendation)
6. [Implementation Plan](#6-implementation-plan)

---

## 1. Context

Kubilitics is a Kubernetes management platform with desktop and web interfaces. The frontend uses React + TypeScript with i18next installed and configured. The question is whether to invest in full internationalization now, defer it, or remove the i18n infrastructure.

### Key Facts

- Current user base is English-speaking Kubernetes operators.
- The product is open source with a potential global audience.
- The frontend has 100+ pages and 50+ components with hardcoded English strings.
- The i18next setup exists but is minimally used -- most strings are inline English.
- Kubernetes terminology (Pod, Deployment, Service, etc.) is not translated in the community.

---

## 2. Current State

### Installed Packages

```json
{
  "i18next": "^24.2.3",
  "react-i18next": "^15.4.1",
  "i18next-browser-languagedetector": "^8.0.4",
  "i18next-http-backend": "^3.0.2"
}
```

### Configuration

File: `src/i18n/i18n.ts`

```typescript
i18n
  .use(Backend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    debug: import.meta.env.DEV,
    interpolation: { escapeValue: false },
    backend: { loadPath: './locales/{{lng}}/{{ns}}.json' },
  });
```

### Current Usage

- i18next is initialized in `src/main.tsx`.
- Translation files exist in `public/locales/en/`.
- Most components use hardcoded English strings rather than `t()` function calls.
- The `useTranslation` hook is imported in very few components.

### Bundle Impact

| Package | Size (minified + gzipped) |
|---|---|
| i18next | ~8.5 kB |
| react-i18next | ~5.2 kB |
| i18next-browser-languagedetector | ~2.1 kB |
| i18next-http-backend | ~1.8 kB |
| **Total** | **~17.6 kB** |

---

## 3. Options: Keep vs Remove i18next

### Option A: Keep and Invest

**Effort:** High (4-6 weeks for full extraction + first language)

Pros:
- Future-proofs for international users.
- Community contributors can add translations.
- Establishes a consistent string management pattern.
- Language detection and switching infrastructure is already in place.

Cons:
- High upfront cost to extract all strings from 100+ pages.
- Ongoing maintenance burden: every new feature needs translation keys.
- Kubernetes terminology should not be translated (Pod, Deployment, etc.).
- Most competing tools (Lens, k9s, Headlamp) are English-only.
- Translation quality is hard to maintain without native speakers on the team.

### Option B: Remove and Defer

**Effort:** Low (1-2 days to remove)

Pros:
- Removes ~17.6 kB from the bundle.
- Eliminates the cognitive overhead of deciding what to translate.
- Simplifies the component API (no `t()` wrapper on every string).
- Can be re-added later when there is user demand.

Cons:
- Re-adding i18n later requires touching many files.
- Loss of the browser language detection feature.
- May discourage non-English-speaking contributors.

### Option C: Keep Infrastructure, Defer Extraction (Recommended)

**Effort:** Minimal (keep as-is, extract strings incrementally)

Pros:
- Zero cost now -- infrastructure is already set up and working.
- New features can optionally use `t()` for user-facing strings.
- Existing hardcoded strings can be extracted incrementally.
- When a community member offers to translate, the plumbing is ready.
- Bundle cost (~17.6 kB) is minimal relative to the total bundle.

Cons:
- Inconsistency: some strings use `t()`, most do not.
- The `/locales/` directory may be incomplete or stale.

---

## 4. String Extraction Strategy

If Option A or C is chosen, use this strategy for extracting strings.

### What to Translate

| Category | Translate? | Example |
|---|---|---|
| UI labels | Yes | "Save", "Cancel", "Delete" |
| Navigation items | Yes | "Dashboard", "Settings", "Clusters" |
| Error messages | Yes | "Failed to connect to cluster" |
| Descriptions/help text | Yes | "This action cannot be undone" |
| Kubernetes kind names | No | "Pod", "Deployment", "Service" |
| Kubernetes field names | No | "metadata", "spec", "status" |
| YAML content | No | Resource definitions |
| Log output | No | Container log lines |
| API error details | No | Backend error messages |
| Technical identifiers | No | Cluster IDs, namespace names |

### Namespace Organization

```
public/locales/
├── en/
│   ├── common.json        # Shared UI: buttons, labels, navigation
│   ├── dashboard.json     # Dashboard page strings
│   ├── topology.json      # Topology viewer strings
│   ├── clusters.json      # Cluster management strings
│   ├── addons.json        # Add-on marketplace strings
│   ├── settings.json      # Settings page strings
│   ├── errors.json        # Error messages
│   └── onboarding.json    # Onboarding flow strings
├── ja/
│   ├── common.json
│   └── ...
└── zh/
    ├── common.json
    └── ...
```

### Key Naming Convention

Use dot-separated hierarchical keys:

```json
{
  "dashboard.title": "Dashboard",
  "dashboard.clusterCount": "{{count}} cluster",
  "dashboard.clusterCount_plural": "{{count}} clusters",
  "topology.loading": "Generating topology...",
  "topology.empty": "No resources found in this namespace",
  "topology.export.png": "Export as PNG",
  "topology.export.pdf": "Export as PDF",
  "errors.connectionFailed": "Failed to connect to cluster \"{{name}}\"",
  "errors.unauthorized": "You do not have permission to perform this action"
}
```

### Extraction Tooling

Use `i18next-parser` to scan source files and extract translatable strings:

```bash
npx i18next-parser --config i18next-parser.config.js
```

Configuration (`i18next-parser.config.js`):

```javascript
module.exports = {
  locales: ['en'],
  output: 'public/locales/$LOCALE/$NAMESPACE.json',
  input: ['src/**/*.{ts,tsx}'],
  namespaceSeparator: ':',
  keySeparator: '.',
  defaultNamespace: 'common',
  createOldCatalogs: false,
  failOnWarnings: false,
  verbose: true,
};
```

---

## 5. Recommendation

**Option C: Keep infrastructure, defer extraction.**

Rationale:
1. The i18n packages are already installed and configured. Removing them saves only ~17.6 kB (trivial for a desktop app).
2. Full string extraction for 100+ pages is a large project with low ROI today -- the user base is English-speaking Kubernetes operators.
3. Kubernetes terminology is universally English in the community; translating "Pod" to another language would confuse users.
4. Keeping the infrastructure means a community translator can contribute without waiting for plumbing work.
5. New features should use `t()` for user-facing UI strings (buttons, labels, messages) to incrementally build the translation catalog.

### Priority Languages (When Demand Arises)

Based on Kubernetes community demographics:
1. Japanese (ja) -- Large K8s community, active CNCF chapter
2. Chinese Simplified (zh-CN) -- Largest non-English K8s user base
3. Korean (ko) -- Active K8s community
4. German (de) -- Strong European presence
5. Spanish (es) -- Growing Latin American K8s adoption

---

## 6. Implementation Plan

### Phase 0: Current State (No Action Required)

- i18next is installed and configured.
- `src/i18n/i18n.ts` initializes the library.
- English translation files exist but are incomplete.
- Most components use hardcoded strings.

### Phase 1: Incremental Adoption (Start Now)

- New components and features use `t()` for user-facing strings.
- Extract strings from high-traffic pages first: Dashboard, Topology, Cluster Overview.
- Establish the key naming convention in a `CONTRIBUTING.md` section.

### Phase 2: String Extraction Sprint (When Demand Triggers)

- Run `i18next-parser` to identify all hardcoded strings.
- Batch-extract strings page by page.
- Set up CI to detect missing translation keys (`i18next-parser --fail-on-warnings`).

### Phase 3: First Translation (Community-Driven)

- Publish translation guide for contributors.
- Accept PRs for new language files.
- Add language switcher to Settings page.
- Test RTL support if Arabic/Hebrew is contributed.

### Phase 4: Professional Translation (If Managed Service Launches)

- Contract professional translation for top 3 languages.
- Set up translation management (e.g., Crowdin, Lokalise).
- Add translation CI/CD: auto-merge approved translations.
