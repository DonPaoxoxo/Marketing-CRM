import { Bell } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime } from '@/lib/utils';
import { cn } from '@/lib/cn';
import { useNotificationMutations, useNotifications } from '@/features/spiels/api';

/** In-app notifications for the signed-in person. Hidden in the mock preview, which has no inbox. */
export function NotificationBell() {
  const { status } = useAuth();
  const notifications = useNotifications(status === 'authenticated');
  const { read, readAll } = useNotificationMutations();
  const navigate = useNavigate();
  if (status !== 'authenticated') {
    return (
      <Button variant="ghost" size="icon-sm" data-shortcut="notifications" aria-label="Notifications" title="Notifications need a signed-in account" disabled>
        <Bell />
      </Button>
    );
  }
  const unread = notifications.data?.unread ?? 0;
  const list = notifications.data?.notifications ?? [];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="relative" data-shortcut="notifications" title="Notifications (Shift + N)" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell />
          {unread > 0 && (
            <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[13px] font-semibold">Notifications</span>
          <Button size="sm" variant="ghost" disabled={!unread} onClick={() => readAll.mutate()}>Mark all read</Button>
        </div>
        {list.length === 0 ? <p className="p-4 text-center text-[13px] text-muted-foreground">You are all caught up.</p> : (
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {list.map((n) => (
              <li key={n.id}>
                <button type="button" className={cn('flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-muted', !n.readAt && 'bg-accent/30')}
                  onClick={() => { if (!n.readAt) read.mutate(n.id); if (n.link.startsWith('/')) navigate(n.link); }}>
                  <span className="flex items-center gap-1.5 text-[13px] font-medium">{!n.readAt && <span className="size-1.5 rounded-full bg-primary" aria-label="Unread" />}{n.title}</span>
                  {n.body && <span className="line-clamp-3 text-[12px] text-muted-foreground">{n.body}</span>}
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(n.createdAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
