import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import * as RD from '@radix-ui/react-dialog';
import { useNavigate } from 'react-router-dom';
import type { NavGroup } from './Sidebar.js';

/** Cmd/Ctrl+K over every destination in the sidebar IA. */
export function CommandPalette({ groups }: { groups: NavGroup[] }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <RD.Root open={open} onOpenChange={setOpen}>
      <RD.Portal>
        <RD.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <RD.Content className="fixed left-1/2 top-24 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 overflow-hidden rounded-card border border-line bg-surface-2 shadow-e3">
          <RD.Title className="sr-only">Search destinations</RD.Title>
          <Command>
            <Command.Input
              placeholder="Jump to…"
              className="w-full border-b border-line bg-transparent px-4 py-3 text-base text-content outline-none placeholder:text-content-faint"
            />
            <Command.List className="max-h-80 overflow-y-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-content-faint">
                No matches.
              </Command.Empty>

              {groups.map((g) => (
                <Command.Group
                  key={g.group}
                  heading={g.group}
                  className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-content-faint"
                >
                  {g.items.map(({ to, label, icon: Icon }) => (
                    <Command.Item
                      key={to}
                      value={label}
                      onSelect={() => {
                        setOpen(false);
                        navigate(to);
                      }}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content-muted data-[selected=true]:bg-surface-3 data-[selected=true]:text-content"
                    >
                      <Icon aria-hidden className="h-4 w-4" />
                      {label}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  );
}
