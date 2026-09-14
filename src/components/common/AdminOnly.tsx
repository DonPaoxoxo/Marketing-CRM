import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useSession } from '@/hooks/useSession';
import type { Permission } from '@/lib/types';

/** Wraps a page that needs a permission. The server refuses the same areas and
 *  leaves their data out of the workspace; this explains it instead of showing
 *  an empty page. */
export function RequirePermission({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const { can, role } = useSession();
  if (can(permission)) return <>{children}</>;
  return (
    <div role="alert" className="mx-auto mt-10 flex max-w-md flex-col items-center gap-2 rounded-lg border border-border px-6 py-10 text-center">
      <Lock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">You do not have access to this area</p>
      <p className="text-[13px] text-muted-foreground">
        Your role ({role}) has not been given access. The System Administrator can grant it in Roles &amp; Audit.
      </p>
      <Button asChild variant="outline" size="sm" className="mt-2"><Link to="/">Back to the dashboard</Link></Button>
    </div>
  );
}
