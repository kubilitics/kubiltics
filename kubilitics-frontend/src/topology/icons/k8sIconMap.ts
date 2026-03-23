/**
 * Maps Kubernetes resource kinds to their icon URLs.
 * SVG assets are not yet bundled — returns empty map so K8sIcon
 * falls back to the generic icon. Replace with real SVG imports
 * when assets are added to ./svgs/.
 */
const k8sIconMap: Record<string, string> = {};

export default k8sIconMap;
