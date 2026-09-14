import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { EmptyState, PageHeader } from '@/components/common/bits';

export default function NotFoundPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Page not found" />
      <EmptyState
        title="That route does not exist"
        description="Check the address, or pick a module from the sidebar."
        action={<Button asChild><Link to="/">Back to the dashboard</Link></Button>}
      />
    </div>
  );
}
