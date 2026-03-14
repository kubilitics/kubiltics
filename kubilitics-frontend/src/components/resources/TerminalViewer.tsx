import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal as TerminalIcon,
  Maximize2,
  Minimize2,
  Copy,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp?: string;
}

export interface TerminalViewerProps {
  podName?: string;
  namespace?: string;
  containerName?: string;
  containers?: string[];
  onContainerChange?: (container: string) => void;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Simulated filesystem per container                                 */
/* ------------------------------------------------------------------ */

interface FsNode {
  type: 'file' | 'dir' | 'symlink';
  content?: string;
  target?: string;
  permissions?: string;
  owner?: string;
  size?: number;
  modified?: string;
}

function buildContainerFs(podName: string, namespace: string, containerName: string): Record<string, FsNode> {
  const now = 'Mar 14 08:30';
  return {
    '/': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/bin': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/bin/sh': { type: 'file', permissions: '-rwxr-xr-x', owner: 'root root', size: 121432, modified: now },
    '/bin/ls': { type: 'file', permissions: '-rwxr-xr-x', owner: 'root root', size: 138856, modified: now },
    '/bin/cat': { type: 'file', permissions: '-rwxr-xr-x', owner: 'root root', size: 35280, modified: now },
    '/bin/echo': { type: 'file', permissions: '-rwxr-xr-x', owner: 'root root', size: 30904, modified: now },
    '/dev': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/etc': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/etc/hostname': { type: 'file', content: podName, permissions: '-rw-r--r--', owner: 'root root', size: podName.length, modified: now },
    '/etc/hosts': {
      type: 'file',
      content: `# Kubernetes-managed hosts file.\n127.0.0.1\tlocalhost\n::1\tlocalhost ip6-localhost ip6-loopback\nfe00::0\tip6-localnet\nfe00::0\tip6-mcastprefix\nfe00::1\tip6-allnodes\nfe00::2\tip6-allrouters\n10.244.0.12\t${podName}`,
      permissions: '-rw-r--r--', owner: 'root root', size: 256, modified: now,
    },
    '/etc/resolv.conf': {
      type: 'file',
      content: `nameserver 10.96.0.10\nsearch ${namespace}.svc.cluster.local svc.cluster.local cluster.local\noptions ndots:5`,
      permissions: '-rw-r--r--', owner: 'root root', size: 120, modified: now,
    },
    '/etc/os-release': {
      type: 'file',
      content: 'NAME="Alpine Linux"\nID=alpine\nVERSION_ID=3.19.1\nPRETTY_NAME="Alpine Linux v3.19"\nHOME_URL="https://alpinelinux.org/"\n',
      permissions: '-rw-r--r--', owner: 'root root', size: 150, modified: now,
    },
    '/home': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/proc': { type: 'dir', permissions: 'dr-xr-xr-x', owner: 'root root', modified: now },
    '/proc/1': { type: 'dir', permissions: 'dr-xr-xr-x', owner: 'root root', modified: now },
    '/proc/1/cmdline': { type: 'file', content: `/usr/local/bin/${containerName}`, permissions: '-r--r--r--', owner: 'root root', size: 30, modified: now },
    '/proc/cpuinfo': { type: 'file', content: 'processor\t: 0\nmodel name\t: Intel(R) Core(TM) i9-9880H\ncpu MHz\t\t: 2300.000\ncache size\t: 16384 KB\n', permissions: '-r--r--r--', owner: 'root root', size: 200, modified: now },
    '/proc/meminfo': { type: 'file', content: 'MemTotal:       16384000 kB\nMemFree:         8192000 kB\nMemAvailable:   12288000 kB\nBuffers:          512000 kB\nCached:          2048000 kB\n', permissions: '-r--r--r--', owner: 'root root', size: 180, modified: now },
    '/proc/uptime': { type: 'file', content: '119476.32 237842.64', permissions: '-r--r--r--', owner: 'root root', size: 20, modified: now },
    '/root': { type: 'dir', permissions: 'drwx------', owner: 'root root', modified: now },
    '/run': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/run/secrets': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/run/secrets/kubernetes.io': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/run/secrets/kubernetes.io/serviceaccount': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/run/secrets/kubernetes.io/serviceaccount/token': { type: 'file', content: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...', permissions: '-rw-r--r--', owner: 'root root', size: 1024, modified: now },
    '/run/secrets/kubernetes.io/serviceaccount/namespace': { type: 'file', content: namespace, permissions: '-rw-r--r--', owner: 'root root', size: namespace.length, modified: now },
    '/run/secrets/kubernetes.io/serviceaccount/ca.crt': { type: 'file', content: '-----BEGIN CERTIFICATE-----\nMIIC5z...truncated\n-----END CERTIFICATE-----\n', permissions: '-rw-r--r--', owner: 'root root', size: 1066, modified: now },
    '/sys': { type: 'dir', permissions: 'dr-xr-xr-x', owner: 'root root', modified: now },
    '/tmp': { type: 'dir', permissions: 'drwxrwxrwt', owner: 'root root', modified: now },
    '/usr': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/usr/local': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/usr/local/bin': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    [`/usr/local/bin/${containerName}`]: { type: 'file', permissions: '-rwxr-xr-x', owner: 'root root', size: 24576000, modified: now },
    '/var': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    '/var/log': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    [`/var/log/${containerName}.log`]: {
      type: 'file',
      content: `[2026-03-14T05:30:00Z] INFO  Starting ${containerName} v2.1.0\n[2026-03-14T05:30:01Z] INFO  Listening on :8080\n[2026-03-14T05:30:01Z] INFO  Health check endpoint ready at /healthz\n[2026-03-14T05:30:02Z] INFO  Connected to database\n[2026-03-14T05:30:02Z] INFO  Ready to serve traffic\n`,
      permissions: '-rw-r--r--', owner: 'root root', size: 4096, modified: now,
    },
    '/var/run': { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: now },
    [`/var/run/${containerName}.pid`]: { type: 'file', content: '1', permissions: '-rw-r--r--', owner: 'root root', size: 2, modified: now },
  };
}

/* ------------------------------------------------------------------ */
/*  Environment variables                                              */
/* ------------------------------------------------------------------ */

function buildEnvVars(podName: string, namespace: string, containerName: string): Record<string, string> {
  return {
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    HOSTNAME: podName,
    HOME: '/root',
    TERM: 'xterm-256color',
    KUBERNETES_SERVICE_HOST: '10.96.0.1',
    KUBERNETES_SERVICE_PORT: '443',
    KUBERNETES_SERVICE_PORT_HTTPS: '443',
    KUBERNETES_PORT: 'tcp://10.96.0.1:443',
    [`${containerName.toUpperCase().replace(/-/g, '_')}_SERVICE_HOST`]: '10.96.0.1',
    [`${containerName.toUpperCase().replace(/-/g, '_')}_SERVICE_PORT`]: '8080',
    POD_NAME: podName,
    POD_NAMESPACE: namespace,
    POD_IP: '10.244.0.12',
    NODE_NAME: 'docker-desktop',
    LANG: 'C.UTF-8',
  };
}

/* ------------------------------------------------------------------ */
/*  Command executor                                                   */
/* ------------------------------------------------------------------ */

function resolvePath(cwd: string, target: string): string {
  if (target.startsWith('/')) {
    // absolute
  } else {
    target = cwd === '/' ? `/${target}` : `${cwd}/${target}`;
  }
  // Resolve . and ..
  const parts = target.split('/').filter(Boolean);
  const resolved: string[] = [];
  for (const p of parts) {
    if (p === '.') continue;
    if (p === '..') { resolved.pop(); continue; }
    resolved.push(p);
  }
  return '/' + resolved.join('/');
}

function getChildren(fs: Record<string, FsNode>, dirPath: string): string[] {
  const prefix = dirPath === '/' ? '/' : dirPath + '/';
  const children: string[] = [];
  for (const path of Object.keys(fs)) {
    if (path === dirPath) continue;
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (!rest.includes('/')) {
      children.push(rest);
    }
  }
  return children.sort();
}

function formatLsLong(fs: Record<string, FsNode>, dirPath: string): string {
  const children = getChildren(fs, dirPath);
  if (children.length === 0) return '';
  const lines: string[] = [`total ${children.length * 4}`];
  for (const name of children) {
    const fullPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;
    const node = fs[fullPath];
    if (!node) continue;
    const perm = node.permissions || (node.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--');
    const owner = node.owner || 'root root';
    const size = String(node.size ?? 4096).padStart(8);
    const mod = node.modified || 'Mar 14 08:30';
    lines.push(`${perm}  1 ${owner} ${size} ${mod} ${name}${node.type === 'dir' ? '/' : ''}`);
  }
  return lines.join('\n');
}

interface ExecContext {
  fs: Record<string, FsNode>;
  env: Record<string, string>;
  cwd: string;
  podName: string;
  namespace: string;
  containerName: string;
}

function executeCmd(cmd: string, ctx: ExecContext): { output: string; newCwd?: string; type: 'output' | 'error' } {
  const trimmed = cmd.trim();
  if (!trimmed) return { output: '', type: 'output' };

  // Handle pipes by only running the first command (simulated)
  const pipeIdx = trimmed.indexOf('|');

  // Parse command and args (basic)
  const parts = (pipeIdx >= 0 ? trimmed.slice(0, pipeIdx).trim() : trimmed).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  const command = parts[0];
  const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));

  switch (command) {
    case 'ls': {
      const showAll = args.includes('-a') || args.includes('-la') || args.includes('-al');
      const showLong = args.includes('-l') || args.includes('-la') || args.includes('-al');
      const target = args.find(a => !a.startsWith('-')) || ctx.cwd;
      const resolved = resolvePath(ctx.cwd, target);
      const node = ctx.fs[resolved];
      if (!node) return { output: `ls: cannot access '${target}': No such file or directory`, type: 'error' };
      if (node.type === 'file') return { output: target, type: 'output' };
      if (showLong) {
        const result = formatLsLong(ctx.fs, resolved);
        if (showAll) {
          return { output: `drwxr-xr-x  1 root root     4096 Mar 14 08:30 .\ndrwxr-xr-x  1 root root     4096 Mar 14 08:30 ..\n${result.split('\n').slice(1).join('\n')}`, type: 'output' };
        }
        return { output: result, type: 'output' };
      }
      let children = getChildren(ctx.fs, resolved);
      if (showAll) children = ['.', '..', ...children];
      const colored = children.map(c => {
        const fp = resolved === '/' ? `/${c}` : `${resolved}/${c}`;
        const n = ctx.fs[fp];
        return (n?.type === 'dir' || c === '.' || c === '..') ? c + '/' : c;
      });
      return { output: colored.join('  '), type: 'output' };
    }

    case 'cd': {
      const target = args[0] || '/root';
      const resolved = resolvePath(ctx.cwd, target);
      const node = ctx.fs[resolved];
      if (!node) return { output: `bash: cd: ${target}: No such file or directory`, type: 'error' };
      if (node.type !== 'dir') return { output: `bash: cd: ${target}: Not a directory`, type: 'error' };
      return { output: '', newCwd: resolved, type: 'output' };
    }

    case 'pwd':
      return { output: ctx.cwd, type: 'output' };

    case 'cat': {
      if (args.length === 0) return { output: 'cat: missing operand', type: 'error' };
      const results: string[] = [];
      for (const arg of args) {
        if (arg.startsWith('-')) continue;
        const resolved = resolvePath(ctx.cwd, arg);
        const node = ctx.fs[resolved];
        if (!node) { results.push(`cat: ${arg}: No such file or directory`); continue; }
        if (node.type === 'dir') { results.push(`cat: ${arg}: Is a directory`); continue; }
        results.push(node.content || '');
      }
      return { output: results.join('\n'), type: results.some(r => r.includes('No such file')) ? 'error' : 'output' };
    }

    case 'echo': {
      const text = args.join(' ').replace(/^\$(\w+)/, (_, v) => ctx.env[v] || '');
      // Handle $VAR substitution
      const expanded = text.replace(/\$(\w+)/g, (_, v) => ctx.env[v] || '');
      return { output: expanded, type: 'output' };
    }

    case 'env':
    case 'printenv': {
      if (args.length > 0) {
        const val = ctx.env[args[0]];
        return val !== undefined ? { output: val, type: 'output' } : { output: '', type: 'output' };
      }
      return { output: Object.entries(ctx.env).map(([k, v]) => `${k}=${v}`).join('\n'), type: 'output' };
    }

    case 'export': {
      if (args.length === 0) return { output: Object.entries(ctx.env).map(([k, v]) => `declare -x ${k}="${v}"`).join('\n'), type: 'output' };
      for (const arg of args) {
        const eq = arg.indexOf('=');
        if (eq > 0) {
          ctx.env[arg.slice(0, eq)] = arg.slice(eq + 1).replace(/^"|"$/g, '');
        }
      }
      return { output: '', type: 'output' };
    }

    case 'whoami':
      return { output: 'root', type: 'output' };

    case 'id':
      return { output: 'uid=0(root) gid=0(root) groups=0(root)', type: 'output' };

    case 'hostname':
      return { output: ctx.podName, type: 'output' };

    case 'uname': {
      if (args.includes('-a')) return { output: `Linux ${ctx.podName} 5.15.49-linuxkit #1 SMP x86_64 GNU/Linux`, type: 'output' };
      if (args.includes('-r')) return { output: '5.15.49-linuxkit', type: 'output' };
      if (args.includes('-n')) return { output: ctx.podName, type: 'output' };
      return { output: 'Linux', type: 'output' };
    }

    case 'date':
      return { output: new Date().toUTCString(), type: 'output' };

    case 'uptime':
      return { output: ' 08:30:00 up 1 day, 9:12,  0 users,  load average: 0.42, 0.38, 0.35', type: 'output' };

    case 'ps': {
      const wide = args.includes('aux') || args.includes('-ef') || args.includes('-aux');
      if (wide) {
        return {
          output: `USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\nroot         1  0.2  1.4 724512 28960 ?        Ssl  05:30   0:12 /usr/local/bin/${ctx.containerName}\nroot        42  0.0  0.0   2420   576 pts/0    Ss   08:30   0:00 /bin/sh\nroot        58  0.0  0.0   7060  1580 pts/0    R+   08:30   0:00 ps aux`,
          type: 'output',
        };
      }
      return {
        output: `  PID TTY          TIME CMD\n    1 ?        00:00:12 ${ctx.containerName}\n   42 pts/0    00:00:00 sh\n   58 pts/0    00:00:00 ps`,
        type: 'output',
      };
    }

    case 'top':
      return {
        output: `top - 08:30:00 up 1 day, 9:12,  0 users,  load average: 0.42, 0.38, 0.35\nTasks:   3 total,   1 running,   2 sleeping,   0 stopped,   0 zombie\n%Cpu(s):  2.1 us,  0.8 sy,  0.0 ni, 96.8 id,  0.2 wa,  0.0 hi,  0.1 si\nMiB Mem:  16000.0 total,   8000.0 free,   4200.0 used,   3800.0 buff/cache\nMiB Swap:  1024.0 total,   1024.0 free,      0.0 used.  12000.0 avail Mem\n\n  PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND\n    1 root      20   0  724512  28960  18400 S   0.2   1.4   0:12.34 ${ctx.containerName}\n   42 root      20   0    2420    576    508 S   0.0   0.0   0:00.01 sh\n   58 root      20   0    7060   1580   1380 R   0.0   0.0   0:00.00 top`,
        type: 'output',
      };

    case 'df': {
      if (args.includes('-h')) {
        return {
          output: `Filesystem      Size  Used Avail Use% Mounted on\noverlay          59G   12G   44G  22% /\ntmpfs            64M     0   64M   0% /dev\n/dev/vda1        59G   12G   44G  22% /etc/hosts\nshm              64M     0   64M   0% /dev/shm\ntmpfs           7.8G   12K  7.8G   1% /run/secrets/kubernetes.io/serviceaccount`,
          type: 'output',
        };
      }
      return {
        output: `Filesystem     1K-blocks     Used Available Use% Mounted on\noverlay         61255492 12251098  45860680  22% /\ntmpfs              65536        0     65536   0% /dev`,
        type: 'output',
      };
    }

    case 'free':
      return {
        output: `              total        used        free      shared  buff/cache   available\nMem:       16384000     4300000     8000000       12000     4084000    12000000\nSwap:       1048576           0     1048576`,
        type: 'output',
      };

    case 'ifconfig':
    case 'ip': {
      if (command === 'ip' && args[0] === 'addr') {
        return {
          output: `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN\n    inet 127.0.0.1/8 scope host lo\n2: eth0@if12: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc noqueue state UP\n    inet 10.244.0.12/24 brd 10.244.0.255 scope global eth0`,
          type: 'output',
        };
      }
      return {
        output: `eth0: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 10.244.0.12  netmask 255.255.255.0  broadcast 10.244.0.255\n        ether 02:42:0a:f4:00:0c  txqueuelen 0  (Ethernet)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        loop  txqueuelen 1000  (Local Loopback)`,
        type: 'output',
      };
    }

    case 'curl': {
      const url = args.find(a => !a.startsWith('-'));
      if (url?.includes('localhost') || url?.includes('127.0.0.1')) {
        if (url.includes('/healthz') || url.includes('/health')) {
          return { output: '{"status":"healthy","uptime":"33h12m","version":"2.1.0"}', type: 'output' };
        }
        if (url.includes('/readyz') || url.includes('/ready')) {
          return { output: '{"status":"ready"}', type: 'output' };
        }
        if (url.includes('/metrics')) {
          return { output: `# HELP http_requests_total Total HTTP requests\n# TYPE http_requests_total counter\nhttp_requests_total{method="GET",status="200"} 14523\nhttp_requests_total{method="POST",status="200"} 3847\nhttp_requests_total{method="GET",status="404"} 12\n# HELP process_cpu_seconds_total Total CPU time\nprocess_cpu_seconds_total 42.81`, type: 'output' };
        }
        return { output: `{"message":"OK","pod":"${ctx.podName}","namespace":"${ctx.namespace}"}`, type: 'output' };
      }
      return { output: `curl: (6) Could not resolve host: ${url || 'unknown'}`, type: 'error' };
    }

    case 'wget':
      return { output: 'wget: not found (use curl instead)', type: 'error' };

    case 'nslookup':
    case 'dig': {
      const host = args.find(a => !a.startsWith('-')) || 'kubernetes.default';
      return { output: `Server:\t\t10.96.0.10\nAddress:\t10.96.0.10#53\n\nName:\t${host}\nAddress: 10.96.0.1`, type: 'output' };
    }

    case 'netstat':
      return {
        output: `Active Internet connections (servers and established)\nProto Recv-Q Send-Q Local Address           Foreign Address         State\ntcp        0      0 0.0.0.0:8080            0.0.0.0:*               LISTEN\ntcp        0      0 10.244.0.12:8080        10.244.0.1:52340        ESTABLISHED\ntcp        0      0 10.244.0.12:8080        10.244.0.1:52342        ESTABLISHED`,
        type: 'output',
      };

    case 'ss':
      return {
        output: `Netid State  Recv-Q Send-Q  Local Address:Port   Peer Address:Port\ntcp   LISTEN 0      128     0.0.0.0:8080        0.0.0.0:*\ntcp   ESTAB  0      0    10.244.0.12:8080     10.244.0.1:52340\ntcp   ESTAB  0      0    10.244.0.12:8080     10.244.0.1:52342`,
        type: 'output',
      };

    case 'head': {
      const nArg = args.indexOf('-n');
      const n = nArg >= 0 ? parseInt(args[nArg + 1]) || 10 : 10;
      const file = args.find(a => !a.startsWith('-') && a !== String(n));
      if (!file) return { output: 'head: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, file);
      const node = ctx.fs[resolved];
      if (!node) return { output: `head: cannot open '${file}': No such file or directory`, type: 'error' };
      if (node.type === 'dir') return { output: `head: error reading '${file}': Is a directory`, type: 'error' };
      return { output: (node.content || '').split('\n').slice(0, n).join('\n'), type: 'output' };
    }

    case 'tail': {
      const nArg = args.indexOf('-n');
      const n = nArg >= 0 ? parseInt(args[nArg + 1]) || 10 : 10;
      const file = args.find(a => !a.startsWith('-') && a !== String(n));
      if (!file) return { output: 'tail: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, file);
      const node = ctx.fs[resolved];
      if (!node) return { output: `tail: cannot open '${file}': No such file or directory`, type: 'error' };
      if (node.type === 'dir') return { output: `tail: error reading '${file}': Is a directory`, type: 'error' };
      return { output: (node.content || '').split('\n').slice(-n).join('\n'), type: 'output' };
    }

    case 'wc': {
      const file = args.find(a => !a.startsWith('-'));
      if (!file) return { output: 'wc: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, file);
      const node = ctx.fs[resolved];
      if (!node) return { output: `wc: ${file}: No such file or directory`, type: 'error' };
      const content = node.content || '';
      const lines = content.split('\n').length;
      const words = content.split(/\s+/).filter(Boolean).length;
      const bytes = content.length;
      return { output: `  ${lines}   ${words}  ${bytes} ${file}`, type: 'output' };
    }

    case 'grep': {
      const pattern = args.find(a => !a.startsWith('-'));
      const file = args.filter(a => !a.startsWith('-'))[1];
      if (!pattern) return { output: 'grep: missing pattern', type: 'error' };
      if (!file) return { output: 'grep: missing file operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, file);
      const node = ctx.fs[resolved];
      if (!node) return { output: `grep: ${file}: No such file or directory`, type: 'error' };
      const content = node.content || '';
      const matches = content.split('\n').filter(l => l.toLowerCase().includes(pattern.toLowerCase()));
      return { output: matches.join('\n') || '', type: 'output' };
    }

    case 'find': {
      const searchDir = args.find(a => !a.startsWith('-')) || ctx.cwd;
      const resolved = resolvePath(ctx.cwd, searchDir);
      const nameIdx = args.indexOf('-name');
      const namePattern = nameIdx >= 0 ? args[nameIdx + 1]?.replace(/"/g, '') : null;
      const results: string[] = [];
      for (const path of Object.keys(ctx.fs)) {
        if (!path.startsWith(resolved === '/' ? '/' : resolved)) continue;
        if (namePattern) {
          const basename = path.split('/').pop() || '';
          const regex = new RegExp('^' + namePattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
          if (!regex.test(basename)) continue;
        }
        results.push(path);
      }
      return { output: results.sort().join('\n'), type: 'output' };
    }

    case 'mkdir': {
      const target = args.find(a => !a.startsWith('-'));
      if (!target) return { output: 'mkdir: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, target);
      if (ctx.fs[resolved]) return { output: `mkdir: cannot create directory '${target}': File exists`, type: 'error' };
      ctx.fs[resolved] = { type: 'dir', permissions: 'drwxr-xr-x', owner: 'root root', modified: 'Mar 14 08:30' };
      return { output: '', type: 'output' };
    }

    case 'touch': {
      const target = args.find(a => !a.startsWith('-'));
      if (!target) return { output: 'touch: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, target);
      if (!ctx.fs[resolved]) {
        ctx.fs[resolved] = { type: 'file', content: '', permissions: '-rw-r--r--', owner: 'root root', size: 0, modified: 'Mar 14 08:30' };
      }
      return { output: '', type: 'output' };
    }

    case 'rm': {
      const target = args.find(a => !a.startsWith('-'));
      if (!target) return { output: 'rm: missing operand', type: 'error' };
      const resolved = resolvePath(ctx.cwd, target);
      if (!ctx.fs[resolved]) return { output: `rm: cannot remove '${target}': No such file or directory`, type: 'error' };
      if (ctx.fs[resolved].type === 'dir' && !args.includes('-r') && !args.includes('-rf')) {
        return { output: `rm: cannot remove '${target}': Is a directory`, type: 'error' };
      }
      // Remove item and children
      const prefix = resolved + '/';
      for (const p of Object.keys(ctx.fs)) {
        if (p === resolved || p.startsWith(prefix)) delete ctx.fs[p];
      }
      return { output: '', type: 'output' };
    }

    case 'cp':
      return { output: '', type: 'output' };

    case 'mv':
      return { output: '', type: 'output' };

    case 'which': {
      const bin = args[0];
      if (!bin) return { output: 'which: missing argument', type: 'error' };
      const candidates = ['/usr/local/bin/', '/usr/bin/', '/bin/'];
      for (const c of candidates) {
        if (ctx.fs[c + bin]) return { output: c + bin, type: 'output' };
      }
      return { output: `${bin} not found`, type: 'error' };
    }

    case 'type': {
      const bin = args[0];
      if (!bin) return { output: '', type: 'output' };
      const builtins = ['cd', 'echo', 'export', 'exit', 'clear', 'type', 'help'];
      if (builtins.includes(bin)) return { output: `${bin} is a shell builtin`, type: 'output' };
      const candidates = ['/usr/local/bin/', '/usr/bin/', '/bin/'];
      for (const c of candidates) {
        if (ctx.fs[c + bin]) return { output: `${bin} is ${c}${bin}`, type: 'output' };
      }
      return { output: `bash: type: ${bin}: not found`, type: 'error' };
    }

    case 'help':
      return {
        output: `GNU bash, version 5.2.15(1)-release (x86_64-alpine-linux-musl)\nAvailable commands:\n  ls, cd, pwd, cat, echo, env, printenv, export, whoami, id, hostname,\n  uname, date, uptime, ps, top, df, free, ip, curl, nslookup, netstat,\n  ss, head, tail, wc, grep, find, mkdir, touch, rm, cp, mv, which,\n  type, clear, exit, help\n\nTab completion is available for commands and file paths.`,
        type: 'output',
      };

    case 'clear':
      return { output: '__CLEAR__', type: 'output' };

    case 'exit':
      return { output: '__EXIT__', type: 'output' };

    default:
      return { output: `bash: ${command}: command not found`, type: 'error' };
  }
}

/* ------------------------------------------------------------------ */
/*  Autocomplete engine                                                */
/* ------------------------------------------------------------------ */

const KNOWN_COMMANDS = [
  'ls', 'cd', 'pwd', 'cat', 'echo', 'env', 'printenv', 'export', 'whoami', 'id',
  'hostname', 'uname', 'date', 'uptime', 'ps', 'top', 'df', 'free', 'ip',
  'curl', 'wget', 'nslookup', 'dig', 'netstat', 'ss', 'head', 'tail', 'wc',
  'grep', 'find', 'mkdir', 'touch', 'rm', 'cp', 'mv', 'which', 'type',
  'clear', 'exit', 'help', 'ifconfig',
];

function getCompletions(input: string, cwd: string, fs: Record<string, FsNode>): string[] {
  const parts = input.split(/\s+/);

  // Complete commands
  if (parts.length <= 1) {
    const prefix = parts[0] || '';
    return KNOWN_COMMANDS.filter(c => c.startsWith(prefix)).sort();
  }

  // Complete paths (for the last argument)
  const lastArg = parts[parts.length - 1];
  const isAbsolute = lastArg.startsWith('/');
  const lastSlash = lastArg.lastIndexOf('/');
  let dirPath: string;
  let prefix: string;

  if (lastSlash >= 0) {
    dirPath = resolvePath(cwd, lastArg.slice(0, lastSlash + 1));
    prefix = lastArg.slice(lastSlash + 1);
  } else {
    dirPath = cwd;
    prefix = lastArg;
  }

  const children = getChildren(fs, dirPath);
  const matches = children.filter(c => c.startsWith(prefix));

  return matches.map(m => {
    const fullPath = dirPath === '/' ? `/${m}` : `${dirPath}/${m}`;
    const node = fs[fullPath];
    const displayName = node?.type === 'dir' ? m + '/' : m;
    // Build the full completion
    if (lastSlash >= 0) {
      return lastArg.slice(0, lastSlash + 1) + displayName;
    }
    if (isAbsolute) return '/' + displayName;
    return displayName;
  });
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function TerminalViewer({
  podName = 'pod',
  namespace = 'default',
  containerName = 'app',
  containers = [],
  onContainerChange,
  className,
}: TerminalViewerProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [selectedContainer, setSelectedContainer] = useState(containerName);
  const [isMaximized, setIsMaximized] = useState(false);
  const [cwd, setCwd] = useState('/');
  const [isExited, setIsExited] = useState(false);
  const [tabHint, setTabHint] = useState('');

  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fsRef = useRef<Record<string, FsNode>>(buildContainerFs(podName, namespace, selectedContainer));
  const envRef = useRef<Record<string, string>>(buildEnvVars(podName, namespace, selectedContainer));

  // Rebuild fs/env when container changes
  useEffect(() => {
    fsRef.current = buildContainerFs(podName, namespace, selectedContainer);
    envRef.current = buildEnvVars(podName, namespace, selectedContainer);
    setCwd('/');
    setIsExited(false);
    setLines([
      { type: 'system', content: `Connected to ${selectedContainer} in ${namespace}/${podName}` },
      { type: 'system', content: `Container OS: Alpine Linux v3.19 | Shell: /bin/bash` },
      { type: 'system', content: `Type "help" for available commands. Tab for autocomplete.\n` },
    ]);
    setCommandHistory([]);
    setHistoryIndex(-1);
    setCurrentInput('');
    setTabHint('');
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [podName, namespace, selectedContainer]);

  // Auto-scroll
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on click
  const handleTerminalClick = useCallback(() => {
    if (!isExited) inputRef.current?.focus();
  }, [isExited]);

  // Execute command
  const executeCommand = useCallback((command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    setCommandHistory(prev => [...prev, trimmed]);
    setHistoryIndex(-1);
    setTabHint('');

    // Show the input line with prompt
    const promptStr = `root@${podName}:${cwd}# ${trimmed}`;
    setLines(prev => [...prev, { type: 'input', content: promptStr, timestamp: new Date().toISOString() }]);

    const ctx: ExecContext = {
      fs: fsRef.current,
      env: envRef.current,
      cwd,
      podName,
      namespace,
      containerName: selectedContainer,
    };

    const result = executeCmd(trimmed, ctx);

    if (result.output === '__CLEAR__') {
      setLines([]);
      return;
    }

    if (result.output === '__EXIT__') {
      setLines(prev => [...prev, { type: 'system', content: 'Session closed. Select a container to reconnect.' }]);
      setIsExited(true);
      return;
    }

    if (result.newCwd) {
      setCwd(result.newCwd);
    }

    if (result.output) {
      setLines(prev => [...prev, { type: result.type, content: result.output }]);
    }
  }, [cwd, podName, namespace, selectedContainer]);

  // Key events
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeCommand(currentInput);
      setCurrentInput('');
      setTabHint('');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex = historyIndex < commandHistory.length - 1 ? historyIndex + 1 : historyIndex;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentInput(commandHistory[commandHistory.length - 1 - newIndex] || '');
      } else {
        setHistoryIndex(-1);
        setCurrentInput('');
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const completions = getCompletions(currentInput, cwd, fsRef.current);
      if (completions.length === 1) {
        // Single match — auto-complete
        const parts = currentInput.split(/\s+/);
        if (parts.length <= 1) {
          setCurrentInput(completions[0] + ' ');
        } else {
          parts[parts.length - 1] = completions[0];
          setCurrentInput(parts.join(' ') + (completions[0].endsWith('/') ? '' : ' '));
        }
        setTabHint('');
      } else if (completions.length > 1) {
        // Multiple matches — show hint and fill common prefix
        setTabHint(completions.join('  '));
        // Find common prefix
        let common = completions[0];
        for (const c of completions) {
          while (!c.startsWith(common)) {
            common = common.slice(0, -1);
          }
        }
        if (common) {
          const parts = currentInput.split(/\s+/);
          if (parts.length <= 1) {
            setCurrentInput(common);
          } else {
            parts[parts.length - 1] = common;
            setCurrentInput(parts.join(' '));
          }
        }
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      e.preventDefault();
      const promptStr = `root@${podName}:${cwd}# ${currentInput}^C`;
      setLines(prev => [...prev, { type: 'input', content: promptStr }]);
      setCurrentInput('');
      setTabHint('');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
      setTabHint('');
    } else if (e.key === 'a' && e.ctrlKey) {
      e.preventDefault();
      // Move cursor to start — set selection to 0
      setTimeout(() => {
        inputRef.current?.setSelectionRange(0, 0);
      }, 0);
    } else {
      setTabHint('');
    }
  }, [currentInput, commandHistory, historyIndex, executeCommand, cwd, podName]);

  const handleCopyOutput = useCallback(() => {
    const output = lines.map(l => l.content).join('\n');
    navigator.clipboard.writeText(output);
    toast.success('Terminal output copied to clipboard');
  }, [lines]);

  const handleClear = useCallback(() => {
    setLines([]);
    setTabHint('');
  }, []);

  const handleReconnect = useCallback(() => {
    setIsExited(false);
    fsRef.current = buildContainerFs(podName, namespace, selectedContainer);
    envRef.current = buildEnvVars(podName, namespace, selectedContainer);
    setCwd('/');
    setLines([
      { type: 'system', content: `Reconnected to ${selectedContainer} in ${namespace}/${podName}` },
      { type: 'system', content: `Container OS: Alpine Linux v3.19 | Shell: /bin/bash` },
      { type: 'system', content: `Type "help" for available commands. Tab for autocomplete.\n` },
    ]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [podName, namespace, selectedContainer]);

  const prompt = `root@${podName}:${cwd}#`;

  return (
    <Card className={cn(
      'overflow-hidden transition-all duration-300',
      isMaximized && 'fixed inset-4 z-50',
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[hsl(221_39%_11%)] border-b border-[hsl(0_0%_100%/0.1)]">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>
          <TerminalIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-[hsl(0_0%_100%/0.9)]">
            {namespace}/{podName}:{selectedContainer}
          </span>
          <Badge variant="outline" className="text-xs border-[hsl(0_0%_100%/0.2)] text-[hsl(0_0%_100%/0.6)]">
            /bin/bash
          </Badge>
          {isExited ? (
            <Badge variant="secondary" className="text-xs text-amber-200 bg-amber-900/40 border-amber-500/40">
              Disconnected
            </Badge>
          ) : (
            <Badge className="text-xs bg-emerald-600/80 text-white border-0">Connected</Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Container selector */}
          {containers.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-[hsl(0_0%_100%/0.7)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)] mr-1">
                  {selectedContainer}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {containers.map(c => (
                  <DropdownMenuItem
                    key={c}
                    onClick={() => {
                      setSelectedContainer(c);
                      onContainerChange?.(c);
                    }}
                    className={cn(c === selectedContainer && 'font-semibold')}
                  >
                    {c}
                    {c === selectedContainer && ' (active)'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={handleCopyOutput}
            title="Copy output"
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={handleClear}
            title="Clear terminal"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-[hsl(0_0%_100%/0.5)] hover:text-white hover:bg-[hsl(0_0%_100%/0.1)]"
            onClick={() => setIsMaximized(!isMaximized)}
            title={isMaximized ? 'Minimize' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Terminal content */}
      <div
        ref={terminalRef}
        onClick={handleTerminalClick}
        className="bg-[hsl(221_39%_8%)] text-[hsl(142_76%_73%)] font-mono text-sm overflow-auto cursor-text"
        style={
          isMaximized
            ? { height: 'calc(100vh - 120px)' }
            : { minHeight: '320px', height: 'min(560px, calc(100vh - 260px))' }
        }
      >
        <div className="p-4 space-y-0">
          {lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                'whitespace-pre-wrap break-all leading-6',
                line.type === 'input' && 'text-[hsl(0_0%_100%/0.95)] font-semibold',
                line.type === 'output' && 'text-[hsl(142_76%_73%/0.9)]',
                line.type === 'error' && 'text-red-400',
                line.type === 'system' && 'text-cyan-400 italic',
              )}
            >
              {line.content}
            </div>
          ))}

          {/* Tab completion hint */}
          <AnimatePresence>
            {tabHint && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[hsl(0_0%_100%/0.4)] leading-6"
              >
                {tabHint}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Input prompt */}
          {!isExited ? (
            <div className="flex items-center leading-6">
              <span className="text-[hsl(199_89%_68%)] font-semibold shrink-0">{prompt}&nbsp;</span>
              <input
                ref={inputRef}
                type="text"
                value={currentInput}
                onChange={(e) => setCurrentInput(e.target.value)}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-transparent outline-none text-[hsl(0_0%_100%/0.95)] caret-[hsl(142_76%_73%)] font-mono text-sm"
                autoFocus
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : (
            <div className="flex items-center gap-3 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-cyan-400 hover:text-cyan-300 hover:bg-white/5 h-7"
                onClick={handleReconnect}
              >
                Reconnect
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 bg-[hsl(221_39%_10%)] border-t border-[hsl(0_0%_100%/0.1)] text-xs text-[hsl(0_0%_100%/0.4)] flex items-center justify-between">
        <span>
          {isExited
            ? 'Session ended'
            : `kubectl exec -it ${podName} -c ${selectedContainer} -n ${namespace} -- /bin/bash`}
        </span>
        <span className="flex items-center gap-3">
          <span>Tab: autocomplete</span>
          <span>Ctrl+L: clear</span>
          <span>Ctrl+C: cancel</span>
        </span>
      </div>
    </Card>
  );
}
