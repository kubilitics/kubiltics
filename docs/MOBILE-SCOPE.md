# Mobile scope and use cases (MO1.1)

This document defines the primary mobile use cases for Kubilitics. Mobile is **after desktop** in the roadmap; the app is **not** "full desktop on mobile."

## Primary flows (3–5)

1. **Alerts (push)**  
   Receive push notifications for critical cluster events (e.g. pod crash loop, node NotReady, deployment failed). Tap to open the app to the relevant resource or cluster view.

2. **Read-only cluster and resource view**  
   View cluster list (from backend), select a cluster, and browse resources (pods, deployments, etc.) or a simplified topology summary. No kubeconfig on device; all data via HTTPS to the Kubilitics backend. Optional offline cache of last-viewed data.

3. **Incident acknowledgment**  
   From an alert or event, acknowledge or annotate (e.g. "Investigating", "Acknowledged"). State is sent to the backend and can be shown in the desktop or shared with the team.

4. **Quick status dashboard**  
   Single screen: cluster health, critical events count, recent alerts. No deep editing; focus on "is everything OK?" and "what needs attention?"

5. **Optional: link to runbooks or docs**  
   From an event or resource, open a deep link to internal runbooks or docs (e.g. URL scheme or in-app webview). No execution of arbitrary commands from mobile.

## Out of scope for mobile (by design)

- Full topology graph editing or complex navigation.
- Applying YAML or running kubectl-style commands from the device.
- Storing or pasting kubeconfig on the device.
- Full feature parity with desktop (e.g. 50+ resource types in full detail).

## Backend and security

- **Backend only:** Mobile app talks only to the Kubilitics backend over HTTPS. No direct Kubernetes API access from the device.
- **Identity:** Reuse backend auth (e.g. same SSO or API key as web/desktop when implemented); no separate "mobile-only" credential store beyond app-level auth.
- **Offline:** Optional cache of last cluster list, last topology summary, or last resource view for read-only display when offline; no mutations offline.

## Implementation order (optional)

- **MO1.2** Mobile API client and offline cache (HTTPS to backend; cache topology/last view).
- **MO1.3** Push notifications spec (payload and deep link for critical events; APNs/FCM later).
- **MO1.4** Biometric / PIN (optional) to unlock app.
- **MO1.5** Tauri mobile init and build (iOS/Android); store submission steps doc.

See **TASKS.md** Phase MO for the full task list.
