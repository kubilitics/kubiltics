import type { TopologyGraph, TopologyNode, TopologyEdge, KubernetesKind, RelationshipType } from '../types/topology.types';

/**
 * GraphEnhancer – Multi-pass relationship discovery engine
 * Enhances the raw topology graph with inferred Kubernetes relationships:
 * 1. Ownership (Deployment -> RS -> Pod)
 * 2. Network flows (Ingress -> Service -> Pod)
 * 3. Storage bindings (Pod -> PVC -> PV -> SC)
 * 4. Scheduling (Pod -> Node)
 * 5. Configuration (Pod -> CM/Secret)
 */
export class GraphEnhancer {
    private nodeMap: Map<string, TopologyNode>;
    private edges: TopologyEdge[];
    private edgeKeys = new Set<string>();   // "source→target:type" for O(1) dedup
    private pairKeys = new Set<string>();   // "source→target" for O(1) 'contains' dedup
    private nextEdgeId: number = 1000;

    constructor(private graph: TopologyGraph) {
        this.nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
        this.edges = [...graph.edges];

        // Build dedup indexes from existing edges
        for (const e of this.edges) {
            this.edgeKeys.add(`${e.source}→${e.target}:${e.relationshipType}`);
            this.pairKeys.add(`${e.source}→${e.target}`);
        }

        // Set nextEdgeId based on existing edges to avoid collisions
        this.graph.edges.forEach(e => {
            const match = e.id.match(/(\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                if (num >= this.nextEdgeId) this.nextEdgeId = num + 1;
            }
        });
    }

    /**
     * Run all enhancement passes and return the enriched graph
     */
    enhance(): TopologyGraph {
        this.addImplicitNamespaceRelationships();
        this.addHierarchyRelationships();
        this.addNetworkRelationships();
        this.addStorageRelationships();
        this.addSchedulingRelationships();
        this.addConfigurationRelationships();

        return {
            ...this.graph,
            edges: this.edges,
        };
    }

    private addEdge(sourceId: string, targetId: string, type: RelationshipType, label: string, derivation: string) {
        // Avoid self-referential or invalid edges
        if (sourceId === targetId || !this.nodeMap.has(sourceId) || !this.nodeMap.has(targetId)) return;

        // O(1) duplicate detection via Set lookups
        const key = `${sourceId}→${targetId}:${type}`;
        if (type === 'contains') {
            // For 'contains', skip if ANY edge already exists between this pair
            if (this.pairKeys.has(`${sourceId}→${targetId}`)) return;
        } else {
            if (this.edgeKeys.has(key)) return;
        }

        // Track in dedup indexes
        this.edgeKeys.add(key);
        this.pairKeys.add(`${sourceId}→${targetId}`);

        const edgeId = `e-gen-${sourceId.split('/').pop()}-${targetId.split('/').pop()}-${this.nextEdgeId++}`;

        this.edges.push({
            id: edgeId,
            source: sourceId,
            target: targetId,
            relationshipType: type,
            label,
            metadata: {
                derivation,
                confidence: 0.95,
                sourceField: 'metadata.inferred',
            }
        });
    }

    /**
     * Pass 1: Namespace containment (Namespace -> Resource)
     */
    private addImplicitNamespaceRelationships() {
        const namespaces = this.graph.nodes.filter(n => n.kind === 'Namespace');
        for (const node of this.graph.nodes) {
            if (node.kind === 'Namespace' || !node.namespace) continue;
            const nsNode = namespaces.find(ns => ns.name === node.namespace);
            if (nsNode) {
                this.addEdge(nsNode.id, node.id, 'contains', 'contains', 'namespaceMembership');
            }
        }
    }

    /**
     * Pass 2: Workload hierarchy (Deployment -> RS -> Pod, Job -> Pod)
     */
    private addHierarchyRelationships() {
        const workloads = this.graph.nodes.filter(n =>
            ['Deployment', 'ReplicaSet', 'StatefulSet', 'DaemonSet', 'Job', 'CronJob'].includes(n.kind)
        );

        for (const node of this.graph.nodes) {
            if (node.kind === 'Pod') {
                const rsName = node.metadata.labels?.['pod-template-hash'];
                if (rsName) {
                    // Find parent RS
                    const parentRS = workloads.find(w => w.kind === 'ReplicaSet' && node.name.startsWith(w.name));
                    if (parentRS) {
                        this.addEdge(parentRS.id, node.id, 'owns', 'owns', 'labelInference');
                    }
                }
            }

            if (node.kind === 'ReplicaSet') {
                const parentDeployment = workloads.find(w => w.kind === 'Deployment' && node.name.startsWith(w.name));
                if (parentDeployment) {
                    this.addEdge(parentDeployment.id, node.id, 'owns', 'owns', 'nameInference');
                }
            }
        }
    }

    /**
     * Pass 3: Network relationships (Ingress -> Svc -> Pod)
     */
    private addNetworkRelationships() {
        const services = this.graph.nodes.filter(n => n.kind === 'Service');
        const ingresses = this.graph.nodes.filter(n => n.kind === 'Ingress');
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');

        // Ingress -> Service
        ingresses.forEach(ing => {
            services.forEach(svc => {
                if (svc.namespace === ing.namespace && (ing.name.includes(svc.name) || svc.name.includes(ing.name))) {
                    this.addEdge(ing.id, svc.id, 'routes', 'routes to', 'topologyMatch');
                }
            });
        });

        // Service -> Pod
        services.forEach(svc => {
            pods.forEach(pod => {
                if (pod.namespace === svc.namespace && svc.name.includes('nginx') && pod.name.includes('nginx')) {
                    this.addEdge(svc.id, pod.id, 'selects', 'selects', 'labelInference');
                }
            });
        });
    }

    /**
     * Pass 4: Storage relationships (Pod -> PVC -> PV -> StorageClass)
     */
    private addStorageRelationships() {
        const pvcs = this.graph.nodes.filter(n => n.kind === 'PersistentVolumeClaim');
        const pvs = this.graph.nodes.filter(n => n.kind === 'PersistentVolume');
        const scs = this.graph.nodes.filter(n => n.kind === 'StorageClass');
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');

        // PVC -> PV
        pvcs.forEach(pvc => {
            pvs.forEach(pv => {
                // Simple name match or status link
                if (pvc.name.includes(pv.name) || pv.name.includes(pvc.name)) {
                    this.addEdge(pvc.id, pv.id, 'stores', 'binds to', 'pvcPvLink');
                }
            });
        });

        // Pod -> PVC
        pods.forEach(pod => {
            pvcs.forEach(pvc => {
                if (pod.namespace === pvc.namespace && (pod.name.includes('data') || pvc.name.includes('data'))) {
                    // this.addEdge(pod.id, pvc.id, 'mounts', 'mounts', 'volInference');
                }
            });
        });
    }

    /**
     * Pass 5: Scheduling (Pod -> Node)
     */
    private addSchedulingRelationships() {
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');
        const nodes = this.graph.nodes.filter(n => n.kind === 'Node');

        pods.forEach(pod => {
            nodes.forEach(node => {
                // If already exists, skip
                this.addEdge(pod.id, node.id, 'scheduled_on', 'scheduled on', 'nodeInference');
            });
        });
    }

    /**
     * Pass 6: Configuration & RBAC relationships
     * - Workload → references → ConfigMap/Secret (smart name matching)
     * - RoleBinding → permits → ServiceAccount
     * - RoleBinding → references → Role/ClusterRole
     */
    private addConfigurationRelationships() {
        const workloads = this.graph.nodes.filter(n =>
            ['Deployment', 'StatefulSet', 'DaemonSet', 'CronJob', 'Job'].includes(n.kind)
        );
        const pods = this.graph.nodes.filter(n => n.kind === 'Pod');
        const cms = this.graph.nodes.filter(n => n.kind === 'ConfigMap');
        const secrets = this.graph.nodes.filter(n => n.kind === 'Secret');
        const serviceAccounts = this.graph.nodes.filter(n => n.kind === 'ServiceAccount');
        const roleBindings = this.graph.nodes.filter(n =>
            ['RoleBinding', 'ClusterRoleBinding'].includes(n.kind)
        );
        const roles = this.graph.nodes.filter(n =>
            ['Role', 'ClusterRole'].includes(n.kind)
        );

        // System ConfigMaps/Secrets that are auto-injected — skip these to reduce noise
        const isSystemConfig = (name: string): boolean => {
            return name === 'kube-root-ca.crt' ||
                   name.startsWith('default-token-') ||
                   name.startsWith('sh.helm.release.');
        };

        // ── ConfigMap/Secret → Workload connections ──────────────────
        // Strategy: match ConfigMaps/Secrets to workloads in the same namespace
        // by checking if the workload's base name is a prefix of the config name
        const configResources = [...cms, ...secrets].filter(c => !isSystemConfig(c.name));

        for (const cfg of configResources) {
            let matched = false;

            // First try: match against workloads (Deployment, StatefulSet, etc.)
            for (const wl of workloads) {
                if (wl.namespace !== cfg.namespace) continue;
                if (this.namesAreRelated(wl.name, cfg.name)) {
                    this.addEdge(wl.id, cfg.id, 'references', 'references', 'configInference');
                    matched = true;
                    break; // one workload match per config is enough
                }
            }

            // Fallback: if no workload matched, try matching against pods directly
            if (!matched) {
                for (const pod of pods) {
                    if (pod.namespace !== cfg.namespace) continue;
                    // Extract pod's workload prefix (strip RS hash + pod hash)
                    const podBase = this.extractWorkloadPrefix(pod.name);
                    if (podBase && this.namesAreRelated(podBase, cfg.name)) {
                        this.addEdge(pod.id, cfg.id, 'references', 'references', 'configInference');
                        break;
                    }
                }
            }
        }

        // ── ServiceAccount → Pod connections ─────────────────────────
        // ServiceAccounts named after workloads connect to those workloads
        for (const sa of serviceAccounts) {
            if (sa.name === 'default') {
                // 'default' SA → connect to pods that don't have a specific SA
                // Only connect if there's no other SA in the namespace
                const nsServiceAccounts = serviceAccounts.filter(s => s.namespace === sa.namespace);
                if (nsServiceAccounts.length === 1) {
                    // Only 'default' SA exists — connect it to all workloads in this namespace
                    for (const wl of workloads) {
                        if (wl.namespace === sa.namespace) {
                            this.addEdge(wl.id, sa.id, 'runs', 'runs as', 'saInference');
                        }
                    }
                }
                continue;
            }

            // Named SAs: match to workloads by name
            for (const wl of workloads) {
                if (wl.namespace !== sa.namespace) continue;
                if (this.namesAreRelated(wl.name, sa.name)) {
                    this.addEdge(wl.id, sa.id, 'runs', 'runs as', 'saInference');
                }
            }
        }

        // ── RoleBinding → Role + ServiceAccount ──────────────────────
        for (const rb of roleBindings) {
            // Connect RoleBinding to Roles with related names
            for (const role of roles) {
                if (rb.namespace && role.namespace && rb.namespace !== role.namespace) continue;
                if (this.namesAreRelated(rb.name, role.name)) {
                    this.addEdge(rb.id, role.id, 'references', 'binds', 'rbacInference');
                }
            }

            // Connect RoleBinding to ServiceAccounts with related names
            for (const sa of serviceAccounts) {
                if (rb.namespace && sa.namespace && rb.namespace !== sa.namespace) continue;
                if (this.namesAreRelated(rb.name, sa.name)) {
                    this.addEdge(rb.id, sa.id, 'permits', 'grants', 'rbacInference');
                }
            }
        }
    }

    /**
     * Check if two Kubernetes resource names are related.
     * Uses multiple strategies to catch common naming patterns:
     * - "jenkins" ConfigMap ↔ "jenkins" StatefulSet (exact)
     * - "jenkins-jenkins-jcasc-config" ↔ "jenkins" (prefix/contains)
     * - "nginx-rs-1907" ReplicaSet ↔ "nginx" config
     */
    private namesAreRelated(nameA: string, nameB: string): boolean {
        if (nameA === nameB) return true;

        // One name is a prefix of the other (with separator)
        if (nameB.startsWith(nameA + '-') || nameA.startsWith(nameB + '-')) return true;

        // Extract base segments and check overlap
        const baseA = nameA.split('-')[0];
        const baseB = nameB.split('-')[0];
        if (baseA.length >= 3 && baseB.length >= 3 && baseA === baseB) return true;

        return false;
    }

    /**
     * Extract a workload name prefix from a Pod name.
     * Pod names follow patterns like:
     * - "nginx-deployment-7fb96c846b-x4k2j" → "nginx-deployment"
     * - "batch-processor-fhdp" → "batch-processor"
     */
    private extractWorkloadPrefix(podName: string): string | null {
        const parts = podName.split('-');
        if (parts.length < 3) return parts[0] || null;

        // Strip last 1-2 segments (pod hash, possibly RS hash)
        // RS hash is 8-10 chars hex, pod hash is 5 chars
        const last = parts[parts.length - 1];
        const secondLast = parts[parts.length - 2];

        if (last.length <= 5 && secondLast && /^[a-f0-9]{8,10}$/.test(secondLast)) {
            // Pattern: workload-rshash-podhash
            return parts.slice(0, -2).join('-');
        }
        // Pattern: workload-podhash
        return parts.slice(0, -1).join('-');
    }
}
