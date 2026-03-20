# Kubilitics - Product Requirements Document

> **"Kubernetes Made Human"**
> 
> The definitive platform that transforms Kubernetes from a complex orchestration system into an intuitive, visual experience accessible to everyone—from curious beginners to seasoned CTOs.

---

## Executive Summary

**Product Name:** Kubilitics  
**Vision:** Democratize Kubernetes management by creating the world's most intuitive, visually stunning, and powerful cluster management platform.  
**Target Market:** $7.8B Kubernetes market (2027), growing at 23% CAGR  
**Tagline:** "See Your Clusters. Master Your Cloud."

### The Problem

Kubernetes is the industry standard for container orchestration, yet:
- **75% of organizations** struggle with Kubernetes complexity
- **kubectl** requires memorizing 200+ commands
- Existing tools (Lens, K9s, Rancher) are either too technical or too limited
- No single platform offers the "Apple experience" for infrastructure

### The Solution

Kubilitics is a **unified, visual-first platform** that makes Kubernetes management feel like using an iPhone. One glance tells you everything. One click does everything. Zero learning curve.

---

## Table of Contents

1. [Product Vision & Philosophy](#1-product-vision--philosophy)
2. [Target Users & Personas](#2-target-users--personas)
3. [Core Design Principles](#3-core-design-principles)
4. [Technical Architecture](#4-technical-architecture)
5. [Complete Resource Coverage](#5-complete-resource-coverage)
6. [Page-by-Page Specification](#6-page-by-page-specification)
7. [Component Library](#7-component-library)
8. [AI & Natural Language Interface](#8-ai--natural-language-interface)
9. [Backend API Specification](#9-backend-api-specification)
10. [Security & Compliance](#10-security--compliance)
11. [Monetization Strategy](#11-monetization-strategy)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Success Metrics](#13-success-metrics)
14. [Appendices](#14-appendices)

---

## 1. Product Vision & Philosophy

### 1.1 The Kubilitics Manifesto

```
We believe infrastructure should be invisible.
We believe complexity is a design failure.
We believe everyone deserves to understand their systems.
We believe the best tool is the one you never have to think about.
```

### 1.2 Core Philosophy: "Calm Computing"

Kubilitics embraces **Calm Computing**—technology that informs without demanding attention. Inspired by:

| Inspiration | What We Take |
|-------------|--------------|
| **Apple** | Obsessive attention to detail, progressive disclosure |
| **Stripe** | Developer empathy, beautiful documentation |
| **Linear** | Speed, keyboard-first, minimal UI |
| **Notion** | Flexibility without complexity |
| **Figma** | Real-time collaboration, multiplayer |

### 1.3 The "Glance Test"

Every Kubilitics screen must pass the **Glance Test**:

> "Can a user understand the state of their cluster in under 3 seconds?"

If no, redesign.

---

## 2. Target Users & Personas

### 2.1 Primary Personas

#### 👨‍💻 **Alex - The DevOps Engineer**
- **Age:** 28-40
- **Experience:** 5+ years in infrastructure
- **Pain Points:** Context switching between tools, alert fatigue, repetitive tasks
- **Goals:** Deploy faster, sleep better, automate everything
- **Kubilitics Value:** "Finally, one tool that does everything kubectl does—but visually."

#### 👩‍💼 **Sarah - The Engineering Manager**
- **Age:** 35-50
- **Experience:** Manages 5-20 engineers
- **Pain Points:** No visibility into infrastructure health, can't answer exec questions quickly
- **Goals:** Understand system health at a glance, make data-driven decisions
- **Kubilitics Value:** "I can show the CEO our infrastructure health in 10 seconds."

#### 🎓 **Marcus - The Cloud Curious**
- **Age:** 22-30
- **Experience:** Junior developer learning Kubernetes
- **Pain Points:** kubectl is intimidating, tutorials are outdated
- **Goals:** Learn Kubernetes without breaking production
- **Kubilitics Value:** "I learned more in 1 hour with Kubilitics than 10 hours of YouTube."

#### 🏢 **Diana - The CTO**
- **Age:** 40-55
- **Experience:** 20+ years in technology
- **Pain Points:** No executive-level infrastructure dashboards
- **Goals:** Cost visibility, compliance reporting, strategic planning
- **Kubilitics Value:** "Board meetings just got easier. One dashboard tells the whole story."

### 2.2 Use Case Matrix

| Use Case | Alex | Sarah | Marcus | Diana |
|----------|------|-------|--------|-------|
| Deploy applications | ✅ Primary | ⚪ Occasional | ⚪ Learning | ❌ Never |
| Monitor health | ✅ Daily | ✅ Daily | ⚪ Learning | ✅ Weekly |
| Debug issues | ✅ Primary | ⚪ Occasional | ⚪ Learning | ❌ Never |
| View costs | ✅ Monthly | ✅ Weekly | ❌ N/A | ✅ Daily |
| Manage access | ✅ Weekly | ✅ Primary | ❌ N/A | ✅ Monthly |
| Generate reports | ⚪ Occasional | ✅ Weekly | ❌ N/A | ✅ Primary |

---

## 3. Core Design Principles

### 3.1 The 7 Pillars of Kubilitics Design

#### Pillar 1: **Progressive Disclosure**
Show only what's needed, when it's needed. Layer complexity.

```
Level 1: Health status (green/yellow/red)
Level 2: Click → Resource list with key metrics
Level 3: Click → Full resource details
Level 4: Click → Raw YAML, logs, events
```

#### Pillar 2: **Visual First, Text Second**
Every data point should have a visual representation before text.

```
❌ Bad:  "CPU: 78%"
✅ Good: [████████░░] 78% CPU
```

#### Pillar 3: **Zero Learning Curve**
If someone needs documentation, we've failed.

- Tooltips explain everything on hover
- Smart defaults handle 90% of cases
- AI assistant available in every context

#### Pillar 4: **Speed is a Feature**
Target performance metrics:

| Action | Target | Current Best-in-Class |
|--------|--------|----------------------|
| Page load | <500ms | Lens: ~2s |
| Search results | <100ms | K9s: ~300ms |
| Resource refresh | <1s | kubectl: ~2s |
| Action execution | <2s | Variable |

#### Pillar 5: **Keyboard-First, Mouse-Friendly**
Every action has a keyboard shortcut. Every shortcut is discoverable.

```
⌘K - Command palette (the heart of Kubilitics)
⌘/ - Help & keyboard shortcuts
⌘. - Quick actions on selected resource
⌘⇧P - AI assistant
```

#### Pillar 6: **Consistency is King**
Every resource type follows the same interaction pattern:

```
List View → Detail View → Actions
    ↓           ↓            ↓
 Filters    Tabs Panel    Dialogs
```

#### Pillar 7: **Delight in Details**
Micro-interactions that spark joy:

- Smooth 60fps animations
- Satisfying haptic feedback (where supported)
- Easter eggs for power users
- Thoughtful loading states

### 3.2 Color System

```css
/* The Kubilitics Palette */

/* Primary - Calm Blue */
--primary: 217 91% 60%;           /* Trust, stability, technology */
--primary-foreground: 0 0% 100%;

/* Semantic States */
--success: 142 76% 36%;           /* Healthy, running, available */
--warning: 38 92% 50%;            /* Pending, scaling, updating */
--destructive: 0 84% 60%;         /* Error, failed, critical */
--info: 199 89% 48%;              /* Informational, neutral */

/* Neutral Foundation */
--background: 220 14% 96%;        /* Light, airy, non-fatiguing */
--foreground: 224 71% 4%;         /* Deep, readable, professional */
--muted: 220 14% 96%;
--muted-foreground: 220 9% 46%;

/* Surface Hierarchy */
--card: 0 0% 100%;
--card-foreground: 224 71% 4%;
--popover: 0 0% 100%;
--border: 220 13% 91%;

/* Dark Mode - Equally Refined */
.dark {
  --background: 224 71% 4%;
  --foreground: 210 20% 98%;
  --card: 224 71% 8%;
  --border: 215 28% 17%;
}
```

### 3.3 Typography Scale

```css
/* Inter for UI, JetBrains Mono for code */

--font-sans: 'Inter', system-ui, sans-serif;
--font-mono: 'JetBrains Mono', monospace;

/* Type Scale (Perfect Fourth - 1.333) */
--text-xs: 0.75rem;      /* 12px - Labels, captions */
--text-sm: 0.875rem;     /* 14px - Secondary text */
--text-base: 1rem;       /* 16px - Body text */
--text-lg: 1.125rem;     /* 18px - Emphasized body */
--text-xl: 1.5rem;       /* 24px - Section headers */
--text-2xl: 2rem;        /* 32px - Page titles */
--text-3xl: 2.5rem;      /* 40px - Hero text */
```

### 3.4 Spacing System

```css
/* 4px base unit */
--space-1: 0.25rem;   /* 4px */
--space-2: 0.5rem;    /* 8px */
--space-3: 0.75rem;   /* 12px */
--space-4: 1rem;      /* 16px */
--space-5: 1.25rem;   /* 20px */
--space-6: 1.5rem;    /* 24px */
--space-8: 2rem;      /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

---

## 4. Technical Architecture

### 4.1 System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           KUBILITICS PLATFORM                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     PRESENTATION LAYER                          │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │   Web App   │  │  Desktop    │  │     Mobile App          │ │   │
│  │  │  (React)    │  │  (Electron) │  │  (React Native)         │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      API GATEWAY LAYER                          │   │
│  │  ┌───────────────────────────────────────────────────────────┐ │   │
│  │  │              Kong / Traefik Gateway                        │ │   │
│  │  │  • Rate Limiting  • Auth  • Load Balancing  • Caching     │ │   │
│  │  └───────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      CORE SERVICES (Go)                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │   Cluster   │  │  Resource   │  │      Metrics            │ │   │
│  │  │   Manager   │  │   Manager   │  │      Collector          │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │    Auth     │  │   Events    │  │      Audit              │ │   │
│  │  │   Service   │  │   Stream    │  │      Logger             │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    AI SERVICES (Python)                         │   │
│  │  ┌─────────────────┐  ┌───────────────┐  ┌───────────────────┐ │   │
│  │  │   NLP Engine    │  │  Anomaly      │  │   Recommendation  │ │   │
│  │  │   (LangChain)   │  │  Detection    │  │   Engine          │ │   │
│  │  └─────────────────┘  └───────────────┘  └───────────────────┘ │   │
│  │  ┌─────────────────┐  ┌───────────────┐  ┌───────────────────┐ │   │
│  │  │   MCP Server    │  │  ChatBot      │  │   Cost            │ │   │
│  │  │   Integration   │  │  Agent        │  │   Predictor       │ │   │
│  │  └─────────────────┘  └───────────────┘  └───────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     DATA LAYER                                   │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │  PostgreSQL │  │    Redis    │  │      ClickHouse         │ │   │
│  │  │  (Metadata) │  │   (Cache)   │  │   (Time-series)         │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                 KUBERNETES CLUSTERS                              │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │   │
│  │  │  Cluster 1  │  │  Cluster 2  │  │      Cluster N          │ │   │
│  │  │  (Prod)     │  │  (Staging)  │  │      (Dev)              │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Technology Stack

#### Frontend (React + Vite)

```typescript
// Core Technologies
{
  "framework": "React 18+ with Concurrent Features",
  "bundler": "Vite 5+ (Lightning fast HMR)",
  "language": "TypeScript 5+ (Strict mode)",
  "styling": "Tailwind CSS + CSS Variables",
  "state": "Zustand (Simple) + TanStack Query (Server)",
  "routing": "React Router 6+",
  "forms": "React Hook Form + Zod",
  "tables": "TanStack Table (virtual scrolling)",
  "charts": "Recharts + D3 for complex viz",
  "animation": "Framer Motion",
  "visualization": "D3.js (Force-directed topology)",
  "testing": "Vitest + Testing Library + Playwright",
  "ui": "shadcn/ui + Radix UI primitives"
}
```

#### Backend (Go)

```go
// Core Technologies
{
  "language": "Go 1.22+",
  "framework": "Gin (HTTP) + gRPC (Internal)",
  "k8s_client": "client-go + controller-runtime",
  "database": "PostgreSQL + pgx driver",
  "cache": "Redis + go-redis",
  "auth": "JWT + OIDC support",
  "logging": "Zap (structured logging)",
  "tracing": "OpenTelemetry",
  "testing": "testify + gomock"
}
```

#### AI Services (Python)

```python
# Core Technologies
{
  "language": "Python 3.11+",
  "framework": "FastAPI",
  "llm": "LangChain + OpenAI/Anthropic",
  "ml": "scikit-learn + PyTorch",
  "mcp": "Model Context Protocol SDK",
  "embeddings": "sentence-transformers",
  "vector_db": "Pinecone / Qdrant",
  "testing": "pytest + hypothesis"
}
```

### 4.3 Data Flow Architecture

```
User Action → React Event → Zustand Store → TanStack Query → Go API → K8s API
                                                    ↓
                                              WebSocket
                                                    ↓
                                            Real-time Updates
```

### 4.4 Real-time Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    REAL-TIME EVENT SYSTEM                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  K8s Watch API ──→ Go Event Processor ──→ Redis Pub/Sub       │
│                          │                      │               │
│                          ▼                      ▼               │
│              Event Classification        WebSocket Server       │
│                          │                      │               │
│                          ▼                      ▼               │
│              Priority Queue              Client Connections     │
│                          │                      │               │
│                          ▼                      ▼               │
│              ClickHouse (Store)          React State Update    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Event Types:
├── Critical (< 100ms)   : Pod crash, node failure, security alert
├── Important (< 500ms)  : Deployment update, scaling event
├── Normal (< 2s)        : Resource modification, config change
└── Low (< 5s)           : Metrics update, log aggregation
```

---

## 5. Complete Resource Coverage

### 5.1 Resource Categories (50+ Resources)

Kubilitics provides complete coverage of the Kubernetes API with consistent UI/UX across all resource types.

```
KUBILITICS RESOURCE HIERARCHY
│
├── 📦 WORKLOADS (7 resources)
│   ├── Pods                    # Core compute unit
│   ├── Deployments             # Stateless application management
│   ├── ReplicaSets             # Pod replication controller
│   ├── StatefulSets            # Stateful application management
│   ├── DaemonSets              # Node-level daemon management
│   ├── Jobs                    # One-time batch execution
│   └── CronJobs                # Scheduled job execution
│
├── 🌐 NETWORKING (6 resources)
│   ├── Services                # Service discovery & load balancing
│   ├── Ingresses               # External HTTP/S routing
│   ├── IngressClasses          # Ingress controller configuration
│   ├── Endpoints               # Service backend addresses
│   ├── EndpointSlices          # Scalable endpoint management
│   └── NetworkPolicies         # Network access control
│
├── 💾 STORAGE (5 resources)
│   ├── PersistentVolumes       # Cluster-level storage
│   ├── PersistentVolumeClaims  # Namespace-level storage requests
│   ├── StorageClasses          # Dynamic provisioning templates
│   ├── ConfigMaps              # Configuration data storage
│   └── Secrets                 # Sensitive data storage
│
├── 🏗️ CLUSTER (6 resources)
│   ├── Nodes                   # Cluster compute nodes
│   ├── Namespaces              # Resource isolation boundaries
│   ├── Events                  # Cluster activity log
│   ├── ComponentStatuses       # Control plane health
│   ├── Leases                  # Leader election coordination
│   └── APIServices             # API aggregation layer
│
├── 🔐 SECURITY & ACCESS (9 resources)
│   ├── ServiceAccounts         # Pod identity management
│   ├── Roles                   # Namespace-scoped permissions
│   ├── ClusterRoles            # Cluster-scoped permissions
│   ├── RoleBindings            # Namespace permission grants
│   ├── ClusterRoleBindings     # Cluster permission grants
│   ├── Secrets                 # (also in Storage)
│   ├── PodSecurityPolicies     # Pod security standards (deprecated)
│   ├── NetworkPolicies         # (also in Networking)
│   └── LimitRanges             # Resource constraint templates
│
├── 📊 RESOURCE MANAGEMENT (3 resources)
│   ├── ResourceQuotas          # Namespace resource limits
│   ├── LimitRanges             # Default resource constraints
│   └── PriorityClasses         # Pod scheduling priority
│
├── ⚖️ SCALING & POLICIES (4 resources)
│   ├── HorizontalPodAutoscalers # CPU/Memory-based scaling
│   ├── VerticalPodAutoscalers  # Resource recommendation
│   ├── PodDisruptionBudgets    # Availability guarantees
│   └── RuntimeClasses          # Container runtime selection
│
├── 🧩 CUSTOM RESOURCES (2 resources)
│   ├── CustomResourceDefinitions # CRD schema management
│   └── CustomResources         # CRD instances
│
└── 🚦 ADMISSION CONTROL (4 resources)
    ├── MutatingWebhooks        # Request modification
    ├── ValidatingWebhooks      # Request validation
    ├── VolumeAttachments       # Storage attachment tracking
    └── VolumeSnapshots         # Storage snapshot management
```

### 5.2 Resource Priority Matrix

| Category | Resources | MVP Priority | Phase |
|----------|-----------|--------------|-------|
| **Workloads** | Pod, Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob | P0 | 1.0 |
| **Networking** | Service, Ingress, NetworkPolicy, Endpoints, EndpointSlices, IngressClasses | P0 | 1.0 |
| **Storage** | PV, PVC, StorageClass, ConfigMap, Secret | P0 | 1.0 |
| **Cluster** | Node, Namespace, Event | P0 | 1.0 |
| **Security** | ServiceAccount, Role, ClusterRole, RoleBinding, ClusterRoleBinding | P1 | 1.1 |
| **Scaling** | HPA, VPA, PodDisruptionBudget | P1 | 1.1 |
| **Resource Mgmt** | ResourceQuota, LimitRange, PriorityClass | P1 | 1.1 |
| **Custom** | CRD, Custom Resources | P2 | 1.2 |
| **Admission** | Webhooks, VolumeAttachments | P2 | 1.2 |

---

## 6. Page-by-Page Specification

### 6.1 Landing Page (`/`)

**Purpose:** First impression. Convert visitors to users.  
**Route:** `/`  
**Auth Required:** No

#### Layout Structure

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Logo] KUBILITICS    Features  Pricing  Docs   [Login] [Signup] │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  HERO SECTION                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │     "Kubernetes Made Human"                                      │   │
│  │                                                                  │   │
│  │     The only K8s management platform you'll ever need.           │   │
│  │     See everything. Do anything. Know everything.                │   │
│  │                                                                  │   │
│  │     [Get Started Free] [Watch Demo →]                            │   │
│  │                                                                  │   │
│  │     ┌─────────────────────────────────────────────────────┐     │   │
│  │     │        INTERACTIVE TOPOLOGY PREVIEW                  │     │   │
│  │     │     (Animated D3 force-directed graph showing        │     │   │
│  │     │      Pods, Services, Deployments with live motion)   │     │   │
│  │     └─────────────────────────────────────────────────────┘     │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  ONBOARDING DEMO SECTION                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  Interactive 5-step walkthrough:                                 │   │
│  │  1. Connect Cluster  2. Browse Resources  3. View Logs          │   │
│  │  4. Scale Deployment  5. AI Assistant                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  FEATURES SECTION                                                       │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐              │
│  │ 👁️ Visual     │  │ ⚡ Fast       │  │ 🤖 AI-Powered │              │
│  │   Dashboard   │  │   Actions    │  │   Insights    │              │
│  └───────────────┘  └───────────────┘  └───────────────┘              │
├─────────────────────────────────────────────────────────────────────────┤
│  TRUST BADGES                                                           │
│  Trusted by: [Company Logo] [Company Logo] [Company Logo]              │
├─────────────────────────────────────────────────────────────────────────┤
│  FOOTER                                                                 │
│  [Links] [Social] [Copyright]                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Components

| Component | File | Description |
|-----------|------|-------------|
| `TopologyPreview` | `src/components/landing/TopologyPreview.tsx` | Animated D3 force-directed graph showing mock K8s resources |
| `OnboardingDemo` | `src/components/landing/OnboardingDemo.tsx` | Interactive 5-step walkthrough with animated transitions |
| `FeatureCards` | Inline | 3-column grid showcasing key benefits |
| `TrustBadges` | Inline | Company logos carousel |

#### Interactions

| Element | Click Action | Hover Effect |
|---------|--------------|--------------|
| "Get Started Free" | Navigate to `/signup` | Scale up, glow effect |
| "Watch Demo" | Open modal with video | Underline animation |
| "Login" | Navigate to `/login` | Background highlight |
| TopologyPreview nodes | Tooltip with resource info | Node pulse animation |
| Demo step cards | Advance demo step | Lift shadow effect |

---

### 6.2 Authentication Pages

#### 6.2.1 Login Page (`/login`)

**Purpose:** User authentication  
**Route:** `/login`  
**Auth Required:** No (redirect if authenticated)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │                                                              │    │
│     │     [Kubilitics Logo]                                       │    │
│     │                                                              │    │
│     │     Welcome Back                                            │    │
│     │     Sign in to your account                                 │    │
│     │                                                              │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │ Email                                               │  │    │
│     │     │ ┌────────────────────────────────────────────────┐ │  │    │
│     │     │ │ user@example.com                               │ │  │    │
│     │     │ └────────────────────────────────────────────────┘ │  │    │
│     │     │                                                     │  │    │
│     │     │ Password                                            │  │    │
│     │     │ ┌────────────────────────────────────────────────┐ │  │    │
│     │     │ │ ••••••••••••        [👁️ Show/Hide]            │ │  │    │
│     │     │ └────────────────────────────────────────────────┘ │  │    │
│     │     │                                                     │  │    │
│     │     │ [Forgot Password?]                                  │  │    │
│     │     │                                                     │  │    │
│     │     │ ┌────────────────────────────────────────────────┐ │  │    │
│     │     │ │              [Sign In]                         │ │  │    │
│     │     │ └────────────────────────────────────────────────┘ │  │    │
│     │     │                                                     │  │    │
│     │     │ Don't have an account? [Sign up]                   │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Form Validation

| Field | Validation Rules | Error Messages |
|-------|------------------|----------------|
| Email | Required, valid email format | "Email is required", "Invalid email format" |
| Password | Required, min 8 chars | "Password is required", "Password must be at least 8 characters" |

#### API Calls

```typescript
// POST /api/auth/login
Request: {
  email: string;
  password: string;
}
Response: {
  user: { id, email, name, avatar };
  token: string;
  refreshToken: string;
}
```

#### State Flow

1. User enters credentials
2. Form validation (Zod schema)
3. Submit → Loading state
4. Success → Store JWT in httpOnly cookie → Redirect to `/dashboard` or `/setup/kubeconfig`
5. Error → Display error toast

---

#### 6.2.2 Signup Page (`/signup`)

**Purpose:** New user registration  
**Route:** `/signup`

```
Fields:
├── Full Name (required)
├── Email (required, valid format)
├── Password (required, min 8 chars, complexity rules)
├── Confirm Password (must match)
└── Terms checkbox (required)

Actions:
├── Submit → Create account → Redirect to /verify-email
├── "Already have account?" → /login
└── Social signup (Google, GitHub) - future
```

---

#### 6.2.3 Email Verification (`/verify-email`)

**Purpose:** Confirm email ownership  
**Route:** `/verify-email`

```
Flow:
1. User receives email with verification link
2. Click link → /verify-email?token=xxx
3. Token validation → Success/Error message
4. Success → Auto-redirect to /setup/kubeconfig (3s delay)
5. Error → "Resend verification email" button
```

---

#### 6.2.4 Forgot Password (`/forgot-password`)

**Purpose:** Password reset initiation  
**Route:** `/forgot-password`

```
Fields:
├── Email (required)

Actions:
├── Submit → Send reset email → Show confirmation
└── "Back to Login" → /login
```

---

#### 6.2.5 Reset Password (`/reset-password`)

**Purpose:** Set new password  
**Route:** `/reset-password?token=xxx`

```
Fields:
├── New Password (required, complexity rules)
├── Confirm Password (must match)

Actions:
├── Submit → Update password → Redirect to /login
└── Token expired → Show error + "Request new link"
```

---

### 6.3 Onboarding Flow

#### 6.3.1 Kubeconfig Upload (`/setup/kubeconfig`)

**Purpose:** Connect Kubernetes clusters  
**Route:** `/setup/kubeconfig`  
**Auth Required:** Yes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │                                                              │    │
│     │     🔗 Connect Your Clusters                                │    │
│     │                                                              │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │                                                     │  │    │
│     │     │         📁 Drop kubeconfig here                    │  │    │
│     │     │                                                     │  │    │
│     │     │         or click to browse                         │  │    │
│     │     │                                                     │  │    │
│     │     │     Supports: ~/.kube/config, JSON, YAML           │  │    │
│     │     │                                                     │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     │     ────────────────── or ──────────────────                │    │
│     │                                                              │    │
│     │     [ Paste kubeconfig content ]                            │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │ apiVersion: v1                                      │  │    │
│     │     │ kind: Config                                        │  │    │
│     │     │ clusters:                                           │  │    │
│     │     │   - cluster:                                        │  │    │
│     │     │       server: https://...                           │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     │     [ Skip for Demo Mode ]                                  │    │
│     │                                                              │    │
│     │     ○───●───○   Step 1 of 2                                │    │
│     │                                                              │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Features

| Feature | Description |
|---------|-------------|
| Drag & Drop | Drop kubeconfig file directly |
| Paste | Paste YAML content into textarea |
| Validation | Parse and validate kubeconfig structure |
| Multi-cluster | Automatically discover all contexts |
| Demo Mode | Skip with mock data for exploration |

#### Processing Flow

```typescript
// Kubeconfig parsing
1. File/text received
2. YAML → JSON conversion
3. Structure validation:
   - clusters[] present
   - contexts[] present
   - users[] present
4. For each context:
   - Extract cluster name
   - Extract server URL
   - Identify provider (EKS, GKE, AKS, etc.)
5. Store encrypted config
6. Navigate to cluster selection
```

---

#### 6.3.2 Cluster Selection (`/setup/clusters`)

**Purpose:** Select primary cluster and verify connectivity  
**Route:** `/setup/clusters`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     ┌─────────────────────────────────────────────────────────────┐    │
│     │                                                              │    │
│     │     📡 Select Your Cluster                                  │    │
│     │                                                              │    │
│     │     We found 3 clusters in your kubeconfig                  │    │
│     │                                                              │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │ ● production-cluster                      [Test]   │  │    │
│     │     │   AWS EKS • us-east-1 • v1.28                      │  │    │
│     │     │   Status: 🟢 Connected • 12 nodes • 847 pods       │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │ ○ staging-cluster                         [Test]   │  │    │
│     │     │   GCP GKE • us-central1 • v1.27                    │  │    │
│     │     │   Status: 🟡 Testing...                            │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     │     ┌────────────────────────────────────────────────────┐  │    │
│     │     │ ○ dev-local                               [Test]   │  │    │
│     │     │   Minikube • localhost • v1.29                     │  │    │
│     │     │   Status: 🔴 Connection failed                     │  │    │
│     │     │   ⚠️ Could not reach API server                    │  │    │
│     │     └────────────────────────────────────────────────────┘  │    │
│     │                                                              │    │
│     │     [← Back]                         [Continue to Dashboard] │    │
│     │                                                              │    │
│     │     ○───○───●   Step 2 of 2                                │    │
│     │                                                              │    │
│     └─────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Health Check Process

```typescript
// For each cluster:
async function checkClusterHealth(cluster: Cluster): Promise<HealthResult> {
  // 1. API Server reachability
  const apiCheck = await fetch(`${cluster.server}/healthz`);
  
  // 2. Authentication test
  const authCheck = await fetch(`${cluster.server}/api/v1/namespaces`, {
    headers: { Authorization: `Bearer ${cluster.token}` }
  });
  
  // 3. Permission verification
  const permissions = await checkPermissions([
    'get pods', 'list namespaces', 'get logs', 'exec pods'
  ]);
  
  // 4. Fetch cluster stats
  const nodes = await getNodes();
  const pods = await getPods();
  
  return {
    status: 'connected' | 'partial' | 'failed',
    nodeCount: nodes.length,
    podCount: pods.length,
    version: apiCheck.version,
    permissions
  };
}
```

---

### 6.4 Dashboard (`/dashboard`)

**Purpose:** Cluster overview and health monitoring  
**Route:** `/dashboard`  
**Auth Required:** Yes

```
┌─────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [≡] KUBILITICS  [🔍 ⌘K]  [Cluster ▾] [Namespace ▾]  [+] [🔔] [👤]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────┤
│  SIDEBAR │ MAIN CONTENT                                                 │
│  ┌──────┐┌────────────────────────────────────────────────────────────┐ │
│  │      ││ CLUSTER HEALTH SCORE                                       │ │
│  │ 📊   ││ ┌──────────────────────────────────────────────────────┐  │ │
│  │Dash  ││ │ ████████████░░░░░ 87/100 - Good                      │  │ │
│  │board ││ │ ✓ All nodes healthy  ⚠ 2 pods pending  ✓ No errors  │  │ │
│  │      ││ └──────────────────────────────────────────────────────┘  │ │
│  │ 📦   ││                                                            │ │
│  │Work- ││ RESOURCE SUMMARY CARDS                                     │ │
│  │loads ││ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │ │
│  │  ▾   ││ │  NODES  │ │  PODS   │ │SERVICES │ │ DEPLOYS │          │ │
│  │      ││ │   12    │ │   847   │ │   234   │ │   89    │          │ │
│  │ 🌐   ││ │ 🟢 100% │ │ 🟢 99%  │ │ 🟢 100% │ │ 🟢 100% │          │ │
│  │Net-  ││ └─────────┘ └─────────┘ └─────────┘ └─────────┘          │ │
│  │work  ││                                                            │ │
│  │  ▾   ││ ┌─────────────────────────┐ ┌─────────────────────────┐  │ │
│  │      ││ │ RESOURCE UTILIZATION    │ │ RECENT EVENTS           │  │ │
│  │ 💾   ││ │                         │ │                         │  │ │
│  │Stor- ││ │ CPU  [████████░░] 67%   │ │ 🔴 2m  Pod crashed      │  │ │
│  │age   ││ │ MEM  [██████░░░░] 54%   │ │ 🟡 5m  Scaling up       │  │ │
│  │  ▾   ││ │ DISK [████░░░░░░] 23%   │ │ 🟢 12m ConfigMap updated│  │ │
│  │      ││ └─────────────────────────┘ └─────────────────────────┘  │ │
│  │ ...  ││                                                            │ │
│  └──────┘└────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Health Score Calculation

```typescript
interface HealthScore {
  score: number;        // 0-100
  status: 'critical' | 'warning' | 'good' | 'excellent';
  factors: HealthFactor[];
}

interface HealthFactor {
  name: string;
  weight: number;
  score: number;
  issues: string[];
}

// Factors:
// - Node availability (20%)
// - Pod health (25%)
// - Deployment status (20%)
// - Resource utilization (15%)
// - Recent errors (10%)
// - PVC status (10%)
```

#### Dashboard Components

| Component | File | Data Source | Refresh Rate |
|-----------|------|-------------|--------------|
| `HealthScoreCard` | `src/components/dashboard/HealthScoreCard.tsx` | Aggregate API | 30s |
| `ResourceSummaryCard` | Inline | K8s API | 10s |
| `UtilizationChart` | `Recharts` | Metrics Server | 30s |
| `EventFeed` | `EventsSection` | K8s Events | WebSocket |
| `QuickActions` | Inline | Static | - |

#### First-Time User Experience

When `isFirstVisit === true`, trigger `DashboardTour`:

```typescript
// src/components/onboarding/DashboardTour.tsx
const tourSteps = [
  { target: '.health-score', content: 'Your cluster health at a glance' },
  { target: '.resource-cards', content: 'Click any card to see details' },
  { target: '.sidebar', content: 'Navigate all resources here' },
  { target: '.search-bar', content: 'Press ⌘K to search anything' },
  { target: '.ai-button', content: 'Ask AI anything about your cluster' }
];
```

---

### 6.5 Resource List Pages (Template)

**Purpose:** Browse, filter, and act on resources  
**Pattern:** All 50+ resource types follow this template

#### Standard List Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER + SIDEBAR (persistent)                                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PAGE HEADER                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Icon] Resource Name (count)              [+ Create] [⟳] [↓]    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  STATUS SUMMARY CARDS                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │  TOTAL  │ │ RUNNING │ │ PENDING │ │ FAILED  │ │ UNKNOWN │         │
│  │   847   │ │   820   │ │   15    │ │    8    │ │    4    │         │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                                                                         │
│  FILTER BAR                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [🔍 Search...] [Namespace ▾] [Status ▾] [Labels ▾] [Clear All]  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  BULK ACTIONS BAR (when items selected)                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ☑ 5 selected   [Delete] [Restart] [Export YAML] [Compare]      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  DATA TABLE                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ ☐ NAME↑         NAMESPACE   STATUS   AGE   CPU    MEM   ACTIONS │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ ☐ api-server-1  production  🟢 Run   2d    [▃▅▇]  45%   [⋮]    │   │
│  │ ☐ api-server-2  production  🟢 Run   2d    [▅▇▃]  38%   [⋮]    │   │
│  │ ☐ worker-abc    production  🔴 Fail  5m    [---]  --    [⋮]    │   │
│  │ ...                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  PAGINATION                                                             │
│  Showing 1-25 of 847  [◀] 1 2 3 ... 34 [▶]  [25 per page ▾]           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### List Page Features (All Resources)

| Feature | Description | Implementation |
|---------|-------------|----------------|
| **Status Cards** | Visual summary of resource states | 4-5 cards showing counts by status |
| **Search** | Fuzzy search across name, namespace, labels | Client-side filtering |
| **Namespace Filter** | Dropdown to filter by namespace | Query param `?ns=xxx` |
| **Status Filter** | Filter by resource status | Checkbox dropdown |
| **Label Filter** | Filter by label key=value | Multi-select with search |
| **Sorting** | Click column headers to sort | Asc/Desc toggle, persist preference |
| **Bulk Selection** | Checkbox column for multi-select | Select all / individual |
| **Bulk Actions** | Actions on selected items | Delete, Restart, Export, Compare |
| **Inline Sparklines** | Mini charts for CPU/Memory | Last 15 minutes trend |
| **Row Actions** | Quick actions per row | Dropdown with Edit, Delete, Logs, etc. |
| **Export** | Download as YAML/JSON | Single or bulk export |
| **Refresh** | Manual data refresh | Also auto-refresh interval |
| **Create** | Open creation wizard | Resource-specific wizard |

#### Resource-Specific List Configurations

##### Pods (`/pods`)

```typescript
const podColumns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'namespace', label: 'Namespace', sortable: true },
  { key: 'status', label: 'Status', sortable: true, render: StatusBadge },
  { key: 'node', label: 'Node', sortable: true },
  { key: 'restarts', label: 'Restarts', sortable: true },
  { key: 'cpu', label: 'CPU', render: SparklineChart },
  { key: 'memory', label: 'Memory', render: SparklineChart },
  { key: 'age', label: 'Age', sortable: true },
  { key: 'actions', label: '', render: ActionsDropdown }
];

const podStatusCards = ['Total', 'Running', 'Pending', 'Succeeded', 'Failed', 'Unknown'];
const podBulkActions = ['Delete', 'Restart', 'Export YAML', 'Compare', 'Add Labels'];
const podRowActions = ['View Logs', 'Exec Shell', 'Port Forward', 'Edit', 'Delete'];
```

##### Deployments (`/deployments`)

```typescript
const deploymentColumns = [
  { key: 'name', label: 'Name' },
  { key: 'namespace', label: 'Namespace' },
  { key: 'replicas', label: 'Replicas', render: 'ready/desired' },
  { key: 'available', label: 'Available' },
  { key: 'upToDate', label: 'Up to Date' },
  { key: 'strategy', label: 'Strategy' },
  { key: 'age', label: 'Age' },
  { key: 'actions', label: '' }
];

const deploymentStatusCards = ['Total', 'Available', 'Progressing', 'Degraded'];
const deploymentBulkActions = ['Delete', 'Scale', 'Restart', 'Export YAML'];
const deploymentRowActions = ['Scale', 'Restart', 'Rollback', 'Edit YAML', 'Delete'];
```

##### Services (`/services`)

```typescript
const serviceColumns = [
  { key: 'name', label: 'Name' },
  { key: 'namespace', label: 'Namespace' },
  { key: 'type', label: 'Type' },  // ClusterIP, NodePort, LoadBalancer, ExternalName
  { key: 'clusterIP', label: 'Cluster IP' },
  { key: 'externalIP', label: 'External IP' },
  { key: 'ports', label: 'Ports', render: PortsList },
  { key: 'selector', label: 'Selector' },
  { key: 'age', label: 'Age' }
];

const serviceStatusCards = ['Total', 'ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'];
```

---

### 6.6 Resource Detail Pages (Template)

**Purpose:** Deep dive into a single resource  
**Pattern:** 10-tab architecture for all resources

#### Standard Detail Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ HEADER + SIDEBAR                                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  RESOURCE HEADER                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [◀ Back] [Icon] resource-name                                   │   │
│  │ Namespace: production  •  Created: 2 days ago  •  Status: 🟢    │   │
│  │                                                                  │   │
│  │ [🔄 Restart] [📈 Scale] [✏️ Edit] [🗑️ Delete]                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  TAB NAVIGATION                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ [Overview] [Containers] [Logs] [Terminal] [Metrics] [Events]   │   │
│  │ [YAML] [Compare] [Topology] [Actions]                           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  TAB CONTENT                                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │              (Content varies by selected tab)                   │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 10-Tab Architecture

##### Tab 1: Overview

```
┌─────────────────────────────────────────────────────────────────┐
│ METADATA CARD                                                    │
│ ├── Name, Namespace, UID                                        │
│ ├── Labels (key=value badges, editable)                         │
│ ├── Annotations (expandable list)                               │
│ ├── Owner References (linked)                                   │
│ └── Creation/Update timestamps                                  │
│                                                                  │
│ STATUS CARD                                                      │
│ ├── Phase/Status with icon                                      │
│ ├── Conditions table                                            │
│ ├── Ready/Available counts                                      │
│ └── Last transition times                                       │
│                                                                  │
│ SPEC CARD (resource-specific)                                   │
│ ├── Key configuration values                                    │
│ └── Rendered as readable cards, not raw YAML                    │
│                                                                  │
│ RELATIONSHIPS CARD                                               │
│ ├── Owner (Deployment → ReplicaSet → Pod)                       │
│ ├── Children (clickable links)                                  │
│ └── Related resources (Services, ConfigMaps, Secrets)           │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 2: Containers (Pods/Deployments/StatefulSets/DaemonSets/Jobs)

```
┌─────────────────────────────────────────────────────────────────┐
│ CONTAINER LIST                                                   │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Container: main                                   🟢 Running│   │
│ │ Image: nginx:1.21.0                                        │   │
│ │ Ports: 80/TCP, 443/TCP                                     │   │
│ │ Resources: 100m-500m CPU, 128Mi-512Mi Memory              │   │
│ │ Mounts: /etc/nginx (configmap), /var/log (emptyDir)       │   │
│ │ [View Logs] [Exec Shell]                                   │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Container: sidecar                                🟢 Running│   │
│ │ ...                                                        │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ INIT CONTAINERS                                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ init-db: ✓ Completed (2m ago)                             │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 3: Logs

```
┌─────────────────────────────────────────────────────────────────┐
│ LOG CONTROLS                                                     │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Container: [main ▾]  [🔴 Live] [⏸ Pause] [↓ Download]     │   │
│ │ 🔍 Filter... [Timestamps ☑] [Wrap ☑] [Level: All ▾]       │   │
│ │ Time: [Last 15m ▾]  Lines: [1000 ▾]                       │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ LOG OUTPUT (monospace, syntax highlighted)                       │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ 2024-01-15 10:32:45 INFO  Server starting...              │   │
│ │ 2024-01-15 10:32:46 INFO  Connected to database           │   │
│ │ 2024-01-15 10:33:12 WARN  Slow query: 2.3s               │   │
│ │ 2024-01-15 10:33:45 ERROR Connection timeout              │   │
│ │ ▼ Streaming...                                            │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ Stats: 12,456 lines • 2.3 MB • Since 2h ago                     │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 4: Terminal (Exec)

```
┌─────────────────────────────────────────────────────────────────┐
│ TERMINAL CONTROLS                                                │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Container: [main ▾]  Shell: [/bin/sh ▾]  [Reconnect]      │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ TERMINAL (xterm.js)                                              │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ $ ls -la                                                  │   │
│ │ total 48                                                  │   │
│ │ drwxr-xr-x 1 root root 4096 Jan 15 10:30 .                │   │
│ │ drwxr-xr-x 1 root root 4096 Jan 15 10:30 ..               │   │
│ │ -rw-r--r-- 1 root root  220 Jan 15 10:30 .bashrc          │   │
│ │ $ _                                                       │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ ⚠️ You are connected to a running container. Be careful.        │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 5: Metrics

```
┌─────────────────────────────────────────────────────────────────┐
│ TIME RANGE: [15m] [1h] [6h] [24h] [7d] [Custom]                 │
│                                                                  │
│ CPU USAGE                                                        │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │         ▃▅▇█▇▅▃▂▃▅▇▅▃▂▃▄▆█▇▅▄▃▂▃▄▅▆▇█▇▅▄▃                │   │
│ │ 500m ───────────────────────────── limit                   │   │
│ │ 250m ─────────────── request                               │   │
│ │ Current: 320m (64%)  Avg: 280m  Peak: 480m                │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ MEMORY USAGE                                                     │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │         ▂▃▄▅▅▅▅▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▇▇▇▇▇▇▇▇                │   │
│ │ 512Mi ───────────────────────────── limit                  │   │
│ │ Current: 380Mi (74%)  Avg: 350Mi  Peak: 450Mi             │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ NETWORK I/O                                                      │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Rx: ▃▅▇▅▃▂▃▅  Tx: ▂▃▄▅▄▃▂▃                               │   │
│ │ In: 1.2 GB/day  Out: 800 MB/day                           │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 6: Events

```
┌─────────────────────────────────────────────────────────────────┐
│ EVENTS TIMELINE                                                  │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ 🔴 2m ago   Warning: BackOff                              │   │
│ │            Back-off restarting failed container           │   │
│ │            Count: 5                                        │   │
│ ├───────────────────────────────────────────────────────────┤   │
│ │ 🟡 5m ago   Normal: Pulled                                 │   │
│ │            Successfully pulled image "nginx:1.21"         │   │
│ ├───────────────────────────────────────────────────────────┤   │
│ │ 🟢 10m ago  Normal: Scheduled                              │   │
│ │            Successfully assigned to node-1                │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ Filter: [All ▾] [Warning only ▾]  [Last 1h ▾]                   │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 7: YAML (Editable)

```
┌─────────────────────────────────────────────────────────────────┐
│ YAML EDITOR                                                      │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [Edit Mode] [Copy] [Download] [Apply Changes]             │   │
│ │                                                            │   │
│ │ apiVersion: v1                                            │   │
│ │ kind: Pod                                                 │   │
│ │ metadata:                                                 │   │
│ │   name: api-server-xyz                                    │   │
│ │   namespace: production                                   │   │
│ │   labels:                                                 │   │
│ │     app: api-server                                       │   │
│ │ spec:                                                     │   │
│ │   containers:                                             │   │
│ │   - name: main                                            │   │
│ │     image: nginx:1.21.0                                   │   │
│ │     ...                                                   │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ Validation: ✅ Valid YAML • ✅ Valid K8s manifest               │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 8: Compare (Version Diff)

```
┌─────────────────────────────────────────────────────────────────┐
│ VERSION COMPARISON                                               │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ Version A: [Current ▾]     Version B: [2 hours ago ▾]    │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ DIFF VIEW (side-by-side)                                         │
│ ┌─────────────────────────┬─────────────────────────────────┐   │
│ │ Current                 │ 2 hours ago                     │   │
│ ├─────────────────────────┼─────────────────────────────────┤   │
│ │   image: nginx:1.21.0   │   image: nginx:1.20.0          │   │
│ │ + memory: 512Mi         │ - memory: 256Mi                 │   │
│ │   replicas: 3           │   replicas: 3                   │   │
│ └─────────────────────────┴─────────────────────────────────┘   │
│                                                                  │
│ Changes: 2 additions, 1 deletion, 1 modification               │
│ [Rollback to Version B]                                         │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 9: Topology

```
┌─────────────────────────────────────────────────────────────────┐
│ RESOURCE TOPOLOGY (D3 force-directed graph)                      │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │                                                            │   │
│ │        [Deployment]                                       │   │
│ │            │                                               │   │
│ │            ▼                                               │   │
│ │       [ReplicaSet]                                        │   │
│ │       /    |    \                                         │   │
│ │      ▼     ▼     ▼                                        │   │
│ │   [Pod1] [Pod2] [Pod3]  ←──── [Service]                   │   │
│ │      │     │     │                │                        │   │
│ │      └─────┼─────┘                ▼                        │   │
│ │            ▼                 [Ingress]                     │   │
│ │       [ConfigMap]                                         │   │
│ │       [Secret]                                            │   │
│ │                                                            │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ Controls: [Zoom +/-] [Pan] [Reset] [Export PNG]                 │
└─────────────────────────────────────────────────────────────────┘
```

##### Tab 10: Actions

```
┌─────────────────────────────────────────────────────────────────┐
│ AVAILABLE ACTIONS                                                │
│                                                                  │
│ OPERATIONAL                                                      │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [🔄 Restart]     Force restart all containers             │   │
│ │ [📈 Scale]       Adjust replica count (Deployments)       │   │
│ │ [↩️ Rollback]    Revert to previous version               │   │
│ │ [🔀 Port Forward] Forward local port to container         │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ MANAGEMENT                                                       │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [✏️ Edit Labels]     Modify resource labels               │   │
│ │ [📝 Edit Annotations] Modify annotations                  │   │
│ │ [📋 Clone]           Create a copy of this resource       │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│ DANGEROUS (requires confirmation)                                │
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [🗑️ Delete]      Permanently delete this resource         │   │
│ │ [⚠️ Force Delete] Delete without graceful termination      │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

### 6.7 Topology Page (`/topology`)

**Purpose:** Visual cluster map with interactive exploration  
**Route:** `/topology`

```
┌─────────────────────────────────────────────────────────────────────────┐
│ TOPOLOGY VIEW                                                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  CONTROLS                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Layout: [Force ▾] [Hierarchical] [Circular]                      │   │
│  │ Filter: [Namespace ▾] [Type ▾] [Status ▾]                       │   │
│  │ Depth: [● ● ● ○ ○] 3 levels                                     │   │
│  │ [🔍 Zoom +/-] [↻ Reset] [📷 Export]                             │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                                                                  │   │
│  │                     MAIN TOPOLOGY CANVAS                        │   │
│  │                                                                  │   │
│  │         [Namespace: production]                                 │   │
│  │              │                                                   │   │
│  │    ┌─────────┼─────────┐                                        │   │
│  │    │         │         │                                        │   │
│  │  [API]    [Worker]  [Cache]  ← Services                        │   │
│  │    │         │         │                                        │   │
│  │    ▼         ▼         ▼                                        │   │
│  │  ● ● ●    ● ● ●     ●  ← Pods                                  │   │
│  │                                                                  │   │
│  │    ← ConfigMaps    ← Secrets                                    │   │
│  │                                                                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  MINI MAP                    LEGEND                                     │
│  ┌──────────┐               ┌────────────────────────────────────┐    │
│  │ ▪ ▪      │               │ ● Pod  ◼ Service  ◆ Deployment     │    │
│  │   ▪ ▪ ▪  │               │ 🟢 Healthy  🟡 Warning  🔴 Error   │    │
│  └──────────┘               └────────────────────────────────────┘    │
│                                                                         │
│  DETAIL PANEL (slide-in on node click)                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ api-server-7f8d9b                                        [✕]   │   │
│  │ Pod • production • Running                                      │   │
│  │ CPU: 45% • Memory: 380Mi • Restarts: 0                         │   │
│  │ [View Details] [Logs] [Exec]                                    │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Topology Implementation

```typescript
// D3 Force-Directed Graph Configuration
const topologyConfig = {
  forces: {
    link: d3.forceLink().distance(100),
    charge: d3.forceManyBody().strength(-300),
    center: d3.forceCenter(),
    collision: d3.forceCollide(30)
  },
  nodeTypes: {
    Namespace: { shape: 'rect', color: 'gray', size: 40 },
    Deployment: { shape: 'rect', color: 'blue', size: 30 },
    ReplicaSet: { shape: 'rect', color: 'lightblue', size: 25 },
    StatefulSet: { shape: 'rect', color: 'purple', size: 30 },
    DaemonSet: { shape: 'rect', color: 'orange', size: 30 },
    Pod: { shape: 'circle', color: 'green', size: 15 },
    Service: { shape: 'diamond', color: 'yellow', size: 25 },
    Ingress: { shape: 'triangle', color: 'cyan', size: 25 },
    ConfigMap: { shape: 'hexagon', color: 'gray', size: 15 },
    Secret: { shape: 'hexagon', color: 'red', size: 15 }
  },
  interactions: {
    drag: true,
    zoom: [0.1, 4],
    pan: true,
    hover: 'highlight-connected',
    click: 'show-detail-panel',
    doubleClick: 'navigate-to-detail'
  }
};
```

---

### 6.8 Events Page (`/events`)

**Purpose:** Cluster-wide activity timeline  
**Route:** `/events`

```
┌─────────────────────────────────────────────────────────────────────────┐
│ EVENTS                                                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  FILTERS                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ Type: [All ▾] [Warning] [Normal]                                │   │
│  │ Namespace: [All ▾]                                              │   │
│  │ Time: [Last 1h ▾]  [Auto-refresh: ON]                          │   │
│  │ Search: [🔍 Filter by message, object, reason...]              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  EVENT STREAM                                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ TIME      TYPE     REASON        OBJECT              MESSAGE    │   │
│  ├─────────────────────────────────────────────────────────────────┤   │
│  │ 2m ago   🔴 Warn   BackOff       Pod/api-server     Container.. │   │
│  │ 5m ago   🟢 Normal Scheduled     Pod/worker-123     Assigned..  │   │
│  │ 8m ago   🟡 Normal Pulled        Pod/api-server     Pulled im.. │   │
│  │ 12m ago  🟢 Normal ScalingUp     Deployment/api     Scaled up.. │   │
│  │ ...                                                              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Click any event to see full details and related resource              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 6.9 Settings Page (`/settings`)

**Purpose:** Platform configuration  
**Route:** `/settings`

#### Settings Categories

| Category | Options | Storage |
|----------|---------|---------|
| **General** | Theme (light/dark/system), Timezone, Date format | localStorage |
| **Clusters** | Add/remove clusters, Default cluster, Connection timeout | Server |
| **Appearance** | Font size, Density (compact/comfortable), Animations | localStorage |
| **Keyboard** | Custom shortcuts, Vim mode | localStorage |
| **Notifications** | Email alerts, Slack integration, Alert thresholds | Server |
| **Team** | Members, Roles, Invitations | Server |
| **API Keys** | Generate, Revoke, Permissions | Server |
| **Usage** | Credit usage, Billing history | Server |
| **Account** | Profile, Password, 2FA, Delete account | Server |

---

## 7. Component Library

### 7.1 Core UI Components

All components built with **shadcn/ui** + **Radix UI** primitives.

| Component | File | Usage |
|-----------|------|-------|
| `Button` | `src/components/ui/button.tsx` | All buttons with variants |
| `Card` | `src/components/ui/card.tsx` | Content containers |
| `Dialog` | `src/components/ui/dialog.tsx` | Modal windows |
| `DropdownMenu` | `src/components/ui/dropdown-menu.tsx` | Action menus |
| `Tabs` | `src/components/ui/tabs.tsx` | Tab navigation |
| `Table` | `src/components/ui/table.tsx` | Data tables |
| `Badge` | `src/components/ui/badge.tsx` | Status indicators |
| `Input` | `src/components/ui/input.tsx` | Form inputs |
| `Select` | `src/components/ui/select.tsx` | Dropdowns |
| `Checkbox` | `src/components/ui/checkbox.tsx` | Selection |
| `Toast` | `src/components/ui/toast.tsx` | Notifications |
| `Tooltip` | `src/components/ui/tooltip.tsx` | Hover hints |

### 7.2 Kubernetes-Specific Components

| Component | File | Description |
|-----------|------|-------------|
| `ResourceList` | `src/components/resources/ResourceList.tsx` | Generic list with all features |
| `ResourceHeader` | `src/components/resources/ResourceHeader.tsx` | Detail page header with actions |
| `ResourceTabs` | `src/components/resources/ResourceTabs.tsx` | 10-tab navigation |
| `ResourceStatusCard` | `src/components/resources/ResourceStatusCard.tsx` | Status summary cards |
| `MetadataCard` | `src/components/resources/MetadataCard.tsx` | Labels, annotations display |
| `ContainersSection` | `src/components/resources/ContainersSection.tsx` | Container list |
| `LogViewer` | `src/components/resources/LogViewer.tsx` | Live log streaming |
| `TerminalViewer` | `src/components/resources/TerminalViewer.tsx` | Exec terminal |
| `MetricsDashboard` | `src/components/resources/MetricsDashboard.tsx` | CPU/Memory charts |
| `EventsSection` | `src/components/resources/EventsSection.tsx` | Events timeline |
| `YamlViewer` | `src/components/resources/YamlViewer.tsx` | YAML display/edit |
| `YamlCompareViewer` | `src/components/resources/YamlCompareViewer.tsx` | Version diff |
| `TopologyViewer` | `src/components/resources/TopologyViewer.tsx` | D3 topology |
| `ActionsSection` | `src/components/resources/ActionsSection.tsx` | Action buttons |
| `PodSparkline` | `src/components/resources/PodSparkline.tsx` | Inline CPU/Memory chart |
| `PodComparisonView` | `src/components/resources/PodComparisonView.tsx` | Multi-pod comparison |
| `D3ForceTopology` | `src/components/resources/D3ForceTopology.tsx` | Force-directed graph |

### 7.3 Dialog Components

| Component | File | Trigger |
|-----------|------|---------|
| `DeleteConfirmDialog` | `src/components/resources/DeleteConfirmDialog.tsx` | Delete button |
| `ScaleDialog` | `src/components/resources/ScaleDialog.tsx` | Scale button |
| `RolloutActionsDialog` | `src/components/resources/RolloutActionsDialog.tsx` | Restart/Rollback |
| `PortForwardDialog` | `src/components/resources/PortForwardDialog.tsx` | Port forward |
| `YamlEditorDialog` | `src/components/resources/YamlEditorDialog.tsx` | Edit YAML |
| `K8sConnectionDialog` | `src/components/layout/K8sConnectionDialog.tsx` | API connection |

### 7.4 Wizard Components

| Wizard | File | Purpose |
|--------|------|---------|
| `ResourceWizard` | `src/components/wizards/ResourceWizard.tsx` | Base wizard template |
| `PodWizard` | `src/components/wizards/PodWizard.tsx` | Create Pod |
| `DeploymentWizard` | `src/components/wizards/DeploymentWizard.tsx` | Create Deployment |
| `ServiceWizard` | `src/components/wizards/ServiceWizard.tsx` | Create Service |
| `StatefulSetWizard` | `src/components/wizards/StatefulSetWizard.tsx` | Create StatefulSet |
| `JobWizard` | `src/components/wizards/JobWizard.tsx` | Create Job |
| `CronJobWizard` | `src/components/wizards/CronJobWizard.tsx` | Create CronJob |
| `ConfigMapWizard` | `src/components/wizards/ConfigMapWizard.tsx` | Create ConfigMap |
| `SecretWizard` | `src/components/wizards/SecretWizard.tsx` | Create Secret |

#### Wizard Structure (All Wizards)

```typescript
// Standard wizard steps
const wizardSteps = [
  { id: 'basic', title: 'Basic Info', fields: ['name', 'namespace', 'labels'] },
  { id: 'containers', title: 'Containers', fields: ['image', 'ports', 'env'] },
  { id: 'resources', title: 'Resources', fields: ['cpu', 'memory', 'volumes'] },
  { id: 'health', title: 'Health', fields: ['livenessProbe', 'readinessProbe'] },
  { id: 'review', title: 'Review', fields: ['yamlPreview'] }
];

// Wizard features
- Multi-step form with progress indicator
- Live YAML preview (editable)
- YAML syntax validation
- Copy/Download YAML
- Direct K8s API creation when connected
```

---

## 8. AI & Natural Language Interface

### 8.1 AI Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI SERVICE ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  User Query                                                             │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    NATURAL LANGUAGE PROCESSOR                    │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │   │
│  │  │ Intent        │  │ Entity        │  │ Context           │   │   │
│  │  │ Classification│→ │ Extraction    │→ │ Enhancement       │   │   │
│  │  └───────────────┘  └───────────────┘  └───────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                         QUERY ROUTER                             │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │   │
│  │  │ Knowledge     │  │ Action        │  │ Diagnostic        │   │   │
│  │  │ Query         │  │ Request       │  │ Analysis          │   │   │
│  │  └───────────────┘  └───────────────┘  └───────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                    │                    │                        │
│      ▼                    ▼                    ▼                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐     │
│  │ RAG Engine   │  │ MCP Server   │  │ Diagnostic Engine        │     │
│  │ (Knowledge)  │  │ (Actions)    │  │ (Analysis)               │     │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘     │
│      │                    │                    │                        │
│      └────────────────────┴────────────────────┘                        │
│                           │                                             │
│                           ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    RESPONSE GENERATOR                            │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────┐   │   │
│  │  │ Answer        │  │ Action        │  │ Visualization     │   │   │
│  │  │ Synthesis     │  │ Proposals     │  │ Recommendations   │   │   │
│  │  └───────────────┘  └───────────────┘  └───────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│      │                                                                  │
│      ▼                                                                  │
│  User Response                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 AI Capabilities

| Capability | Example Queries | Implementation |
|------------|-----------------|----------------|
| **Diagnostics** | "Why is X failing?", "What's wrong with my deployment?" | Log analysis + event correlation |
| **Search** | "Show pods in production", "Find services without endpoints" | K8s API query translation |
| **Actions** | "Scale api-server to 5 replicas", "Restart cache pods" | MCP tool execution |
| **Learning** | "What is a PersistentVolumeClaim?", "Explain StatefulSet vs Deployment" | RAG + documentation |
| **Compare** | "Difference between these two pods" | Resource diff + analysis |
| **Report** | "Summarize cluster health", "Show me resource usage" | Aggregate queries |
| **Predict** | "Will this deployment succeed?", "Expected cost increase" | ML models |

### 8.3 MCP (Model Context Protocol) Integration

```python
# MCP Server Tools for Kubernetes
tools = [
    # Read operations
    Tool("get_pods", "List pods with filters"),
    Tool("get_deployments", "List deployments"),
    Tool("get_services", "List services"),
    Tool("get_logs", "Get pod logs"),
    Tool("get_events", "Get cluster events"),
    Tool("get_metrics", "Get resource metrics"),
    
    # Write operations (require confirmation)
    Tool("scale_deployment", "Scale replica count"),
    Tool("restart_deployment", "Rolling restart"),
    Tool("delete_resource", "Delete a resource"),
    Tool("apply_yaml", "Apply YAML manifest"),
    
    # Diagnostic operations
    Tool("diagnose_pod", "Analyze pod issues"),
    Tool("diagnose_deployment", "Analyze deployment health"),
    Tool("compare_resources", "Compare two resources"),
    Tool("explain_error", "Explain error message")
]
```

### 8.4 AI Safety Guardrails

```python
class AIGuardrails:
    # Operations requiring explicit confirmation
    CONFIRMATION_REQUIRED = [
        "delete_*",
        "scale_*_to_0",
        "update_production",
        "modify_secrets",
        "change_rbac"
    ]
    
    # Operations blocked by AI
    BLOCKED_OPERATIONS = [
        "delete_namespace_kube-system",
        "delete_all_pods",
        "modify_cluster_admin",
        "expose_secrets"
    ]
    
    # Rate limits
    RATE_LIMITS = {
        "delete": "5/hour",
        "scale": "20/hour",
        "create": "50/hour",
        "read": "1000/hour"
    }
```

---

## 9. Backend API Specification

### 9.1 API Overview

**Base URL:** `https://api.kubilitics.com/v1`  
**Auth:** Bearer token (JWT)  
**Format:** JSON

### 9.2 Authentication Endpoints

```yaml
POST /auth/register:
  body: { email, password, name }
  response: { user, token }

POST /auth/login:
  body: { email, password }
  response: { user, token, refreshToken }

POST /auth/logout:
  headers: { Authorization: Bearer <token> }
  response: { success: true }

POST /auth/refresh:
  body: { refreshToken }
  response: { token, refreshToken }

POST /auth/forgot-password:
  body: { email }
  response: { success: true }

POST /auth/reset-password:
  body: { token, newPassword }
  response: { success: true }

GET /auth/verify-email?token=xxx:
  response: { verified: true }
```

### 9.3 Cluster Management

```yaml
GET /clusters:
  response: [{ id, name, context, server, status, stats }]

POST /clusters:
  body: { kubeconfig } (raw content or base64)
  response: [{ id, name, context, status }]

DELETE /clusters/{id}:
  response: { success: true }

GET /clusters/{id}/health:
  response: { status, nodes, pods, version, permissions }

POST /clusters/{id}/test-connection:
  response: { connected, latency, errors }
```

### 9.4 Resource APIs

```yaml
# Generic resource endpoints (for all 50+ types)
GET /clusters/{clusterId}/resources/{kind}:
  query: { namespace, labels, fieldSelector, limit, continue }
  response: { items: [...], metadata: { continue, remainingItemCount } }

GET /clusters/{clusterId}/resources/{kind}/{name}:
  query: { namespace }
  response: { resource object }

POST /clusters/{clusterId}/resources/{kind}:
  body: { resource YAML/JSON }
  response: { created resource }

PUT /clusters/{clusterId}/resources/{kind}/{name}:
  body: { updated resource }
  response: { updated resource }

DELETE /clusters/{clusterId}/resources/{kind}/{name}:
  query: { namespace, gracePeriod, force }
  response: { success: true }

PATCH /clusters/{clusterId}/resources/{kind}/{name}:
  body: { patch operations }
  response: { patched resource }
```

### 9.5 Pod Operations

```yaml
GET /clusters/{clusterId}/pods/{namespace}/{name}/logs:
  query: { container, follow, tailLines, sinceSeconds, timestamps }
  response: (text stream)

POST /clusters/{clusterId}/pods/{namespace}/{name}/exec:
  body: { command, container, stdin, stdout, stderr, tty }
  response: (WebSocket upgrade)

POST /clusters/{clusterId}/pods/{namespace}/{name}/port-forward:
  body: { ports: [localPort:remotePort] }
  response: { forwardUrl, tunnelId }
```

### 9.6 Deployment Operations

```yaml
POST /clusters/{clusterId}/deployments/{namespace}/{name}/scale:
  body: { replicas: number }
  response: { scaled: true, replicas }

POST /clusters/{clusterId}/deployments/{namespace}/{name}/restart:
  response: { restarted: true }

POST /clusters/{clusterId}/deployments/{namespace}/{name}/rollback:
  body: { revision: number } (optional, defaults to previous)
  response: { rolledBack: true, revision }

GET /clusters/{clusterId}/deployments/{namespace}/{name}/revisions:
  response: [{ revision, image, createdAt, current }]
```

### 9.7 Metrics & Events

```yaml
GET /clusters/{clusterId}/metrics/nodes:
  response: [{ name, cpu, memory, pods }]

GET /clusters/{clusterId}/metrics/pods:
  query: { namespace, name }
  response: [{ name, containers: [{ cpu, memory }] }]

GET /clusters/{clusterId}/events:
  query: { namespace, involved, type, since }
  response: [{ type, reason, message, object, timestamp }]

WebSocket /clusters/{clusterId}/events/stream:
  messages: { type, event object }
```

### 9.8 AI Endpoints

```yaml
POST /ai/chat:
  body: { message, context: { cluster, namespace, resource } }
  response: { response, actions: [...], followUp: [...] }

POST /ai/diagnose:
  body: { kind, name, namespace }
  response: { issue, evidence, recommendations, actions }

POST /ai/execute-action:
  body: { actionId, confirmed: boolean }
  response: { result, success, message }
```

---

## 10. Security & Compliance

### 10.1 Authentication

```yaml
Methods:
  - Email/Password (built-in)
  - OIDC/SAML (Enterprise)
  - API Keys (Automation)

JWT Configuration:
  - Access Token: 15 minutes
  - Refresh Token: 7 days
  - Rotation: On each refresh
  - Storage: httpOnly cookies
```

### 10.2 Authorization (RBAC)

| Role | Permissions |
|------|-------------|
| **Viewer** | Read resources, logs, events |
| **Operator** | + Scale, restart, port-forward |
| **Developer** | + Create, update, delete workloads |
| **Admin** | + Manage RBAC, nodes, namespaces |
| **Owner** | + Billing, team management, API keys |

### 10.3 Data Security

```yaml
Encryption:
  at_rest: AES-256-GCM
  in_transit: TLS 1.3
  secrets: HashiCorp Vault / AWS KMS

Data Handling:
  kubeconfig: Encrypted storage, never logged
  secrets: Masked in UI, encrypted at rest
  logs: Redaction of sensitive patterns
  credentials: Automatic rotation support

Network:
  egress: Cluster API only
  ingress: CDN + WAF protected
  internal: mTLS between services
```

### 10.4 Compliance

| Standard | Status |
|----------|--------|
| SOC 2 Type II | ✅ |
| GDPR | ✅ |
| HIPAA | 🟡 Roadmap |
| ISO 27001 | 🟡 Roadmap |
| FedRAMP | ⚪ Future |

---

## 11. Monetization Strategy

### 11.1 Pricing Tiers

| Feature | Free | Pro ($29/mo) | Enterprise |
|---------|------|--------------|------------|
| Clusters | 1 | 5 | Unlimited |
| Users | 1 | 5 | Unlimited |
| Resources | 100 | Unlimited | Unlimited |
| Retention | 24h | 30 days | 1 year |
| AI Queries | 50/mo | 500/mo | Unlimited |
| Support | Community | Email | Dedicated |
| SSO | ❌ | ❌ | ✅ |
| Audit Logs | ❌ | 7 days | 1 year |
| SLA | ❌ | 99.5% | 99.99% |

---

## 12. Implementation Roadmap

### Phase 1: MVP (12 weeks)

```
Sprint 1-2: Foundation
├── Project setup (Vite, React, TypeScript, Tailwind)
├── Design system (shadcn/ui, tokens, theme)
├── Routing and layout (sidebar, header)
├── Auth pages (login, signup, forgot password)
└── Landing page

Sprint 3-4: Cluster Connection
├── Kubeconfig parser and validator
├── Cluster selection page
├── Health check system
├── Demo mode with mock data
└── Connection dialog

Sprint 5-6: Resource Management
├── Generic ResourceList component
├── Generic ResourceDetail component
├── All 7 Workload resources
├── All 6 Networking resources
├── Search and filtering
└── YAML viewer/editor

Sprint 7-8: Observability
├── Log streaming (LogViewer)
├── Terminal exec (TerminalViewer)
├── Events timeline
├── Metrics charts (Recharts)
└── Real-time WebSocket updates

Sprint 9-10: Advanced Features
├── Topology visualization (D3)
├── Resource wizards
├── Bulk actions
├── Pod comparison
├── Dashboard + health score

Sprint 11-12: Polish & Launch
├── Dark mode
├── Keyboard shortcuts
├── Performance optimization
├── Testing (unit, E2E)
├── Documentation
└── Beta launch
```

### Phase 2: Growth (12 weeks)

- Multi-cluster management
- Custom dashboards
- Alerting system
- Team collaboration
- Mobile responsiveness
- API access

### Phase 3: AI (12 weeks)

- Natural language interface
- MCP server implementation
- Diagnostic engine
- Anomaly detection
- Auto-remediation

### Phase 4: Enterprise (12 weeks)

- SSO/SAML
- Custom RBAC
- Compliance reporting
- On-premise deployment
- White-label option

---

## 13. Success Metrics

### 13.1 North Star Metric

> **Daily Active Clusters (DAC)**

### 13.2 Key Performance Indicators

| Category | Metric | Y1 Target | Y2 Target |
|----------|--------|-----------|-----------|
| Acquisition | Sign-ups | 5K/mo | 25K/mo |
| Acquisition | Clusters connected | 2K | 20K |
| Engagement | DAU/MAU | 30% | 40% |
| Engagement | Sessions/user/week | 5 | 8 |
| Retention | Month 1 retention | 40% | 50% |
| Revenue | MRR | $200K | $1.25M |

### 13.3 Product Quality

| Metric | Target |
|--------|--------|
| Page load | <500ms (p95) |
| API response | <200ms (p95) |
| Uptime | 99.9% |
| Error rate | <0.1% |
| NPS | >50 |

---

## 14. Appendices

### Appendix A: Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘K` | Command palette |
| `⌘⇧P` | AI assistant |
| `⌘/` | Help |
| `⌘.` | Quick actions |
| `⌘1-9` | Switch tabs |
| `⌘⇧N` | New resource |
| `⌘⇧L` | Toggle logs |
| `⌘⇧T` | Toggle terminal |
| `⌘⇧E` | Toggle events |
| `⌘⇧D` | Go to dashboard |
| `⌘⇧F` | Global search |
| `⌘⇧C` | Copy resource YAML |
| `Esc` | Close modal/panel |
| `?` | Show shortcuts |

### Appendix B: File Structure

```
kubilitics-ui/
├── src/
│   ├── components/
│   │   ├── ui/              # shadcn/ui components
│   │   ├── layout/          # Header, Sidebar, AppLayout
│   │   ├── resources/       # K8s resource components
│   │   ├── wizards/         # Creation wizards
│   │   ├── icons/           # K8s icons
│   │   ├── landing/         # Landing page components
│   │   ├── onboarding/      # Onboarding components
│   │   ├── ai/              # AI assistant components
│   │   └── dashboard/       # Dashboard components
│   ├── pages/               # Route pages (50+ files)
│   ├── hooks/               # Custom React hooks
│   ├── stores/              # Zustand stores
│   ├── lib/                 # Utility functions
│   └── main.tsx            # App entry
├── docs/
│   ├── PRD.md              # This document
│   └── AI-SERVICE-ARCHITECTURE.md
└── public/
```

### Appendix C: Resource Type to Route Mapping

| Resource | List Route | Detail Route |
|----------|------------|--------------|
| Pods | `/pods` | `/pods/:namespace/:name` |
| Deployments | `/deployments` | `/deployments/:namespace/:name` |
| ReplicaSets | `/replicasets` | `/replicasets/:namespace/:name` |
| StatefulSets | `/statefulsets` | `/statefulsets/:namespace/:name` |
| DaemonSets | `/daemonsets` | `/daemonsets/:namespace/:name` |
| Jobs | `/jobs` | `/jobs/:namespace/:name` |
| CronJobs | `/cronjobs` | `/cronjobs/:namespace/:name` |
| Services | `/services` | `/services/:namespace/:name` |
| Ingresses | `/ingresses` | `/ingresses/:namespace/:name` |
| ... | ... | ... |

---

**© 2026 Kubilitics. Confidential.**

*This document contains confidential information. Do not distribute without authorization.*
