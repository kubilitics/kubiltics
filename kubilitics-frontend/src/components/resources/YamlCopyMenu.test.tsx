import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from '@/components/ui/tooltip';
import { YamlCopyMenu } from './YamlCopyMenu';

async function renderMenu(onCopy = vi.fn()) {
  const user = userEvent.setup();
  render(
    <TooltipProvider>
      <YamlCopyMenu
        cleanYaml="clean-yaml-text"
        applyReadyYaml="apply-ready-yaml-text"
        rawYaml="raw-yaml-text"
        jsonText='{"kind":"Pod"}'
        kubectlApplyCommand={'cat <<\'EOF\' | kubectl apply -f -\napply-ready-yaml-text\nEOF'}
        onCopy={onCopy}
      />
    </TooltipProvider>,
  );
  // Open the menu so items are in the DOM.
  await user.click(screen.getByRole('button', { name: /copy menu/i }));
  return { onCopy, user };
}

describe('YamlCopyMenu', () => {
  it('renders a trigger button with copy menu label', () => {
    render(
      <TooltipProvider>
        <YamlCopyMenu
          cleanYaml="" applyReadyYaml="" rawYaml="" jsonText="" kubectlApplyCommand=""
          onCopy={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole('button', { name: /copy menu/i })).toBeInTheDocument();
  });

  it('shows all five menu items after opening', async () => {
    await renderMenu();
    expect(screen.getByRole('menuitem', { name: /copy as yaml \(clean\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /copy as yaml \(apply-ready\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /copy as yaml \(raw\)/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /copy as json/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /kubectl apply/i })).toBeInTheDocument();
  });

  it('fires onCopy with the Clean label and text when Clean item clicked', async () => {
    const { onCopy, user } = await renderMenu();
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(clean\)/i }));
    expect(onCopy).toHaveBeenCalledWith('YAML (Clean)', 'clean-yaml-text');
  });

  it('fires onCopy with the Apply-ready label and text', async () => {
    const { onCopy, user } = await renderMenu();
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(apply-ready\)/i }));
    expect(onCopy).toHaveBeenCalledWith('YAML (Apply-ready)', 'apply-ready-yaml-text');
  });

  it('fires onCopy with the Raw label and text', async () => {
    const { onCopy, user } = await renderMenu();
    await user.click(screen.getByRole('menuitem', { name: /copy as yaml \(raw\)/i }));
    expect(onCopy).toHaveBeenCalledWith('YAML (Raw)', 'raw-yaml-text');
  });

  it('fires onCopy with the JSON label and text', async () => {
    const { onCopy, user } = await renderMenu();
    await user.click(screen.getByRole('menuitem', { name: /copy as json/i }));
    expect(onCopy).toHaveBeenCalledWith('JSON', '{"kind":"Pod"}');
  });

  it('fires onCopy with the kubectl apply heredoc command', async () => {
    const { onCopy, user } = await renderMenu();
    await user.click(screen.getByRole('menuitem', { name: /kubectl apply/i }));
    const [label, text] = onCopy.mock.calls[0];
    expect(label).toBe('kubectl apply command');
    expect(text).toContain("cat <<'EOF'");
    expect(text).toContain('apply-ready-yaml-text');
    expect(text).toContain('EOF');
  });
});
