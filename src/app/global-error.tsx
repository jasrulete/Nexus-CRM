"use client";

// Replaces the root layout when it is the layout itself that failed, so this
// file ships its own <html>/<body> and cannot rely on globals.css tokens.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f7f7f8",
          color: "#18181b",
          fontFamily: "system-ui, sans-serif",
          padding: "1rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1rem", fontWeight: 600 }}>
            Nexus CRM is temporarily unavailable
          </h1>
          <p style={{ fontSize: "0.8125rem", color: "#52525b" }}>
            An unexpected error interrupted the app.
            {error.digest ? ` Reference: ${error.digest}` : ""}
          </p>
          <button
            onClick={() => unstable_retry()}
            style={{
              marginTop: "1.25rem",
              height: "2.25rem",
              padding: "0 1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#7c3aed",
              color: "#fff",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
