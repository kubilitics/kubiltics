# Resource Page Factory

## Note

This task (TASK-CORE-018) overlaps with **TASK-SCALE-002** (Resource Page Factory Pattern).

The resource page factory implementation lives in:

```
src/components/resources/ResourcePageFactory.tsx
```

This factory provides a unified pattern for rendering Kubernetes resource list and detail pages, including:

- Consistent table layout with sorting, filtering, and pagination
- Namespace filtering
- Status badge rendering per resource kind
- Detail page routing with breadcrumbs
- Loading and error states
- Dark mode support

See `TASK-SCALE-002` in the project backlog for the full specification and implementation details.

## Usage

```tsx
import { createResourcePage } from '../resources/ResourcePageFactory';

// Create a typed resource page for DaemonSets
const DaemonSetsPage = createResourcePage({
  kind: 'DaemonSet',
  apiGroup: 'apps/v1',
  columns: ['name', 'namespace', 'desired', 'current', 'ready', 'age'],
  defaultSort: { field: 'name', direction: 'asc' },
});
```

## Related Files

- `src/components/resources/ResourcePageFactory.tsx` — Factory implementation
- `src/components/list/` — Shared list components used by the factory
- `src/components/detail/` — Shared detail components used by the factory
- `src/hooks/useK8sResourceDetail.ts` — Resource detail data hook
- `src/hooks/useResourcesOverview.ts` — Resource list data hook
