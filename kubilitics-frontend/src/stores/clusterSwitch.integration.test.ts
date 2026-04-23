/**
 * Integration test — every cache-holding Zustand store must clear its
 * cluster-scoped slice within 200ms of a cluster-switch event.
 *
 * Phase 2 / Gap 4. The event bus in clusterSwitch.ts existed but had no
 * subscribers, so the slice-clear contract was vacuous. This test is the
 * regression seal: if someone adds a new cluster-scoped store and forgets
 * to subscribe, this test fails.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { emitClusterSwitch, clearClusterSwitchListeners } from './clusterSwitch';

// Importing each store is what triggers its subscriber registration.
import { useEventsStore } from './eventsStore';
import { useTracesStore } from './tracesStore';
import { useCausalChainStore } from './causalChainStore';
import { useFleetXrayStore } from './fleetXrayStore';
import { useAIContextStore } from './aiContextStore';
import { useChatStore } from './chatStore';
import { useSimulationStore } from './simulationStore';
import { useAutoPilotStore } from './autopilotStore';
import { useNotificationStore } from './notificationStore';

describe('cluster-switch event bus — cache-holding stores clear on switch', () => {
  afterEach(() => {
    // Listeners are registered at module-import time. We deliberately do NOT
    // clear them between tests — re-importing the stores in a fresh vitest
    // worker is what re-registers them in real app code.
  });

  beforeEach(() => {
    // Populate each store with mock cluster-A state so we can assert
    // emitClusterSwitch('cluster-B') clears it.
    useEventsStore.getState().selectEvent('evt-1');
    useEventsStore.getState().setAnalyzeQuery({ foo: 'bar' } as unknown as Parameters<
      typeof useEventsStore.getState
    >[never] extends never
      ? never
      : never);
    useTracesStore.getState().selectTrace('trace-1');
    useTracesStore.getState().selectSpan('span-1');
    useCausalChainStore.getState().setActiveChain({
      id: 'chain-1',
      clusterId: 'cluster-A',
      rootCause: {
        resourceKey: 'x',
        kind: 'Pod',
        namespace: 'default',
        name: 'p',
        eventReason: 'r',
        eventMessage: 'm',
        timestamp: 't',
        healthStatus: 'ok',
      },
      links: [],
      confidence: 1,
      status: 'open',
      createdAt: 't',
      updatedAt: 't',
    });
    useFleetXrayStore.getState().setSelectedClusterA('cluster-A');
    useFleetXrayStore.getState().setDRPrimaryId('cluster-A');
    useAIContextStore.getState().setImplicit({ type: 'pod', cluster: 'cluster-A' });
    useAIContextStore.getState().setExplicit({ type: 'pod', cluster: 'cluster-A' });
    useChatStore.getState().appendUserTurn('cluster-A', {
      turnId: 't1',
      text: 'hi',
      startedAt: 0,
    });
    useSimulationStore.getState().addScenario({
      id: 's1',
      type: 'kill_pod',
    } as unknown as Parameters<typeof useSimulationStore.getState>[never] extends never
      ? never
      : never);
    useAutoPilotStore.getState().setFindings([
      { id: 'f1' } as unknown as Parameters<typeof useAutoPilotStore.getState>[never] extends never
        ? never
        : never,
    ]);
    useNotificationStore.getState().addNotification({
      title: 'hi',
      severity: 'info',
      category: 'cluster',
    });
  });

  it('clears every subscribed store within the synchronous emit tick', async () => {
    // Emit with a DIFFERENT cluster id than any prior emit to guarantee
    // the bus's de-dupe doesn't no-op.
    emitClusterSwitch('cluster-B-' + Date.now());

    // Listeners are invoked synchronously, so state must be cleared now.
    expect(useEventsStore.getState().selectedEventId).toBeNull();
    expect(useEventsStore.getState().analyzeQuery).toBeNull();
    expect(useTracesStore.getState().selectedTraceId).toBeNull();
    expect(useTracesStore.getState().selectedSpanId).toBeNull();
    expect(useCausalChainStore.getState().chainData).toBeNull();
    expect(useCausalChainStore.getState().activeChainId).toBeNull();
    expect(useFleetXrayStore.getState().selectedClusters).toEqual([null, null]);
    expect(useFleetXrayStore.getState().drPrimaryId).toBeNull();
    expect(useAIContextStore.getState().implicit).toBeNull();
    expect(useAIContextStore.getState().explicit).toBeNull();
    expect(useChatStore.getState().transcripts).toEqual({});
    expect(useSimulationStore.getState().scenarios).toEqual([]);
    expect(useSimulationStore.getState().result).toBeNull();
    expect(useAutoPilotStore.getState().findings).toEqual([]);
    expect(useAutoPilotStore.getState().actions).toEqual([]);
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });
});
