/**
 * InlineFileBrowser — embeddable file browser for use inside PodWorkspace.
 *
 * Same functionality as FileTransferDialog but rendered inline (no dialog wrapper).
 * Supports browsing, uploading, downloading, and drag-and-drop.
 */
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
  Home,
  RefreshCw,
  FolderPlus,
  AlertCircle,
} from 'lucide-react';
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

interface InlineFileBrowserProps {
  podName: string;
  namespace: string;
  containerName: string;
  baseUrl: string;
  clusterId: string;
  className?: string;
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

export function InlineFileBrowser({
  podName,
  namespace,
  containerName,
  baseUrl,
  clusterId,
  className,
}: InlineFileBrowserProps) {
  const [currentPath, setCurrentPath] = useState('/');
  const [entries, setEntries] = useState<ContainerFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(
    async (dirPath: string) => {
      if (!baseUrl || !clusterId) {
        setError('Missing backend URL or cluster ID');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await listContainerFiles(baseUrl, clusterId, namespace, podName, dirPath, containerName);
        setEntries(result || []);
        setCurrentPath(dirPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list files');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, clusterId, namespace, podName, containerName]
  );

  // Load root on mount and when container changes
  useEffect(() => {
    if (containerName) {
      loadDirectory('/');
    }
  }, [containerName, loadDirectory]);

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

  const handleDownload = (entry: ContainerFileEntry) => {
    if (!baseUrl || !clusterId) return;
    const filePath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`;
    const url = getContainerFileDownloadUrl(baseUrl, clusterId, namespace, podName, filePath, containerName);
    window.open(url, '_blank');
    toast.success(`Downloading ${entry.name}`);
  };

  const handleUploadFiles = async (files: FileList | File[]) => {
    if (!baseUrl || !clusterId) return;
    setUploading(true);
    let successCount = 0;

    for (const file of Array.from(files)) {
      const destPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      try {
        await uploadContainerFile(baseUrl, clusterId, namespace, podName, destPath, containerName, file);
        successCount++;
      } catch (e) {
        toast.error(`Failed to upload ${file.name}: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      toast.success(`Uploaded ${successCount} file${successCount > 1 ? 's' : ''}`);
      loadDirectory(currentPath);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUploadFiles(e.dataTransfer.files);
    }
  };

  const pathParts = currentPath.split('/').filter(Boolean);
  const dirs = entries.filter((e) => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type !== 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const sortedEntries = [...dirs, ...files];

  return (
    <div
      className={cn('flex flex-col flex-1 min-h-0 bg-white dark:bg-slate-900', className)}
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
    >
      {/* Toolbar: breadcrumb + actions */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200/60 dark:border-slate-700/50 bg-slate-50/80 dark:bg-slate-800/40">
        {/* Breadcrumb */}
        <div className="flex-1 min-w-0 flex items-center gap-0.5 text-xs overflow-x-auto">
          <button
            onClick={() => navigateToBreadcrumb(-1)}
            className="flex items-center gap-0.5 hover:text-primary text-muted-foreground transition-colors shrink-0"
          >
            <Home className="h-3 w-3" />
            <span className="font-medium">/</span>
          </button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-0.5 shrink-0">
              <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
              <button
                onClick={() => navigateToBreadcrumb(i)}
                className={cn(
                  'hover:text-primary transition-colors truncate max-w-[120px]',
                  i === pathParts.length - 1
                    ? 'text-slate-900 dark:text-slate-100 font-medium'
                    : 'text-muted-foreground'
                )}
              >
                {part}
              </button>
            </span>
          ))}
        </div>

        {/* Action buttons */}
        <button
          onClick={navigateUp}
          disabled={currentPath === '/' || loading}
          className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-all"
          title="Go up"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => loadDirectory(currentPath)}
          disabled={loading}
          className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 transition-all"
          title="Refresh"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="h-7 rounded-md px-2 flex items-center gap-1 text-xs font-medium text-primary bg-primary/5 dark:bg-primary/10 hover:bg-primary/10 dark:hover:bg-primary/20 disabled:opacity-40 transition-all"
          title="Upload files"
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
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

      {/* File list */}
      <div className="flex-1 min-h-0 relative">
        {error ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button variant="outline" size="sm" onClick={() => loadDirectory(currentPath)}>Try Again</Button>
          </div>
        ) : loading && entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary/60" />
            <span className="text-sm">Loading...</span>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
            <FolderPlus className="h-8 w-8 text-slate-300 dark:text-slate-600" />
            <p className="text-sm">Empty directory — drop files to upload</p>
          </div>
        ) : (
          <ScrollArea className="h-full">
            {/* Column headers */}
            <div className="sticky top-0 z-10 grid grid-cols-[1fr_5rem_9rem_2.5rem] items-center px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 bg-slate-50/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200/60 dark:border-slate-700/40">
              <span>Name</span>
              <span className="text-right">Size</span>
              <span className="text-right">Modified</span>
              <span />
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {sortedEntries.map((entry) => (
                <div
                  key={entry.name}
                  className={cn(
                    'grid grid-cols-[1fr_5rem_9rem_2.5rem] items-center px-4 py-2 transition-colors group',
                    entry.type === 'dir'
                      ? 'hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  )}
                  onClick={() => entry.type === 'dir' && navigateTo(entry)}
                  role={entry.type === 'dir' ? 'button' : undefined}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {fileIcon(entry.type)}
                    <span className={cn(
                      'text-sm truncate',
                      entry.type === 'dir'
                        ? 'font-medium text-slate-800 dark:text-slate-200 group-hover:text-amber-700 dark:group-hover:text-amber-400'
                        : 'text-slate-700 dark:text-slate-300'
                    )}>
                      {entry.name}
                    </span>
                    {entry.type === 'link' && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0 text-violet-500 border-violet-200 dark:border-violet-800">
                        symlink
                      </Badge>
                    )}
                  </div>
                  <span className="text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
                    {entry.type === 'dir' ? '--' : formatSize(entry.size)}
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">
                    {entry.modified || '--'}
                  </span>
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

            <div className="sticky bottom-0 px-4 py-1.5 text-[10px] text-slate-400 dark:text-slate-500 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-t border-slate-200/60 dark:border-slate-700/40">
              {dirs.length} folder{dirs.length !== 1 ? 's' : ''}, {files.length} file{files.length !== 1 ? 's' : ''}
            </div>
          </ScrollArea>
        )}

        {/* Drop overlay */}
        {isDragOver && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm z-50 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <Upload className="h-8 w-8 text-primary animate-bounce" />
              <p className="text-sm font-medium">Drop to upload to {currentPath}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
