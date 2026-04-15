import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface YamlCopyMenuProps {
  cleanYaml: string;
  applyReadyYaml: string;
  rawYaml: string;
  /** JSON text — caller decides which preset it reflects. */
  jsonText: string;
  /** Apply-ready YAML wrapped in a shell heredoc for direct paste. */
  kubectlApplyCommand: string;
  onCopy: (label: string, text: string) => void;
}

export function YamlCopyMenu({
  cleanYaml,
  applyReadyYaml,
  rawYaml,
  jsonText,
  kubectlApplyCommand,
  onCopy,
}: YamlCopyMenuProps) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Copy menu">
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Copy YAML / JSON / command</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onCopy('YAML (Clean)', cleanYaml)}>
          Copy as YAML (Clean)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy('YAML (Apply-ready)', applyReadyYaml)}>
          Copy as YAML (Apply-ready)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onCopy('YAML (Raw)', rawYaml)}>
          Copy as YAML (Raw)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCopy('JSON', jsonText)}>
          Copy as JSON
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCopy('kubectl apply command', kubectlApplyCommand)}>
          Copy kubectl apply -f -
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
