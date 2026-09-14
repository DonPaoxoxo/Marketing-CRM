import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: React.ReactNode;
  /** Changing this resets the boundary — pass the route path so navigating away recovers. */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so one broken screen does not blank the whole workspace.
 *
 * Wrapped around the routed content rather than the whole app, so the sidebar and
 * global search stay usable and the user can navigate somewhere else.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // No error-reporting service is wired up in this phase; the console is the sink.
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-3 rounded-lg border border-danger/40 bg-danger-bg/30 px-6 py-12 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" />
        <div>
          <h2 className="text-base font-semibold">This screen could not be displayed</h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The rest of the workspace still works — pick another module from the sidebar, or try again.
          </p>
        </div>
        <pre className="max-w-full overflow-x-auto rounded-md border border-border bg-surface px-3 py-2 text-left text-[12px] text-muted-foreground">
          {error.message}
        </pre>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => this.setState({ error: null })}>Try again</Button>
          <Button onClick={() => window.location.reload()}>Reload the workspace</Button>
        </div>
      </div>
    );
  }
}
