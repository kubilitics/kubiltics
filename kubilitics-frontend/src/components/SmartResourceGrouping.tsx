import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import { ResourceHealth } from '@/hooks/useResourceHealth';

export type GroupByOption = 'none' | 'health' | 'namespace' | 'risk' | 'cost';

interface SmartResourceGroupingProps<T> {
  resources: T[];
  healthData: Map<string, ResourceHealth>;
  getResourceId: (resource: T) => string;
  getResourceNamespace?: (resource: T) => string;
  renderResource: (resource: T) => React.ReactNode;
  groupBy: GroupByOption;
}

interface ResourceGroup<T> {
  key: string;
  label: string;
  resources: T[];
  color?: string;
  icon?: React.ReactNode;
}

export function SmartResourceGrouping<T>({
  resources,
  healthData,
  getResourceId,
  getResourceNamespace,
  renderResource,
  groupBy
}: SmartResourceGroupingProps<T>) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedGroups(newExpanded);
  };

  const groupResources = (): ResourceGroup<T>[] => {
    if (groupBy === 'none') {
      return [{
        key: 'all',
        label: 'All Resources',
        resources
      }];
    }

    const groups = new Map<string, T[]>();

    resources.forEach(resource => {
      const id = getResourceId(resource);
      const health = healthData.get(id);

      let groupKey = 'unknown';

      switch (groupBy) {
        case 'health':
          if (health) {
            if (health.healthScore >= 80) groupKey = 'healthy';
            else if (health.healthScore >= 60) groupKey = 'warning';
            else if (health.healthScore >= 30) groupKey = 'degraded';
            else groupKey = 'critical';
          }
          break;

        case 'namespace':
          groupKey = getResourceNamespace?.(resource) || 'default';
          break;

        case 'risk':
          groupKey = health?.failureRisk || 'unknown';
          break;

        case 'cost':
          if (health) {
            if (health.costPerDay >= 10) groupKey = 'high-cost';
            else if (health.costPerDay >= 5) groupKey = 'medium-cost';
            else if (health.costPerDay >= 1) groupKey = 'low-cost';
            else groupKey = 'minimal-cost';
          }
          break;
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey)!.push(resource);
    });

    // Convert to array and add metadata
    const groupArray: ResourceGroup<T>[] = [];

    groups.forEach((resources, key) => {
      const group: ResourceGroup<T> = {
        key,
        label: formatGroupLabel(key, groupBy),
        resources,
        color: getGroupColor(key, groupBy)
      };
      groupArray.push(group);
    });

    // Sort groups by priority
    return groupArray.sort((a, b) => {
      const priority = getGroupPriority(a.key, groupBy);
      const priorityB = getGroupPriority(b.key, groupBy);
      return priority - priorityB;
    });
  };

  const formatGroupLabel = (key: string, groupType: GroupByOption): string => {
    switch (groupType) {
      case 'health': {
        const healthLabels: Record<string, string> = {
          healthy: 'Healthy (80-100%)',
          warning: 'Warning (60-79%)',
          degraded: 'Degraded (30-59%)',
          critical: 'Critical (<30%)'
        };
        return healthLabels[key] || key;
      }

      case 'risk':
        return `${key.charAt(0).toUpperCase() + key.slice(1)} Risk`;

      case 'cost': {
        const costLabels: Record<string, string> = {
          'high-cost': 'High Cost (≥$10/day)',
          'medium-cost': 'Medium Cost ($5-10/day)',
          'low-cost': 'Low Cost ($1-5/day)',
          'minimal-cost': 'Minimal Cost (<$1/day)'
        };
        return costLabels[key] || key;
      }

      case 'namespace':
        return `Namespace: ${key}`;

      default:
        return key;
    }
  };

  const getGroupColor = (key: string, groupType: GroupByOption): string => {
    switch (groupType) {
      case 'health': {
        const healthColors: Record<string, string> = {
          healthy: 'bg-green-50 border-green-200',
          warning: 'bg-yellow-50 border-yellow-200',
          degraded: 'bg-orange-50 border-orange-200',
          critical: 'bg-red-50 border-red-200'
        };
        return healthColors[key] || 'bg-gray-50 border-gray-200';
      }

      case 'risk': {
        const riskColors: Record<string, string> = {
          low: 'bg-green-50 border-green-200',
          medium: 'bg-yellow-50 border-yellow-200',
          high: 'bg-orange-50 border-orange-200',
          critical: 'bg-red-50 border-red-200'
        };
        return riskColors[key] || 'bg-gray-50 border-gray-200';
      }

      case 'cost': {
        const costColors: Record<string, string> = {
          'high-cost': 'bg-red-50 border-red-200',
          'medium-cost': 'bg-orange-50 border-orange-200',
          'low-cost': 'bg-yellow-50 border-yellow-200',
          'minimal-cost': 'bg-green-50 border-green-200'
        };
        return costColors[key] || 'bg-gray-50 border-gray-200';
      }

      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getGroupPriority = (key: string, groupType: GroupByOption): number => {
    switch (groupType) {
      case 'health': {
        const healthPriority: Record<string, number> = {
          critical: 1,
          degraded: 2,
          warning: 3,
          healthy: 4
        };
        return healthPriority[key] || 99;
      }

      case 'risk': {
        const riskPriority: Record<string, number> = {
          critical: 1,
          high: 2,
          medium: 3,
          low: 4
        };
        return riskPriority[key] || 99;
      }

      case 'cost': {
        const costPriority: Record<string, number> = {
          'high-cost': 1,
          'medium-cost': 2,
          'low-cost': 3,
          'minimal-cost': 4
        };
        return costPriority[key] || 99;
      }

      default:
        return 99;
    }
  };

  const groups = groupResources();

  // Auto-expand all groups initially
  if (expandedGroups.size === 0 && groups.length > 0) {
    setExpandedGroups(new Set(groups.map(g => g.key)));
  }

  if (groupBy === 'none') {
    return (
      <div className="space-y-1">
        {resources.map((resource) => (
          <div key={getResourceId(resource)}>
            {renderResource(resource)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.key);

        return (
          <div key={group.key} className={`border rounded-lg overflow-hidden ${group.color}`}>
            {/* Group Header */}
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full px-4 py-3 flex items-center justify-between hover:opacity-80 transition-opacity"
            >
              <div className="flex items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <Layers className="h-4 w-4" />
                <span className="font-semibold text-sm">{group.label}</span>
                <span className="text-xs bg-white/50 px-2 py-0.5 rounded-full">
                  {group.resources.length} {group.resources.length === 1 ? 'resource' : 'resources'}
                </span>
              </div>
            </button>

            {/* Group Content */}
            {isExpanded && (
              <div className="bg-white border-t px-2 py-2 space-y-1">
                {group.resources.map((resource) => (
                  <div key={getResourceId(resource)}>
                    {renderResource(resource)}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
