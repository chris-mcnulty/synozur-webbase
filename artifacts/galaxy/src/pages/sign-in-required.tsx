import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth";
import { PortalSiteHeader } from "@/components/portal-site-header";
import { PortalSiteFooter } from "@/components/portal-site-footer";

export default function SignInRequired() {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen flex flex-col">
      <PortalSiteHeader hidePortalNav />
      <main className="flex-1 flex items-center justify-center bg-background px-6">
        <Card className="max-w-md w-full p-8 space-y-5 text-center">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Galaxy customer portal
            </p>
            <h1 className="text-2xl font-semibold">Sign in to continue</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            The Galaxy portal is for Synozur customers. Sign in with the same
            account you use on synozur.com to see your engagements and account
            team.
          </p>
          <Button onClick={() => signIn()} className="w-full">
            Sign in
          </Button>
        </Card>
      </main>
      <PortalSiteFooter />
    </div>
  );
}
