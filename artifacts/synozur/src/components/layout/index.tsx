import { ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import { Analytics } from "@/components/analytics";
import { OrganizationJsonLd } from "@/components/organization-jsonld";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col w-full bg-background text-foreground dark">
      <OrganizationJsonLd />
      <Header />
      <main className="flex-1 flex flex-col w-full">
        {children}
      </main>
      <Footer />
      <Analytics />
    </div>
  );
}
