import React from "react";

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[AppErrorBoundary] render failure", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <section className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
          <h1 className="text-xl font-semibold">This screen could not be displayed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your data is safe. Reload the screen to recover; if the issue repeats, share the time and page name with support.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Reload application
          </button>
        </section>
      </main>
    );
  }
}
