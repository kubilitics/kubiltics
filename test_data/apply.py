#!/usr/bin/env python3
"""
Apply demo resources for Kubilitics (Workloads + Networking).
Idempotent: skips a category if current count >= min_count. Requires kubectl.
"""
import argparse
import os
import subprocess
import sys


def run(*args, check=True, capture=True):
    cmd = ["kubectl"] + list(args)
    result = subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=False,
    )
    if check and result.returncode != 0:
        sys.stderr.write(result.stderr or "")
        raise SystemExit(result.returncode)
    return result


def count_in_ns(kind: str, namespace: str) -> int:
    r = run("get", kind, "-n", namespace, "--no-headers", check=False)
    if r.returncode != 0:
        return 0
    return len([x for x in (r.stdout or "").strip().split("\n") if x.strip()])


def count_cluster_scoped(kind: str) -> int:
    r = run("get", kind, "--no-headers", "-A", check=False)
    if r.returncode != 0:
        return 0
    return len([x for x in (r.stdout or "").strip().split("\n") if x.strip()])


def main():
    parser = argparse.ArgumentParser(description="Apply Kubilitics demo resources")
    parser.add_argument("--namespace", "-n", default=os.environ.get("NAMESPACE", "kubilitics-demo"))
    parser.add_argument("--min-count", "-m", type=int, default=int(os.environ.get("MIN_COUNT", "3")))
    parser.add_argument("--dry-run", action="store_true", help="Print what would be applied")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)

    ns = args.namespace
    min_count = args.min_count
    dry = args.dry_run

    steps = [
        ("namespace", None, "namespace.yaml", None),
        ("deployments", ns, "workloads/deployments.yaml", count_in_ns),
        ("statefulsets", ns, "workloads/statefulsets.yaml", count_in_ns),
        ("daemonsets", ns, "workloads/daemonsets.yaml", count_in_ns),
        ("jobs", ns, "workloads/jobs.yaml", count_in_ns),
        ("cronjobs", ns, "workloads/cronjobs.yaml", count_in_ns),
        ("services", ns, "networking/services.yaml", count_in_ns),
        ("ingressclasses", None, "networking/ingressclasses.yaml", lambda k, _: count_cluster_scoped(k)),
        ("ingresses", ns, "networking/ingresses.yaml", count_in_ns),
        ("networkpolicies", ns, "networking/networkpolicies.yaml", count_in_ns),
    ]

    if dry:
        print("Dry run: would apply in order:", [s[2] for s in steps])
        return

    print(f"Namespace: {ns}, min count: {min_count}")

    for kind, namespace, path, count_fn in steps:
        if count_fn is None:
            print(f"Applying {path}")
            run("apply", "-f", path)
            continue
        if namespace is not None:
            current = count_fn(kind, namespace)
        else:
            current = count_fn(kind, "")
        if current < min_count:
            print(f"Applying {path} ({kind} count {current} < {min_count})")
            run("apply", "-f", path)
        else:
            print(f"Skipping {path} ({kind} count {current} >= {min_count})")

    print("Done.")


if __name__ == "__main__":
    main()
