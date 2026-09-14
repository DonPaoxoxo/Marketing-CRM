import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BookmarkPlus, Check, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { toast } from 'sonner';

interface SavedView { id: string; name: string; path: string; search: string }

const KEY = 'mrcrm.savedViews'; // filter preferences only — never record data.

function read(): SavedView[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as SavedView[];
  } catch {
    return [];
  }
}
function write(views: SavedView[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(views));
  } catch { /* ignore */ }
}

/** Saves the current route + query string so a filter combination can be recalled.
 *  `compact`: the toolbar button. `inline`: just the list and name field, for the Save view dialog. */
export function SavedViews({ compact, inline, onSaved }: { compact?: boolean; inline?: boolean; onSaved?: () => void } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [views, setViews] = React.useState<SavedView[]>(read);
  const [name, setName] = React.useState('');
  const [open, setOpen] = React.useState(false);

  const forRoute = views.filter((v) => v.path === location.pathname);
  const current = forRoute.find((v) => v.search === location.search);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = [
      ...views.filter((v) => !(v.path === location.pathname && v.name === trimmed)),
      { id: crypto.randomUUID(), name: trimmed, path: location.pathname, search: location.search },
    ];
    setViews(next);
    write(next);
    setName('');
    setOpen(false);
    toast.success(`Saved view "${trimmed}"`);
    onSaved?.();
  };

  const remove = (id: string) => {
    const next = views.filter((v) => v.id !== id);
    setViews(next);
    write(next);
  };

  if (inline) {
    return (
      <div className="flex flex-col gap-2">
        {forRoute.length > 0 && (
          <ul className="flex flex-col gap-1">
            {forRoute.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-[13px]">
                <button type="button" className="truncate text-left hover:underline" onClick={() => { navigate(`${v.path}${v.search}`); onSaved?.(); }}>{v.name}</button>
                <button type="button" aria-label={`Delete saved view ${v.name}`} className="rounded p-1 text-muted-foreground hover:text-danger" onClick={() => remove(v.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Input aria-label="Saved view name" placeholder="Name this view…" value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} className="h-9" />
          <Button onClick={save} disabled={!name.trim()}><BookmarkPlus /> Save</Button>
        </div>
      </div>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <Button variant="ghost" size="sm" className="px-2" data-shortcut="save-view" aria-label={current ? `Save view: ${current.name}` : 'Save view'} title="Save view (Shift + S)">
            <Star className={current ? 'fill-primary text-primary' : undefined} />
            <span className="hidden max-w-[8rem] truncate xl:inline">{current ? current.name : 'Save view'}</span>
          </Button>
        ) : (
          <Button variant="outline" size="sm">
            <Star className={current ? 'fill-primary text-primary' : undefined} />
            {current ? current.name : 'Saved views'}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Saved views for this page</DropdownMenuLabel>
        {forRoute.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-muted-foreground">
            No saved views yet. Set your filters, then save them below.
          </p>
        )}
        {forRoute.map((v) => (
          <DropdownMenuItem key={v.id} onSelect={() => navigate(`${v.path}${v.search}`)} className="justify-between">
            <span className="flex items-center gap-2 truncate">
              {v.search === location.search ? <Check className="h-3.5 w-3.5 text-primary" /> : <span className="w-3.5" />}
              <span className="truncate">{v.name}</span>
            </span>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              className="rounded p-1 text-muted-foreground hover:text-danger"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                remove(v.id);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex items-center gap-2 p-2">
          <Input
            aria-label="Saved view name"
            placeholder="Name this view…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            className="h-8"
          />
          <Button size="sm" onClick={save} disabled={!name.trim()}>
            <BookmarkPlus /> Save
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
