# Kubilitics Incident Response Plan

**Version:** 1.0.0
**Last Updated:** February 2026
**Audience:** Engineering, Operations, Management
**Status:** Active and Monitored

## Table of Contents

1. [Incident Classification](#1-incident-classification)
2. [Response Procedures](#2-response-procedures)
3. [Escalation Matrix](#3-escalation-matrix)
4. [Communication Templates](#4-communication-templates)
5. [Post-Incident Review](#5-post-incident-review)
6. [Specific Scenario Playbooks](#6-specific-scenario-playbooks)

---

## 1. Incident Classification

Kubilitics incidents are classified into four severity levels based on customer impact, data integrity risk, and operational urgency. Classification determines response time SLAs and escalation procedures.

### P1: Critical (Customer-Facing Outage)

**Definition:**
- Complete service outage affecting all or majority of users
- Data loss or permanent data corruption
- Security breach with customer data exposure
- Service unavailable for > 5 minutes
- Revenue-impacting features completely down

**Examples:**
- Backend service down; /health returns 503
- Database corrupted or lost
- AI service causes unintended cluster modifications
- API key or kubeconfig leaked
- Unencrypted secrets accessible to unauthorized users

**Response SLA:** Acknowledge within 5 minutes; status update every 15 minutes; aim for resolution within 1 hour

**Impact Metrics:**
- Number of affected customers: All or significant portion
- Number of affected clusters: Multiple or critical production
- Data at risk: Customer workloads, sensitive configurations
- Revenue impact: Direct revenue loss or SLA breach fees

### P2: Major (Significant Feature Degradation)

**Definition:**
- Major feature not working but service partially operational
- Performance significantly degraded (>50% slowdown)
- Data integrity issues affecting subset of users
- Workaround available but user experience impacted
- AI making incorrect recommendations (low risk of applying)

**Examples:**
- Pod logs endpoint returns errors; other functionality works
- API latency p95 > 10 seconds (>5x normal)
- Insights/investigations not generating correctly
- WebSocket real-time updates not working; polling fallback available
- AI service down but manual operations still possible

**Response SLA:** Acknowledge within 15 minutes; status update every 30 minutes; aim for resolution within 4 hours

**Impact Metrics:**
- Number of affected customers: Multiple or significant
- Number of affected clusters: Subset of deployments
- Data at risk: Subset of workloads
- Revenue impact: None direct; potential SLA breaches if prolonged

### P3: Minor (Single Feature Broken)

**Definition:**
- Single feature not working; core functionality unaffected
- Limited performance impact
- Workaround available
- No data integrity risk
- User-facing but not blocking

**Examples:**
- Resource creation endpoint returns 400 error; get/list/delete work
- Dashboard widget not rendering; other pages functional
- One LLM provider down; fallback to secondary works
- Email notifications not sending (logs still available)
- Specific label selector syntax not working correctly

**Response SLA:** Assign within next business day; aim for resolution within 1 week

**Impact Metrics:**
- Number of affected customers: Individual or small group
- Number of affected clusters: Single or specific use case
- Data at risk: None
- Revenue impact: None

### P4: Low (Cosmetic or Minor Issue)

**Definition:**
- Cosmetic issue without functional impact
- Documentation error or typo
- Minor UX inconsistency
- Non-blocking bug
- Pre-release or beta feature issue

**Examples:**
- UI button label misspelled
- API documentation typo
- Chart color scheme inconsistency
- Error message wording unclear
- Help text formatting broken

**Response SLA:** Add to backlog; prioritize in next sprint

**Impact Metrics:**
- Number of affected customers: None or nearly none
- Number of affected clusters: None
- Data at risk: None
- Revenue impact: None

---

## 2. Response Procedures

### Detection

**Automatic Detection (Monitoring Alerts)**

Kubilitics runs continuous health checks and monitoring:

```yaml
Monitoring sources:
  - Prometheus alerts (backend, AI service)
  - Kubernetes liveness/readiness probes
  - Synthetic transaction monitoring
  - Log aggregation (error rate > 5%)
  - Customer support tickets (>3 similar reports)
  - Business metrics (transaction completion rate drop)
```

**Detection Triggers:**
1. Backend health check fails (3 consecutive failures = P1)
2. Error rate > 5% for 5 minutes = P2
3. API latency p95 > 5 seconds for 10 minutes = P2
4. Database connection pool exhausted = P1
5. Token budget exhausted = P1
6. LLM provider unreachable > 30 minutes = P1
7. Unintended cluster modifications (unauthorized action detected) = P1
8. Customer-reported service unavailability (within 5 minutes of actual impact) = P1

**Manual Detection (User Reports)**

Users may discover issues before monitoring catches them:
1. Customer submits support ticket describing issue
2. Support engineer triages: severity assessment, affected resource count
3. Escalates to engineering if P1/P2 or unconfirmed critical issue
4. On-call engineer investigates within 5 minutes of escalation

### Triage

**Initial Assessment** (performed by: on-call engineer or first responder)

1. **Confirm Issue**
   - Verify issue is real (not transient network blip)
   - Test from multiple locations/clients
   - Check recent deployments or configuration changes
   - Review error logs and metrics

2. **Determine Scope**
   - How many customers affected: all, subset, specific account
   - Which clusters/regions impacted: all, production only, specific zone
   - What features unavailable: critical path, edge case, informational
   - How long has issue existed: minutes, hours, since last deployment

3. **Assign Severity**
   - P1: Complete outage, data loss, security breach
   - P2: Major feature down, significant degradation
   - P3: Single feature broken, workaround available
   - P4: Cosmetic issue, no functional impact

4. **Notify Team**
   - P1: Page all on-call (engineer, manager, CEO notified)
   - P2: Page engineering lead and on-call engineer
   - P3: Create tracking ticket, assign to engineer for next day
   - P4: Add to backlog

**Example Triage Assessment:**

```
Incident: "Dashboard not loading after 2:00 UTC deploy"

Confirmation:
✓ Verified: Dashboard returns 502 on multiple browsers
✓ Recent change: Frontend deployment at 1:58 UTC
✓ Scope: All customers, all browsers
✓ Duration: 8 minutes since deploy

Impact:
- Customers: ALL (100% affected)
- Features: Dashboard UI (critical path)
- Clusters: All managed clusters
- Workaround: CLI still works (limited)

Severity: P1 (complete service outage)
Action: Page all on-call immediately; rollback frontend
```

### Response (by Severity)

#### P1 Critical Response

**0-5 Minutes (Immediate Actions)**
1. On-call engineer acknowledges alert/ticket
2. Page on-call manager and additional engineers
3. Create incident channel: Slack #incident-P1-20260210-001
4. Post incident summary to status page: "Investigating service issue"
5. Begin investigation: check logs, metrics, recent deployments

**5-15 Minutes (Investigation & Communication)**
1. Identify likely root cause (failed deployment, DB issue, external service down)
2. Post initial status to status page: "Service degraded; investigating root cause"
3. Notify VP Engineering and CEO via Slack (they monitor for P1s)
4. Customer communication team drafts customer notification
5. Begin remediation actions:
   - Rollback recent deployments
   - Restart services
   - Scale up resources
   - Switch to failover/backup systems

**15-30 Minutes (Mitigation & Escalation)**
1. Apply mitigation:
   - Rollback: `helm rollback kubilitics -n kubilitics`
   - Restart: `kubectl delete pods -n kubilitics`
   - Scale: `kubectl scale deployment kubilitics-backend -n kubilitics --replicas=5`
   - Failover: Switch to backup database or region

2. Verify mitigation:
   - `/health` endpoint returns 200
   - Sample API calls work
   - No new error logs
   - Synthetic monitoring passes

3. Post update to status page: "Mitigation in progress; service partially restored"
4. Notify customers via email/SMS (if data loss suspected)
5. If not resolved, escalate to VP Engineering for additional resources

**30+ Minutes (Sustained Incident)**
1. If still not resolved after 30 minutes:
   - Escalate to VP Engineering and Engineering Manager
   - Consider declaring P1 incident (alerts executive team)
   - Convene war room with key engineers, manager, VP
   - Implement longer-term workarounds (manual operations)

2. Continuous communication:
   - Status page update every 15 minutes minimum
   - Email customers hourly with progress
   - Maintain incident log with all actions taken

3. Post-incident actions:
   - Root cause analysis begins immediately after mitigation
   - CEO briefing at service restoration + 30 minutes
   - Customer communication plan for post-incident notifications

#### P2 Major Response

**0-15 Minutes**
1. On-call engineer acknowledges and starts investigation
2. Page on-call manager (if infrastructure issue; optional if frontend)
3. Create incident ticket: Priority = High
4. Post to status page (optional): "Investigating performance degradation"
5. Assess workaround availability

**15-30 Minutes**
1. Determine root cause:
   - Check recent deployments
   - Review error logs
   - Check metrics (CPU, memory, disk, API latency)
   - Verify Kubernetes API server health

2. Begin remediation:
   - Deploy fix (if quick code change)
   - Rollback if recent deployment is culprit
   - Scale resources if capacity issue
   - Restart problematic service

3. Communicate impact:
   - Notify customers of issue and workaround (if applicable)
   - Provide ETA for resolution

**30+ Minutes**
1. Continue investigation and remediation
2. Escalate to engineering manager if not resolved
3. Consider temporary workarounds for customers (manual process, API alternative)
4. Post hourly updates to customers

#### P3 Minor Response

**Next Business Day**
1. Engineer assigned to investigation ticket
2. Debug issue; identify root cause
3. Plan fix (code change, documentation update, configuration adjustment)
4. Implement and verify fix
5. Post-incident review (lightweight; 15-minute discussion)

**Communication:** Internal ticket tracking; no customer notification unless requested

#### P4 Low Response

**Next Sprint**
1. Add to product backlog
2. Triage during sprint planning
3. Assign engineer if priority warrants
4. Track in normal development workflow

**Communication:** None

### Root Cause Analysis

Initiated immediately after P1 incident; typically 24 hours for P2; within 1 week for P3.

**Investigation Steps:**
1. Gather timeline of events from logs and metrics
2. Identify exact time issue started vs. reported
3. Correlate with deployments, configuration changes, external events
4. Trace through code/infrastructure to find failure point
5. Document why system didn't catch issue (monitoring gap)

**Example Investigation:**

```
Incident: Database corruption at 2024-02-10 14:23 UTC

Timeline:
14:20 UTC - PostgreSQL upgrade started (planned)
14:23 UTC - Database locked; queries timing out
14:28 UTC - Backend service crashed (connection pool exhausted)
14:31 UTC - Alerts fired (error rate spike)
14:35 UTC - On-call engaged
14:42 UTC - Issue identified: upgrade process failed mid-transaction
14:50 UTC - Rollback completed; service restored

Root Cause:
- PostgreSQL 14→15 major version upgrade
- Upgrade process started without proper backup
- Failed on schema migration (custom type issue)
- Database left in inconsistent state
- No health check on database writability before declaring success

Why Not Caught:
- No monitoring on upgrade process completion
- No pre-upgrade validation checks
- Backup procedure not verified before upgrade start
```

---

## 3. Escalation Matrix

### P1 Critical Incident Escalation

**Tier 1 (On-Call Engineer)** — 0-5 minutes
- Acknowledges incident
- Begins initial investigation
- Performs basic troubleshooting (restart service, check logs)
- Page escalates if:
  - Issue confirmed > 5 minutes without obvious fix
  - Root cause unclear
  - Decision needed on rollback/breaking changes

**Tier 2 (Engineering Manager + VP Engineering)** — 5-15 minutes
- Notified of P1 incident
- Convene war room if not yet resolved
- Review investigation findings
- Make critical decisions:
  - Rollback yes/no
  - Scale infrastructure
  - Break SLAs to fix (e.g., slow migration)
  - Declare data loss
- Initiate customer communication
- Escalates if:
  - Issue unresolved after 30 minutes
  - Customer escalation received (CEO contact)
  - Data loss confirmed

**Tier 3 (CEO + Board)** — 15-30 minutes (if not resolved)
- Briefed on incident status
- Notified of customer impact and revenue implications
- Consulted on major decisions (disclosure, compensation)
- Public communication approved by CEO/legal if data loss involved
- Escalates if:
  - Unresolved after 60 minutes
  - Multiple customers filing complaints
  - Media coverage begins

### P2 Major Incident Escalation

**Tier 1 (On-Call Engineer)** — 0-30 minutes
- Investigates and works on fix
- Escalates if fix will take > 2 hours or requires rollback

**Tier 2 (Engineering Manager)** — 15-30 minutes
- Notified if not auto-resolved within 30 minutes
- Reviews investigation
- Approves major changes (rollback, breaking fixes)
- May assist with investigation if complex
- Escalates if unresolved after 4 hours or customer complaining

**Tier 3 (VP Engineering)** — 30-60 minutes
- Consulted if issue unresolved after 4 hours
- Makes decision on customer compensation/goodwill gesture
- Reviews post-incident process

### P3 Minor Incident Escalation

**Tier 1 (Assigned Engineer)** — Next business day
- Owns investigation and fix
- No escalation unless:
  - Affects multiple customers (may be P2)
  - Impacts security (may be P1)

### P4 Low Incident Escalation

**No escalation** — handled as regular sprint work

### On-Call Schedule

**Primary On-Call:** Rotates weekly, Monday 00:00 UTC - Sunday 23:59 UTC
**Secondary On-Call:** Follows primary with 30-minute delay before page
**Manager On-Call:** Separate rotation, available for P1/P2 escalation

**Escalation Timeline (all in UTC):**

| Time Elapsed | Action |
|---|---|
| Incident detected | Page primary on-call |
| 2 minutes (no ack) | Page secondary on-call |
| 5 minutes (no progress) | Page manager on-call |
| 15 minutes (P1 unresolved) | Page VP Engineering |
| 30 minutes (P1 unresolved) | Notify CEO |
| 1 hour (P1 unresolved) | Executive war room + legal |

---

## 4. Communication Templates

### Internal Incident Notification Template

```
TO: #incident-response Slack channel
SUBJECT: P[1-4] Incident - [Brief Description]
TIME: [UTC timestamp]

Summary:
- What happened: [One sentence describing issue]
- Impact: [Number of customers, features affected, duration]
- Status: [Investigating/Mitigating/Resolved]
- Severity: P[1-4]

Details:
- First detected: [timestamp]
- Duration: [X minutes so far]
- Affected customers: [List or count]
- Root cause (if known): [Brief explanation]

Investigation:
[Latest findings, actions taken, next steps]

Incident Lead: [Engineer name]
Escalation status: [Tier 1/2/3]
```

### User-Facing Status Update Template

```
Incident: [Brief Title]
Current Status: [Investigating/Partial Outage/Degraded Performance/Resolved]
Posted: [Timestamp]
Last Updated: [Timestamp]

Impact:
We are currently experiencing [brief description of impact]. This affects [features/regions].
Estimated customers impacted: [number/percentage].

What we're doing:
[2-3 bullet points of current mitigation actions]

Timeline:
- [Time 1]: Issue detected by monitoring
- [Time 2]: Investigation began; root cause identified
- [Time 3]: Mitigation in progress
- [Time 4 (if applicable)]: Service restored

Previous status updates:
[Link to previous statuses]

For support, contact support@kubilitics.io or #support-channel.
```

### Customer Email Notification Template (Pre-Impact)

```
Subject: [URGENT] Kubilitics Service Incident - [Date/Time]

Dear Valued Customer,

We are investigating a service incident affecting Kubilitics that began at [time UTC].

Impact:
- Features affected: [list]
- Status: [Investigating/Mitigation in progress]
- Estimated time to resolution: [timeframe]

What happened:
[2-3 sentences explaining the issue in customer-friendly terms]

What we're doing:
[Bullet list of remediation actions]

Workarounds:
[If available: alternative methods to access features]

We will provide updates every 30 minutes. For urgent support, contact
support@kubilitics.io with reference code [INCIDENT-ID].

We apologize for the disruption to your operations.

Best regards,
Kubilitics Incident Response Team
```

### Customer Email Notification Template (Data Loss)

```
Subject: SECURITY INCIDENT - Kubilitics Data Exposure [Date]

Dear Valued Customer,

We are writing to inform you of a security incident that may have impacted your data.

What happened:
On [date] at [time], [brief technical description of security breach].

Data affected:
- What: [kubeconfig files/secrets/logs/other]
- Who: [affected customers; "your account" or list]
- Timeframe: [when data may have been accessible]
- Scope: [number of records/documents exposed]

What we've done:
1. [Immediately revoked exposed credentials]
2. [Notified security authorities if required]
3. [Patched vulnerability]
4. [Verified no unauthorized access]
5. [Enhanced monitoring]

What you should do:
1. [Rotate kubeconfig/secrets if exposed]
2. [Audit cluster access logs]
3. [Change API keys]
4. [Review access logs for suspicious activity]

Resources:
- Full technical details: [link to security advisory]
- FAQ: [link to FAQ]
- Support: support@kubilitics.io

We take security extremely seriously and deeply regret this incident.

Best regards,
Kubilitics Security Team
```

### Post-Incident Summary Template

```
INCIDENT REPORT
Title: [Brief description]
Date: [Date of incident]
Severity: P[1-4]
Duration: [X hours Y minutes from detection to resolution]

Executive Summary:
[2-3 sentences; intended for non-technical stakeholders]
[What went wrong, customer impact, how it was fixed]

Timeline:
- [14:20] Monitoring alert fired; error rate spike detected
- [14:23] On-call engineer paged
- [14:28] Cause identified: recent deployment introduced bug
- [14:35] Fix deployed; service recovering
- [14:42] Service fully recovered; incident closed

Impact:
- Customers affected: [number]
- Features down: [list]
- Revenue impact: [$ or estimated SLA breach]
- Data loss: [yes/no; scope if yes]

Root Cause:
[Detailed technical explanation of what went wrong]
[Why it wasn't caught in testing]
[Why monitoring didn't catch it sooner]

Contributing Factors:
1. [Factor 1: e.g., "missing test case"]
2. [Factor 2: e.g., "monitoring gap"]
3. [Factor 3: e.g., "manual approval skipped"]

Action Items:
- [ ] Add test case for scenario X (Engineer A, due date)
- [ ] Implement alert for condition Y (Engineer B, due date)
- [ ] Update runbook with debugging steps (Engineer C, due date)
- [ ] Customer post-incident call (PM D, due date)
- [ ] Security review if applicable (Security team E, due date)

Lessons Learned:
1. [What we learned from this incident]
2. [How we'll prevent similar incidents]
3. [Process improvement identified]

Approval:
Incident Commander: [Name] - [Signature] - [Date]
Engineering Manager: [Name] - [Signature] - [Date]
VP Engineering: [Name] - [Signature] - [Date]
```

---

## 5. Post-Incident Review

Post-incident reviews occur at different intervals based on severity:

- **P1 Critical:** Within 24 hours (same business day if possible)
- **P2 Major:** Within 5 business days
- **P3 Minor:** Combined monthly review for all P3+ incidents
- **P4 Low:** No formal review

### Root Cause Analysis (5 Whys Methodology)

Start with the incident and ask "Why?" five times to get to root cause.

**Example: Database Connection Pool Exhaustion**

```
Incident: "Database connections exhausted; service down"

1. Why did database connections exhaust?
   → Backend service spun up 100 new connections during deployments.

2. Why did backend spin up so many new connections?
   → Deployment used wrong connection pool size (100 vs 20).

3. Why was wrong connection pool size used?
   → Configuration not validated before deployment; default overrode setting.

4. Why wasn't configuration validated?
   → No automated test checking connection pool limits; relies on manual review.

5. Why doesn't manual review catch this?
   → Code review process doesn't include operational/configuration review;
     developers don't check deployment impact.

ROOT CAUSE: Lack of operational testing in CI/CD pipeline for configuration changes.

SOLUTION: Add smoke test validating configuration before deployment.
```

### Action Items Tracking

Action items from post-incident review are tracked in project management system with:
- Clear owner (engineer name)
- Completion deadline (typically 2-4 weeks)
- Status tracking (backlog → in-progress → done)
- Verification step (how we know it's done)
- Impact if not completed (e.g., "another similar incident likely within 3 months")

**Example Action Item:**
```
Title: Add alert for database connection pool > 80%
Owner: Engineer A
Deadline: Feb 24, 2026
Status: In Progress
Priority: High (prevents P1 repeat)

Description:
Implement Prometheus alert: kubilitics_database_connections_active /
kubilitics_database_connections_max > 0.8

Acceptance Criteria:
- Alert fires when connection pool > 80%
- Alert routed to on-call engineer
- Test verified alert works
- Alert added to runbook

Verification:
- [ ] Alert appears in Prometheus
- [ ] Alert appears in alert console
- [ ] Slack notification received on threshold breach
- [ ] Dashboard updated with alert metric
```

### Review Meeting Format

**Attendees:** Incident commander, engineers involved, engineering manager, affected customers (optional)

**Duration:** 60 minutes

**Agenda:**
1. Incident summary (5 min): What happened, timeline, impact
2. Root cause analysis (15 min): 5 Whys; identifying the root, not symptoms
3. Action items (20 min): Define preventive and detective measures
4. Assign owners (10 min): Clear ownership of action items
5. Follow-up (10 min): How we'll track completion; next review date

**Blameless Culture:**
- Focus on systems and processes, not individuals
- Frame as "Why did the system allow this?" not "Who made the mistake?"
- Assume good intent; find improvement opportunities
- Document lessons for future reference

**Outcomes:**
- Action item list with owners and deadlines
- Lessons learned document published to wiki
- Runbook updates (if needed)
- Process improvement recommendations

---

## 6. Specific Scenario Playbooks

### Scenario 1: AI Hallucination Causes Incorrect Cluster Modification

**Trigger:**
- AI service proposes to delete critical resource (e.g., delete all pods in prod namespace)
- User/admin approves action unaware it's incorrect
- AI executes and deletes resources

**Detection:**
- User notices pods disappearing unexpectedly
- Monitoring shows pod count drop >50%
- Support ticket: "All my pods were deleted!"

**Immediate Response (0-15 minutes):**

1. **Confirm Scope of Damage**
   ```bash
   kubectl get pods -n prod  # Check what's actually deleted
   kubectl get events -n prod --sort-by='.lastTimestamp' | head -20  # See deletion events
   ```

2. **Stop Further Damage**
   - Immediately revoke AI service access (remove kubeconfig token)
   - Disable AI investigation and autonomous actions
   - Restart AI service with safe_autonomy_level=1 (review-only mode)

3. **Severity Assessment**
   - P1 if: Production workloads deleted, no restore point available
   - P2 if: Test workloads deleted or restore available
   - Check if data/state was lost (stateless vs stateful resources)

4. **Stakeholder Notification**
   - Notify VP Engineering and Customer Success immediately
   - Create war room for coordination
   - Prepare customer communication

**Mitigation (15-60 minutes):**

1. **Restore from Backups**
   ```bash
   # If cluster state backup available (Velero or similar)
   velero restore create --from-backup prod-backup-20260210-1400 --wait

   # If using GitOps (Flux, ArgoCD)
   kubectl apply -f kubernetes-configs/prod/
   argocd app sync kubilitics-prod
   ```

2. **Verify Restoration**
   - Confirm pods restarted and healthy
   - Verify data persistence (PVCs intact)
   - Run smoke tests on critical services

3. **Root Cause Investigation**
   - Review AI conversation/decision log
   - Identify where AI hallucinated (misunderstood context)
   - Check if user correctly understood action before approval

**Example Scenario Logs:**

```
AI Recommendation (fabricated):
"Identified unused pods in production consuming resources.
Recommend deleting all pods in namespace 'prod' to save $500/month."

User Review (insufficient):
Admin sees "save $500/month" and thinks "production cost optimization".
Approves without reading full description.

Reality:
All production workloads terminated; revenue impact > $50,000/hour.
Namespacing was wrong; AI didn't understand "prod-testing" vs "prod".
```

**Prevention Actions:**
1. Add safety check: AI cannot delete >10 pods without explicit "delete all" confirmation
2. Require user to type pod names being deleted (prevents approval without review)
3. Implement gradual rollout for deletion actions (delete 1, verify, delete rest)
4. Add AI confidence score to recommendations; require >95% confidence for deletions
5. Require multi-step approval for resource deletion in production
6. Enhanced AI training: provide clear namespace definitions in system prompt

**Long-term Fixes:**
- Implement RBAC limiting AI service to read-only or specific namespaces
- Add policy engine: AI cannot delete >5 resources or >10% of namespace
- Implement dry-run mode: show what would be deleted before executing
- Add "undo" feature: keep 24-hour trash for recently deleted resources

---

### Scenario 2: LLM Provider API Key Leak

**Trigger:**
- API key accidentally committed to GitHub repository
- API key logged in plain text in debug logs
- API key exposed in customer configuration export
- Attacker/researcher discovers key in public source code repository

**Detection:**
- GitHub secret scanning alerts (if public repo)
- LLM provider sends notification of unusual usage from new IP
- Monitoring shows token usage spike (3x normal rate)
- Support ticket: "Someone's using my API key!"

**Immediate Response (0-10 minutes):**

1. **Confirm Compromise**
   ```bash
   # Check for unusual API usage
   # OpenAI: Login to dashboard > Usage > View activity
   # Look for requests from unusual IPs or high token burn

   # Check git history
   git log --all -p | grep -i "sk-" | head -20

   # Scan current codebase
   grep -r "sk-" --include="*.go" --include="*.yaml" --include="*.json"
   ```

2. **Revoke Compromised Key**
   - Log into LLM provider (OpenAI, Anthropic, etc.)
   - Delete/revoke the exposed API key immediately
   - This stops all API calls using that key

3. **Generate Replacement Key**
   - Create new API key in LLM provider console
   - Update configuration: edit ~/.kubilitics/ai-config.yaml
   - Update Kubernetes secret if in-cluster:
     ```bash
     kubectl patch secret llm-config -n kubilitics \
       -p '{"data":{"api-key":"'$(echo -n new-key | base64)'"}}'
     ```
   - Restart AI service:
     ```bash
     kubectl rollout restart deployment/kubilitics-ai -n kubilitics
     ```

4. **Verify New Key Works**
   ```bash
   curl -X GET http://localhost:8081/api/v1/ai/status | jq .llm_provider.connectivity
   ```

5. **Stop Bleeding**
   - Disable AI service if new key not immediately available
   - Set autonomy level to 1 (review-only) until verified working
   - Reduce budget limit temporarily to minimize exposure

**Investigation (10-60 minutes):**

1. **Find Root Cause of Leak**
   - Check git history for all commits with API keys
   - Search logs for plaintext keys
   - Review configuration exports/backups
   - Check if key was ever exposed in error messages or logs

2. **Identify Exposure Window**
   - When was key first exposed (commit date, log date)?
   - How long was it accessible (before revoked)?
   - Was it in public repo or private repo?
   - Who had access to the compromised location?

3. **Calculate Blast Radius**
   - How many tokens were consumed by attacker (if any)?
   - What operations were performed? (Might tell us attacker intent)
   - Were there any unauthorized modifications to Kubernetes clusters?

**Remediation (60+ minutes):**

1. **Remove Key from History (if in Git)**
   ```bash
   # WARNING: Rewrites history; requires force push
   git filter-branch --force --index-filter \
     'git rm --cached --ignore-unmatch ~/.kubilitics/ai-config.yaml' \
     HEAD

   # Add to .gitignore
   echo "~/.kubilitics/ai-config.yaml" >> .gitignore
   echo "**/*.key" >> .gitignore
   echo "**/*.pem" >> .gitignore

   git add .gitignore
   git commit -m "Add secrets to .gitignore; prevent future leaks"
   git push origin master --force-with-lease
   ```

2. **Implement Prevention**
   - Pre-commit hook that scans for API keys
   - Secret management tool (Vault, sealed-secrets, external-secrets)
   - Environment variables instead of config files
   - Code review checklist: "No secrets in code/logs/configs?"

3. **Audit and Remediation**
   - Check all API calls using exposed key (LLM provider audit log)
   - If attacker accessed customer data, trigger data breach response
   - Notify affected customers if their data was accessed
   - File GDPR notification if PII accessed (if applicable)

**Customer Communication:**

```
Subject: Security Incident - API Key Exposure [KUBILITICS]

Dear Valued Customer,

We are writing to inform you of a security incident affecting Kubilitics AI service.

What Happened:
On [date], an API key for our LLM service provider was inadvertently exposed in
our GitHub repository. We immediately revoked the key upon discovery.

Impact:
- Your cluster access: NOT AFFECTED (different credentials)
- Your data: UNDER REVIEW (investigating API access logs)
- Your AI service: UNAFFECTED (using new key as of [time])
- Potential attacker access: [X hours; investigating activity]

What We've Done:
1. Revoked exposed API key immediately
2. Generated new API key and updated all systems
3. Audited LLM provider logs for unauthorized use
4. Enhanced controls to prevent future key exposure
5. Notified security authorities [if required]

What You Should Do:
- No immediate action required
- Monitor your cluster for unusual activity
- We'll provide full incident report within 48 hours
- Please contact support if you have concerns

We deeply regret this oversight and are implementing additional safeguards.

Best regards,
Kubilitics Security Team
```

---

### Scenario 3: Kubeconfig Exposure

**Trigger:**
- Kubeconfig file uploaded to customer support portal
- Kubeconfig file shared via unencrypted email
- Kubeconfig file left in logs or error messages
- Kubeconfig file accessible in web browser (misconfigured backup)
- Kubeconfig file committed to GitHub

**Detection:**
- Support receives kubeconfig as attachment
- Kubeconfig appears in logs/error messages
- Monitoring detects API calls from unusual IP address
- Attacker uses kubeconfig to access cluster

**Immediate Response (0-5 minutes):**

1. **Confirm Compromise**
   ```bash
   # Check kubeconfig for credentials
   grep -A5 -B5 "client-certificate-data\|client-key-data" ~/.kube/config

   # Check Kubernetes audit logs for unusual activity
   kubectl get events -A --sort-by='.lastTimestamp' | tail -50

   # Check for new service accounts or RBAC changes
   kubectl get serviceaccount -A
   kubectl get rolebinding -A
   ```

2. **Revoke Access Immediately**
   - Revoke client certificate used in kubeconfig:
     ```bash
     # Get certificate details
     kubectl get csr  # List certificate signing requests
     kubectl delete csr <name>  # Delete any pending CSRs
     ```

   - Or rotate kubeconfig user credentials:
     ```bash
     # Generate new certificate
     openssl req -new -key user.key -out user.csr
     # Sign with cluster CA
     # Update kubeconfig with new cert
     ```

   - Delete exposed service account:
     ```bash
     kubectl delete serviceaccount <exposed-sa> -n <namespace>
     ```

3. **Assess Damage**
   - What permissions did exposed credentials have? (read all, write all, delete all?)
   - What did attacker do with access? (check audit logs)
   - Were any resources modified or deleted?
   - Was sensitive data accessed? (logs, secrets, environment variables)

**Damage Assessment (5-30 minutes):**

1. **Review Kubernetes Audit Logs**
   ```bash
   # Check for unusual API calls
   kubectl logs -n kube-system -l component=kube-apiserver | grep "user" | tail -100

   # Look for:
   # - API calls from unusual users or service accounts
   # - Get requests on Secrets (unauthorized data access)
   # - Delete requests on resources
   # - Create requests for new service accounts or RBAC
   # - Port-forward or exec requests (remote access)
   ```

2. **Determine Scope**
   - How long was kubeconfig exposed?
   - What namespaces/resources could be accessed?
   - Were sensitive resources touched (secrets, configmaps)?
   - Did attacker create persistent backdoor (new user, service account)?

**Mitigation:**

1. **Revoke All Exposed Credentials**
   - Delete service account: `kubectl delete sa -n kube-system`
   - Revoke client certificate: delete certificate from apiserver
   - Rotate kubeconfig context: generate new cert for user

2. **Reset Cluster to Known Good State**
   - Restore from backup if resources modified
   - Review all RBAC bindings for unauthorized additions
   - Check for new service accounts or webhooks
   - Scan container images for unauthorized changes

3. **Implement Monitoring**
   - Enable audit logging if not already enabled
   - Monitor for unauthorized API access attempts
   - Alert on suspicious patterns (unusual users, high delete rate)

**Prevention:**

1. **Secrets Management**
   - Never paste kubeconfig in emails, chat, or support tickets
   - Use encrypted file sharing for kubeconfig
   - Implement kubeconfig encryption at rest
   - Use temporary credentials (short-lived tokens)

2. **Access Control**
   - Implement RBAC limiting service account permissions
   - Use NetworkPolicy to limit pod-to-API-server communication
   - Require mutual TLS for API calls
   - Implement API rate limiting per user/IP

3. **Detection**
   - Enable audit logging (log all API calls)
   - Monitor for suspicious patterns
   - Alert on certificate expiration (signals rotation needed)

---

### Scenario 4: Unauthorized AI Autonomous Action

**Trigger:**
- AI service configured with high autonomy level (level 3)
- AI service executes harmful action: scales deployment to zero, deletes resource
- User didn't authorize action; AI auto-executed based on internal decision

**Detection:**
- User notices resource deleted/modified unexpectedly
- Monitoring shows resource count dropped
- Application outage caused by AI action
- Support ticket: "My deployment was scaled to zero; I didn't do that!"

**Immediate Response:**

1. **Stop AI Service**
   ```bash
   kubectl delete pod -n kubilitics kubilitics-ai-<pod-id>
   # Or
   systemctl stop kubilitics-ai
   ```
   This prevents further autonomous actions.

2. **Assess Damage**
   - What resource was modified/deleted?
   - Why did AI think this was appropriate?
   - Can it be easily restored?

3. **Restore Service**
   - If deleted: `kubectl apply -f backup.yaml` or restore from git
   - If scaled to zero: `kubectl scale deployment app --replicas=3`
   - If configuration modified: revert to previous version

4. **Set Autonomy Level to 1 (Review-Only)**
   ```bash
   kubectl edit configmap kubilitics-ai-config -n kubilitics
   # Change: safety_policy.autonomy_level: 1  # Review before apply
   kubectl restart pod kubilitics-ai -n kubilitics
   ```

**Investigation:**

1. **Review AI Decision Log**
   ```bash
   # Check what AI thought it should do
   kubectl logs -n kubilitics kubilitics-ai-<pod-id> | grep "action\|decision\|approve"

   # Look for investigation that led to action
   curl http://localhost:8080/api/v1/ai/investigations | jq -r '.items[0] | .recommendations'
   ```

2. **Identify Why Action Was Taken**
   - Was recommendation incorrect? (faulty analysis)
   - Was recommendation correct but autonomy level wrong? (policy issue)
   - Was there a bug in safety checks? (should have required approval)

3. **Example Investigation**
   ```
   AI Logs:
   - Generated insight: "Deployment scaled to 3 replicas; 1 pod with memory leak"
   - Recommendation: "Scale down to 1 replica during maintenance window"
   - Proposed action: "Scale deployment to 1 replica"
   - Autonomy check: "Safe operation + no critical namespace = auto-approve"
   - Action executed: "Scaled deployment to 1 replica"

   Problem:
   - AI recommendation was reasonable (memory leak)
   - But autonomy check missed: scaling to 1 = service unavailable
   - Safety policy should block: "scale_to_zero" or low replicas
   ```

**Prevention:**

1. **Tighten Autonomy Policy**
   ```yaml
   safety_policy:
     autonomy_level: 2  # Safe-auto, not full-auto
     forbidden_operations:
       - "scale_to_zero"
       - "scale_to_low_replicas"  # < 2 for production
       - "delete_statefulset"
     require_approval:
       scale_deployment: true
       modify_resources: true
       delete_pod: true
   ```

2. **Improve AI Safety Checks**
   - Require multi-step approval for breaking changes
   - Require confirmation: "This will cause X downtime; approve?"
   - Never auto-approve production changes (different rules for dev/staging)
   - Require at least 2 safety checks to pass (redundancy)

3. **Enhanced Monitoring**
   - Alert on resource scaling or deletion triggered by AI
   - Require manual approval before action execution (even level 3)
   - Log all AI decisions with confidence score
   - Audit trail of all autonomous actions

---

### Scenario 5: Database Corruption

**Trigger:**
- Database transaction fails mid-way (upgrade, large migration)
- Database file corrupted (disk failure, unexpected shutdown)
- Data integrity violation (foreign key constraint violated)
- Backup also corrupted (same corruption in backups)

**Detection:**
- Backend service logs: "database integrity check failed"
- Queries returning corrupted data or errors
- Application errors from invalid data state
- Database consistency check fails

**Immediate Response (0-10 minutes):**

1. **Take Database Offline**
   ```bash
   # Stop backend and AI services
   kubectl scale deployment/kubilitics-backend --replicas=0 -n kubilitics
   kubectl scale deployment/kubilitics-ai --replicas=0 -n kubilitics
   ```
   Prevent further writes to corrupted database.

2. **Assess Damage**
   ```bash
   # Check database integrity
   sqlite3 ~/.kubilitics/data.db "PRAGMA integrity_check;"
   # or PostgreSQL
   pg_ctl start  # If stopped
   pg_dump --schema-only
   ```

3. **Severity Assessment**
   - P1 if: No valid backup available; data permanently lost
   - P1 if: Corruption involves customer data (secrets, logs, configs)
   - P2 if: Valid backup available; short restore window
   - P2 if: Corruption in non-critical data (investigation cache)

**Restore from Backup (10-60 minutes):**

1. **Verify Backup Validity**
   ```bash
   # Test restore in isolated environment
   cp ~/backups/kubilitics-20260210.db /tmp/test-restore.db
   sqlite3 /tmp/test-restore.db "PRAGMA integrity_check;"

   # Or PostgreSQL
   pg_restore --list kubilitics-20260210.dump | head -20
   pg_restore --data-only --exit-on-error -d test_db kubilitics-20260210.dump
   ```

2. **Restore to Production**
   ```bash
   # SQLite
   rm ~/.kubilitics/data.db
   cp ~/backups/kubilitics-20260210.db ~/.kubilitics/data.db

   # PostgreSQL
   psql -U postgres -c "DROP DATABASE kubilitics;"
   createdb -U postgres kubilitics
   pg_restore -U postgres -d kubilitics ~/backups/kubilitics-20260210.dump
   ```

3. **Restart Services**
   ```bash
   kubectl scale deployment/kubilitics-backend --replicas=3 -n kubilitics
   kubectl scale deployment/kubilitics-ai --replicas=2 -n kubilitics
   kubectl get pods -w  # Monitor pod startup
   ```

4. **Verify Restoration**
   - Run integrity check: `sqlite3 data.db "PRAGMA integrity_check;"`
   - Verify data completeness: Row counts match expectations
   - Test functionality: Get resources, list pods, etc.
   - Monitor error logs for 30 minutes

**Damage Assessment & Investigation:**

1. **Data Loss Quantification**
   - What time period was last valid backup from?
   - What data was lost (investigations, insights, configurations)?
   - Can lost data be reconstructed from external sources?

2. **Root Cause Analysis**
   - Why did database corrupt? (hardware failure, software bug, human error)
   - Why wasn't corruption detected earlier? (missing integrity checks)
   - Why weren't backups valid? (corruption also in backups)

3. **Communication Requirements**
   - If customer data lost: data breach notification
   - Transparency about issue and remediation
   - Compensation offer (free service credit, etc.)

**Prevention:**

1. **Backup Improvements**
   - Take snapshots more frequently (daily → every 6 hours)
   - Test restore procedure regularly (weekly)
   - Keep backup in separate location/system (not same storage)
   - Verify backup integrity before keeping (not just file existence)

2. **Data Integrity Checks**
   - Regular PRAGMA integrity_check for SQLite
   - PostgreSQL consistency checks (amcheck extension)
   - Row count checks (compare current vs backup)
   - Foreign key constraint validation

3. **Hardware/Failure Prevention**
   - Use redundant storage (RAID 1 or higher)
   - Enable write-ahead logging (WAL)
   - Monitor for disk errors (smartctl)
   - Implement database replication (PostgreSQL primary-standby)

---

### Scenario 6: DDoS on API Endpoints

**Trigger:**
- API receives 100,000+ requests/second from multiple IPs
- Backend CPU usage spikes to 100%
- Network bandwidth saturated
- Service becomes unavailable to legitimate users

**Detection:**
- Monitoring alerts: Request rate > 10,000 req/s
- Error rate spikes (503 Service Unavailable)
- Network monitoring shows traffic from specific CIDR blocks
- User complaints: "Site is slow"

**Immediate Response (0-5 minutes):**

1. **Confirm DDoS**
   ```bash
   # Check request sources
   tail -1000 /var/log/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -20

   # Check request rate
   curl http://localhost:9090/api/v1/query?query=rate(kubilitics_requests_total[1m])

   # Identify pattern (single IP, CIDR block, specific endpoint)
   ```

2. **Enable DDoS Mitigation**
   - Rate limiting (aggressive): 10 requests/minute per IP (vs normal 200)
   - GEO-blocking if attack from specific country
   - Cloudflare/CDN WAF rules: block suspicious patterns

3. **Notification**
   - Notify security team immediately
   - Notify cloud provider (AWS, GCP, Azure) for network-level mitigation
   - Update status page: "Experiencing DDoS attack; working with ISP"

**Mitigation:**

1. **Network-Level Defenses**
   - Contact cloud provider: activate DDoS protection (AWS Shield, GCP DDoS Protection)
   - Implement rate limiting at load balancer/ingress
   - Block known attack source IPs using WAF or firewall
   - Enable CAPTCHA for suspicious traffic patterns

2. **Application-Level Defenses**
   - Reduce rate limits for non-authenticated requests
   - Cache responses for common queries
   - Implement circuit breaker: return cached response under load
   - Drop non-critical requests (only serve authenticated users)

3. **Infrastructure Scaling**
   - Auto-scale backend to handle traffic surge
   - Increase load balancer capacity
   - Utilize CDN caching for static assets
   - Implement API gateway that can handle DDoS better than application

4. **Example Kubernetes Scaling**
   ```bash
   # Temporarily increase max replicas
   kubectl autoscale deployment kubilitics-backend \
     --min=5 --max=50 \
     --cpu-percent=50 -n kubilitics

   # Monitor
   kubectl top pods -n kubilitics
   kubectl get hpa -n kubilitics -w
   ```

**Investigation (After Mitigation):**

1. **Analyze Attack Pattern**
   - Source IPs: single source, botnet, or compromised ISP?
   - Target: all endpoints or specific ones?
   - Attack vector: volumetric (many requests), protocol (malformed), application (expensive queries)?
   - Timing: continuous or waves? Related to news event or specific target?

2. **Identify Perpetrator (if possible)**
   - IP geolocation and ISP
   - Timing relative to world events
   - Attack sophistication (indicates skill level)
   - Claimed responsibility (check social media, email)

3. **Law Enforcement (if severe)**
   - Contact FBI (US) or local equivalent
   - Preserve logs and evidence
   - Provide attack details to law enforcement

**Prevention:**

1. **Infrastructure Hardening**
   - Implement DDoS protection service (Cloudflare, AWS Shield Advanced)
   - Use anycast network for geographic distribution
   - Implement rate limiting at all layers
   - Require authentication for expensive operations

2. **Monitoring Improvements**
   - Alert on request rate > 5,000 req/s
   - Alert on error rate > 10%
   - Alert on requests from single IP > 100 req/sec
   - Monitor for cache hit/miss ratio (indicates legitimate vs bot traffic)

3. **Long-term Resilience**
   - Design API to handle graceful degradation
   - Implement read replicas to scale API latency
   - Consider hybrid deployment (on-prem + cloud)
   - Plan for attack; update runbook with proven mitigation steps

---

### Scenario 7: Supply Chain Compromise (Dependency Vulnerability)

**Trigger:**
- Security researcher discovers 0-day vulnerability in Go package (e.g., gorilla/mux)
- Vulnerability disclosed publicly (not responsible disclosure)
- CVE published before patch available
- Compromised package that injects malicious code

**Detection:**
- Security advisory published
- CVE score > 8.0 (high severity)
- Dependency scanning tool (Snyk, WhiteSource) sends alert
- Community message: "gorilla/mux 1.8.0 has RCE vulnerability"

**Immediate Response (0-30 minutes):**

1. **Verify Vulnerability Impact**
   ```bash
   # Check current version
   go list -m all | grep gorilla/mux
   # Output: github.com/gorilla/mux v1.8.0

   # Check vulnerability details
   go list -json github.com/gorilla/mux | jq .Module

   # Is version vulnerable? (Check CVE database)
   # gorilla/mux CVE-2024-1234: affects 1.8.0
   # Fixed in: 1.8.1+
   ```

2. **Assess Risk**
   - Vulnerability type: RCE, data leak, DoS?
   - Affected component: gorilla/mux is HTTP router; used in backend
   - Required conditions: Does vulnerability require authentication? Input manipulation?
   - Real-world exploitability: Is working exploit available?

   **Example Assessment:**
   ```
   Vulnerability: gorilla/mux RCE in path matching
   Severity: CVSS 9.8 (Critical)
   Affected version: 1.8.0 (we're on 1.8.0)
   Fixed version: 1.8.1 (released today)

   Risk: HIGH
   - RCE = remote code execution = attacker can run arbitrary code
   - No authentication required = unauthenticated attacker
   - Path matching is used in all requests = easy to trigger
   - Public exploit available on GitHub

   Decision: URGENT patch required
   ```

3. **Plan Patch**
   - If patch available: upgrade dependency immediately
   - If patch not available: implement mitigation (WAF rule, disable feature)
   - Communicate with customers: "Critical security update coming within 24 hours"

**Patch & Deploy (30-120 minutes):**

1. **Update Dependency**
   ```bash
   go get -u github.com/gorilla/mux@v1.8.1
   go mod tidy
   go mod verify  # Verify checksums match official package
   ```

2. **Verify No Breaking Changes**
   ```bash
   go build ./...
   go test ./...
   # Run integration tests against vulnerable functionality
   ```

3. **Build & Test**
   ```bash
   # Build new Docker image
   docker build -t kubilitics/backend:1.0.1-patch1 .
   docker push kubilitics/backend:1.0.1-patch1

   # Test in staging
   kubectl set image deployment/kubilitics-backend-staging \
     kubilitics-backend=kubilitics/backend:1.0.1-patch1 -n staging
   ```

4. **Deploy to Production (High Priority)**
   ```bash
   # Production deployment (rolling update)
   kubectl set image deployment/kubilitics-backend \
     kubilitics-backend=kubilitics/backend:1.0.1-patch1 -n kubilitics

   # Monitor rollout
   kubectl rollout status deployment/kubilitics-backend -n kubilitics

   # Verify
   curl https://kubilitics.example.com/health
   ```

5. **Notify Customers**
   ```
   Subject: URGENT Security Update - Kubilitics [Date]

   Dear Valued Customer,

   A critical security vulnerability (CVE-2024-1234) was discovered in a
   dependency used by Kubilitics. We have immediately deployed a patch.

   What we did:
   - Updated gorilla/mux from 1.8.0 to 1.8.1
   - Deployed patch to all production instances
   - Verified patch in staging environment
   - Audited logs for any unauthorized access

   What you should do:
   - Update Kubilitics to version 1.0.1 (released today)
   - Monitor cluster activity logs for suspicious behavior
   - Rotate kubeconfig credentials as precaution

   This vulnerability affected the HTTP request handling layer and could
   allow remote code execution. There was a brief window of exposure before
   our patch was deployed.

   We apologize for any concern this may cause and are implementing additional
   security measures.

   Best regards,
   Kubilitics Security Team
   ```

**Post-Patch Investigation:**

1. **Audit Logs for Exploitation**
   - Were malicious requests detected before patch?
   - Any suspicious API calls or resource access?
   - Check application logs for injection attempts

2. **Dependency Security Review**
   - Add all dependencies to scanning tool (Snyk, WhiteSource)
   - Set up automated alerts for vulnerabilities
   - Schedule regular dependency updates (monthly)
   - Implement SBOM (Software Bill of Materials) for transparency

3. **Process Improvements**
   - Add pre-deployment security scan to CI/CD
   - Require signature verification for dependencies
   - Implement vendoring to ensure integrity
   - Create vulnerability response playbook (what you're reading)

---

## Appendix: Incident Response Training

### Tabletop Exercise: Database Failure Simulation

**Scenario:** Production PostgreSQL database fails unexpectedly during peak usage hours.

**Participants:** On-call engineer, engineering manager, customer success, security

**Timeline:**

| Time | Event | Facilitator Describes | Participants Respond |
|------|-------|-----|-------|
| 0 min | Incident starts | "Database is down; error rate 100%; customer complaints arriving" | Engineers begin investigation; on-call paged |
| 5 min | Uncertainty | "Database reports 'connection refused'; unclear if hardware or software" | Assess damage; check backups; prepare communication |
| 10 min | Pressure | "3 customers already contacted support; media asking questions" | Decide on rollback vs repair; notify stakeholders |
| 20 min | Escalation | "Couldn't resolve in 20 minutes; now what?" | Escalate to VP; discuss customer compensation |
| 30 min | Resolution | "Backup restore completed; data loss from 5:10-5:35 UTC (25 minutes)" | Verify restoration; notify customers; schedule RCA |

**Learning Outcomes:**
- Practiced incident response procedures
- Identified gaps (missing backup test, unclear escalation path)
- Improved team communication under stress
- Generated action items for improvements

**Recommendation:** Conduct tabletop exercises quarterly with rotated participants to keep skills sharp.

