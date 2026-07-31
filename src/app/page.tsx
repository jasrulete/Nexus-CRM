import { FeatureGrid } from "@/components/landing/feature-grid";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { StackStrip } from "@/components/landing/stack-strip";

// Signed-in visitors never reach this page — proxy.ts redirects them to
// /dashboard, the way it already does for the other public paths.
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <StackStrip />
        <FeatureGrid />
      </main>
      <LandingFooter />
    </div>
  );
}
