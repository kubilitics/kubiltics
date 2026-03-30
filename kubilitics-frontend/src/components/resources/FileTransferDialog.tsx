import { useState, useCallback, useRef, useEffect } from 'react';
import {
  FolderOpen,
  File,
  FileSymlink,
  ChevronRight,
  Upload,
  Download,
  ArrowUp,
  Loader2,
  HardDrive,
  Home,
  RefreshCw,
  FolderPlus,
  AlertCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import {
  listContainerFiles,
  getContainerFileDownloadUrl,
  uploadContainerFile,
  type ContainerFileEntry,
} from '@/services/backendApiClient';
import { useClusterStore } from '@/stores/clusterStore';

export interface FileTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  podName: string;
  namespace: string;
  baseUrl?: string;
  clusterId?: string;
  containers?: Array<{ name: string }>;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

function fileIcon(type: string) {
  switch (type) {
    case 'dir':
      return <FolderOpen className="h-4 w-4 text-amber-500 dark:text-amber-400" />;
    case 'link':
      return <FileSymlink className="h-4 w-4 text-violet-500 dark:text-violet-400" />;
    default:
      return <File className="h-4 w-4 text-slate-400 dark:text-slate-500" />;
  }
}

export function FileTransferDialog({
  open,
  onOpenChange,
  podName,
  namespace,
  baseUrl,
  clusterId,
  containers,
}: FileTransferDialogProps) {
  const effectiveBaseUrl = baseUrl ?? '';
  const effectiveClusterId = clusterId || useClusterStore.getState().activeCluster?.id;

  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<ContainerFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedContainer, setSelectedContainer] = useState(containers?.[0]?.name || '');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (dirPath: string) => {
      if (effectiveBaseUrl == null || !effectiveClusterId) {
        setError('Missing backend URL or cluster ID');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listContainerFiles(
          effectiveBaseUrl,
          effectiveClusterId,
          namespace,
          podName,
          dirPath,
          selectedContainer
        );
        setEntries(result || []);
        setCurrentPath(dirPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list files');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [effectiveBaseUrl, effectiveClusterId, namespace, podName, selectedContainer]
  );

  useEffect(() => {
    if (open && selectedContainer) {
      loadDirectory('/');
    }
  }, [open, selectedContainer, loadDirectory]);

  useEffect(() => {
    if (containers?.length && !selectedContainer) {
      setSelectedContainer(containers[0].name);
    }
  }, [containers, selectedContainer]);

  const navigateTo = (entry: ContainerFileEntry) => {
    if (entry.type === 'dir') {
      const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
      loadDirectory(newPath);
    }
  };

  const navigateUp = () => {
    if (currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadDirectory('/' + parts.join('/') || '/');
  };

  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      loadDirectory('/');
      return;
    }
    const parts = currentPath.split('/').filter(Boolean);
    loadDirectory('/' + parts.slice(0, index + 1).join('/'));
  };

  const handleDownload = async (entry: ContainerFileEntry) => {
    if (effectiveBaseUrl == null || !effectiveClusterId) return;
    const filePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
    const url = getContainerFileDownloadUrl(
      effectiveBaseUrl,
      effectiveClusterId,
      namespace,
      podName,
      filePath,
      selectedContainer
    );
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Download failed: ${resp.statusText}`);
      const blob = await resp.blob();
      const { downloadFile, showInFolder } = await import('@/topology/graph/utils/exportUtils');
      const savedPath = await downloadFile(blob, entry.name);
      if (savedPath) {
        toast.success(`Downloaded ${entry.name}`, {
          description: savedPath,
          action: { label: 'Show in Folder', onClick: () => showInFolder(savedPath) },
        });
      } else {
        toast.success(`Downloaded ${entry.name}`);
      }
    } catch {
      window.open(url, '_blank');
      toast.info(`Downloading ${entry.name}`);
    }
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (effectiveBaseUrl == null || !effectiveClusterId) return;
    setUploading(true);
    let successCount = 0;
    let failCount = 0;

    for (const file of Array.from(files)) {
      const destPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      try {
        await uploadContainerFile(
          effectiveBaseUrl,
          effectiveClusterId,
          namespace,
          podName,
          destPath,
          selectedContainer,
          file
        );
        successCount++;
      } catch (e) {
        failCount++;
        toast.error(`Failed to upload ${file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
      loadDirectory(currentPath);
    }
    if (failCount > 0 && successCount === 0) {
      toast.error(`All ${failCount} uploads failed`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const pathParts = currentPath.split('/').filter(Boolean);
  const dirs = entries.filter((e) => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const sortedEntries = [...dirs, ...files];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-800/80 dark:to-slate-900">
          <DialogHeader className="gap-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="h-8 w-8 rounded-lg bg-primary/10 dark:bg-primary/20 flex items-center justify-center">
                <HardDrive className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <span className="block">File Browser</span>
                <span className="text-xs font-normal text-muted-foreground truncate block">{podName}</span>
              </div>
            </DialogTitle>
            <DialogDescription className="sr-only">
              Browse, download, and upload files in the container filesystem
            </DialogDescription>
          </DialogHeader>

          {/* Container selector */}
          {containers && containers.length > 1 && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs font-medium text-muted-foreground">Container</span>
              <div className="flex gap-1">
                {containers.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setSelectedContainer(c.name)}
                    className={cn(
                      "px-2 py-1 rounded-md text-xs font-medium transition-all",
                      c.name === selectedContainer
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb + toolbar row */}
          <div className="flex items-center gap-2 mt-3">
            {/* Breadcrumb */}
            <div className="flex-1 min-w-0 flex items-center gap-0.5 text-xs bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60 rounded-lg px-2 py-1 overflow-x-auto">
              <button
                onClick={() => navigateToBreadcrumb(-1)}
                className="flex items-center gap-0.5 hover:text-primary text-muted-foreground transition-colors shrink-0"
              >
                <Home className="h-3 w-3" />
              </button>
              {pathParts.map((part, i) => (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
                  <button
                    onClick={() => navigateToBreadcrumb(i)}
                    className={cn(
                      "hover:text-primary transition-colors truncate max-w-[120px]",
                      i === pathParts.length - 1
                        ? "text-slate-900 dark:text-slate-100 font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {part}
                  </button>
                </span>
              ))}
            </div>

            {/* Nav buttons */}
            <button
              onClick={navigateUp}
              disabled={currentPath === '/' || loading}
              className="h-7 w-7 rounded-lg border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40 disabled:pointer-events-none transition-all"
              title="Go up"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => loadDirectory(currentPath)}
              disabled={loading}
              className="h-7 w-7 rounded-lg border border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-800/80 flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 disabled:opacity-40 disabled:pointer-events-none transition-all"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || effectiveBaseUrl == null || !effectiveClusterId}
              className="h-7 rounded-lg border border-primary/30 bg-primary/5 dark:bg-primary/10 px-2 flex items-center gap-1 text-xs font-medium text-primary hover:bg-primary/10 dark:hover:bg-primary/20 hover:border-primary/50 disabled:opacity-40 disabled:pointer-events-none transition-all"
              title="Upload files"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">{uploading ? 'Uploading...' : 'Upload'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  handleUploadFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
          </div>
        </div>

        {/* File list / Drop zone */}
        <div
          className={cn(
            "flex-1 min-h-0 relative transition-colors",
            isDragOver && "bg-primary/5 dark:bg-primary/10"
          )}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {error ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <div className="h-10 w-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button variant="outline" size="sm" onClick={() => loadDirectory(currentPath)} className="mt-1">
                Try Again
              </Button>
            </div>
          ) : loading && entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
              <span className="text-sm">Loading directory...</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <div className="h-12 w-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <FolderPlus className="h-6 w-6 text-slate-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-300">Empty directory</p>
                <p className="text-xs text-muted-foreground mt-0.5">Drop files here or click Upload</p>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-[380px]">
              {/* Column headers */}
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_5rem_9rem_2.5rem] items-center px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/40">
                <span>Name</span>
                <span className="text-right">Size</span>
                <span className="text-right">Modified</span>
                <span />
              </div>

              {/* File rows */}
              <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {sortedEntries.map((entry) => (
                  <div
                    key={entry.name}
                    className={cn(
                      "grid grid-cols-[1fr_5rem_9rem_2.5rem] items-center px-4 py-2 transition-colors group",
                      entry.type === 'dir'
                        ? "hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    )}
                    onClick={() => entry.type === 'dir' ? navigateTo(entry) : undefined}
                    role={entry.type === 'dir' ? 'button' : undefined}
                  >
                    {/* Name */}
                    <div className="flex items-center gap-2 min-w-0">
                      {fileIcon(entry.type)}
                      <span className={cn(
                        "text-sm truncate",
                        entry.type === 'dir'
                          ? "font-medium text-slate-800 dark:text-slate-200 group-hover:text-amber-700 dark:group-hover:text-amber-400"
                          : "text-slate-700 dark:text-slate-300"
                      )}>
                        {entry.name}
                      </span>
                      {entry.type === 'link' && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 font-medium text-violet-500 border-violet-200 dark:border-violet-800">
                          symlink
                        </Badge>
                      )}
                    </div>

                    {/* Size */}
                    <span className="text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {entry.type === 'dir' ? (
                        <span className="text-[10px]">--</span>
                      ) : (
                        formatSize(entry.size)
                      )}
                    </span>

                    {/* Modified */}
                    <span className="text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
                      {entry.modified || '--'}
                    </span>

                    {/* Download action */}
                    <div className="flex justify-end">
                      {entry.type === 'file' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDownload(entry); }}
                          className="h-6 w-6 rounded-md flex items-center justify-center text-slate-400 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-primary/10 transition-all"
                          title={`Download ${entry.name}`}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Summary footer */}
              <div className="sticky bottom-0 px-4 py-2 text-[10px] text-slate-400 dark:text-slate-500 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-200/60 dark:border-slate-700/40">
                {dirs.length} folder{dirs.length !== 1 ? 's' : ''}, {files.length} file{files.length !== 1 ? 's' : ''}
              </div>
            </ScrollArea>
          )}

          {/* Drop overlay */}
          {isDragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm z-50 pointer-events-none">
              <div className="flex flex-col items-center gap-3">
                <div className="h-14 w-14 rounded-xl bg-primary/10 dark:bg-primary/20 flex items-center justify-center animate-bounce">
                  <Upload className="h-7 w-7 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Drop to upload</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Files will be uploaded to {currentPath}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
