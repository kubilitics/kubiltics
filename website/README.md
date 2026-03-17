This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).
# Kubilitics Enhanced Application Preview

This document provides an enhanced preview of the Kubilitics application, showcasing advanced resource interactions, the add-ons platform, and multi-cluster management.

## Enhanced Preview Video

The following video captures advanced features including terminal access, pod-level resource inspection, add-ons management, and seamless switching between local and cloud (AKS/EKS) clusters.

![Kubilitics Enhanced Preview](/Users/koti/.gemini/antigravity/brain/031ed543-15c1-4cf7-bdc6-64392c40d37e/kubilitics_enhanced_preview_1773706727764.webp)

## Key Enhancements Explored

### 1. Advanced Resource Tabs
- **Pods Tab (Deployments/Nodes)**: Demonstrated the ability to drill down into underlying pods directly from a Deployment or Node detail page.
- **Terminal Tab (Pod Details)**: Showcased live remote shell access to running containers (verified on the AKS cluster).

### 2. Add-ons Platform
- **Catalog**: Explored the available Helm charts from Artifact Hub, ready for deployment.
- **Installed**: Viewed the list of currently deployed add-ons across the fleet.

### 3. Multi-Cluster Fleet Management
- **Seamless Switching**: Demonstrated rapid context switching between `docker-desktop`, `akscluster-az-dev-aks`, and `kcluster-aws-dev-eks`.
- **Resilience**: Observed the system's ability to handle cluster-specific states (e.g., circuit breaker active for `docker-desktop` while others remain healthy).

### 4. Interactive Topology
- Rendered resource relationship maps for cloud-hosted environments (AKS), highlighting the application's ability to visualize complex deployments regardless of infrastructure provider.

## Conclusion
The application demonstrates full feature parity across diverse cluster environments, providing a unified and powerful interface for managing Kubernetes resources at scale.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
