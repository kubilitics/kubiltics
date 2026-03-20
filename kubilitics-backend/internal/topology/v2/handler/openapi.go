package handler

// OpenAPISpec returns the OpenAPI 3.0 specification for the Topology V2 API.
// This is served at GET /api/v1/topology/v2/openapi.json
func OpenAPISpec() string {
	return `{
  "openapi": "3.0.3",
  "info": {
    "title": "Kubilitics Topology V2 API",
    "description": "Real-time Kubernetes topology visualization engine with semantic zoom, multi-view modes, and relationship discovery.",
    "version": "2.0.0",
    "contact": { "name": "Kubilitics Team" }
  },
  "servers": [
    { "url": "/api/v1", "description": "Default API base" }
  ],
  "paths": {
    "/topology/v2/{clusterId}": {
      "get": {
        "operationId": "getTopology",
        "summary": "Get topology graph for a cluster",
        "description": "Returns the full topology graph including nodes, edges, and metadata for the specified cluster and view mode.",
        "tags": ["topology"],
        "parameters": [
          {
            "name": "clusterId",
            "in": "path",
            "required": true,
            "schema": { "type": "string" },
            "description": "Cluster identifier"
          },
          {
            "name": "view",
            "in": "query",
            "schema": { "type": "string", "enum": ["cluster", "namespace", "workload", "resource-centric", "rbac"], "default": "namespace" },
            "description": "View mode (1=cluster, 2=namespace, 3=workload, 4=resource-centric, 5=rbac)"
          },
          {
            "name": "namespace",
            "in": "query",
            "schema": { "type": "string" },
            "description": "Filter to specific namespace"
          },
          {
            "name": "resource",
            "in": "query",
            "schema": { "type": "string" },
            "description": "Focus resource for resource-centric view (e.g., deployment/nginx)"
          },
          {
            "name": "depth",
            "in": "query",
            "schema": { "type": "integer", "default": 3 },
            "description": "BFS depth for resource-centric view"
          }
        ],
        "responses": {
          "200": {
            "description": "Topology graph response",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/TopologyResponse" }
              }
            }
          },
          "404": { "description": "Cluster not found" },
          "429": { "description": "Rate limited" },
          "503": { "description": "Circuit breaker open" }
        }
      }
    },
    "/topology/v2/export": {
      "get": {
        "operationId": "exportTopology",
        "summary": "Export topology in various formats",
        "tags": ["export"],
        "parameters": [
          {
            "name": "format",
            "in": "query",
            "required": true,
            "schema": { "type": "string", "enum": ["json", "drawio", "svg", "png"] }
          },
          {
            "name": "cluster",
            "in": "query",
            "required": true,
            "schema": { "type": "string" }
          },
          {
            "name": "view",
            "in": "query",
            "schema": { "type": "string", "default": "namespace" }
          }
        ],
        "responses": {
          "200": {
            "description": "Exported topology data",
            "content": {
              "application/json": {},
              "application/xml": {},
              "image/svg+xml": {},
              "image/png": {}
            }
          }
        }
      }
    },
    "/topology/v2/metrics": {
      "get": {
        "operationId": "getMetrics",
        "summary": "Get topology engine metrics in Prometheus format",
        "tags": ["monitoring"],
        "responses": {
          "200": {
            "description": "Prometheus-format metrics",
            "content": {
              "text/plain": {
                "schema": { "type": "string" }
              }
            }
          }
        }
      }
    },
    "/topology/v2/feature-flags": {
      "get": {
        "operationId": "getFeatureFlags",
        "summary": "Get topology v2 feature flag status",
        "tags": ["config"],
        "responses": {
          "200": {
            "description": "Feature flag state",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "properties": {
                    "topologyV2Enabled": { "type": "boolean" }
                  }
                }
              }
            }
          }
        }
      }
    },
    "/ws/topology/{clusterId}/v2": {
      "get": {
        "operationId": "topologyWebSocket",
        "summary": "WebSocket for real-time topology updates",
        "description": "Establishes a WebSocket connection for real-time topology change events. Supports batched updates (100ms window) and view mode switching.",
        "tags": ["realtime"],
        "parameters": [
          {
            "name": "clusterId",
            "in": "path",
            "required": true,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "101": { "description": "WebSocket upgrade" }
        }
      }
    }
  },
  "components": {
    "schemas": {
      "TopologyResponse": {
        "type": "object",
        "required": ["nodes", "edges", "metadata"],
        "properties": {
          "nodes": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/TopologyNode" }
          },
          "edges": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/TopologyEdge" }
          },
          "metadata": { "$ref": "#/components/schemas/TopologyMetadata" }
        }
      },
      "TopologyNode": {
        "type": "object",
        "required": ["id", "kind", "name", "category", "status"],
        "properties": {
          "id": { "type": "string" },
          "kind": { "type": "string" },
          "name": { "type": "string" },
          "namespace": { "type": "string" },
          "category": { "type": "string", "enum": ["compute", "networking", "storage", "config", "security", "scaling", "scheduling", "custom"] },
          "status": { "type": "string", "enum": ["healthy", "warning", "error", "unknown"] },
          "statusReason": { "type": "string" },
          "metrics": {
            "type": "object",
            "properties": {
              "cpuRequest": { "type": "number" },
              "cpuLimit": { "type": "number" },
              "memoryRequest": { "type": "integer" },
              "memoryLimit": { "type": "integer" },
              "restartCount": { "type": "integer" },
              "podCount": { "type": "integer" },
              "readyCount": { "type": "integer" }
            }
          },
          "labels": { "type": "object", "additionalProperties": { "type": "string" } },
          "createdAt": { "type": "string", "format": "date-time" }
        }
      },
      "TopologyEdge": {
        "type": "object",
        "required": ["id", "source", "target", "relationship"],
        "properties": {
          "id": { "type": "string" },
          "source": { "type": "string" },
          "target": { "type": "string" },
          "relationship": { "type": "string" },
          "category": { "type": "string", "enum": ["ownership", "networking", "configuration", "storage", "rbac", "scheduling", "scaling", "policy"] },
          "detail": { "type": "string" },
          "healthy": { "type": "boolean" }
        }
      },
      "TopologyMetadata": {
        "type": "object",
        "properties": {
          "clusterId": { "type": "string" },
          "viewMode": { "type": "string" },
          "nodeCount": { "type": "integer" },
          "edgeCount": { "type": "integer" },
          "buildDuration": { "type": "string" },
          "timestamp": { "type": "string", "format": "date-time" }
        }
      },
      "WebSocketMessage": {
        "type": "object",
        "required": ["type"],
        "properties": {
          "type": { "type": "string", "enum": ["topology_update", "node_added", "node_removed", "node_updated", "edge_added", "edge_removed", "change_view", "error"] },
          "data": { "type": "object" },
          "timestamp": { "type": "string", "format": "date-time" }
        }
      }
    }
  }
}`
}
