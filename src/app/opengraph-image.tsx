import { ImageResponse } from "next/og";

export const alt = "Nexus CRM — AI-powered pipeline, contacts and insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0c0c0e 0%, #2e1065 100%)",
          color: "#f4f4f5",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "13px",
              background: "#7c3aed",
            }}
          />
          <div style={{ fontSize: "34px", fontWeight: 600, letterSpacing: "-0.02em" }}>
            Nexus CRM
          </div>
        </div>

        <div
          style={{
            marginTop: "48px",
            fontSize: "68px",
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: "900px",
          }}
        >
          Every relationship, one intelligent workspace.
        </div>

        <div style={{ marginTop: "28px", fontSize: "28px", color: "#a1a1aa" }}>
          AI lead scoring · Pipeline kanban · Contact timeline
        </div>
      </div>
    ),
    size,
  );
}
