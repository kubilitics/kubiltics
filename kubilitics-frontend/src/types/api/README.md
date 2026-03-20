# API Type Definitions

This directory contains TypeScript type definitions generated from OpenAPI specifications.

## Generated Types

- `backend.d.ts` - Types generated from `kubilitics-backend/api/swagger.yaml`

## Generating Types

### From Backend OpenAPI Spec

```bash
npm run generate:api-types
```

Or manually:

```bash
npx openapi-typescript ../kubilitics-backend/api/swagger.yaml -o src/types/api/backend.d.ts --export-type
```

## Usage

Import types in your components:

```typescript
import type { paths, components } from '@/types/api/backend';

// Use path types
type ClusterListResponse = paths['/clusters']['get']['responses']['200']['content']['application/json'];

// Use component types
type Cluster = components['schemas']['Cluster'];
```

## CI/CD

Types are automatically generated and validated in the `contract-test.yml` workflow on every push that modifies the OpenAPI spec.

## Notes

- Types are generated from the OpenAPI spec, not from runtime code
- Always regenerate types after updating the OpenAPI spec
- Commit generated types to version control for consistency
