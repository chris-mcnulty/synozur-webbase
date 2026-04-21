import { ReactNode } from "react";
import { Header } from "./header";
import { Footer } from "./footer";
import { Analytics } from "@/components/analytics";
import { OrganizationJsonLd } from "@/components/organization-jsonld";
import { useTheme } from "@/context/theme";
import { cn } from "@/lib/utils";

export function Layout({ children }: { children: ReactNode }) {
  const { theme } = useTheme();
  return (
    <div className={cn("min-h-[100dvh] flex flex-col w-full bg-background text-foreground", theme)}>
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
