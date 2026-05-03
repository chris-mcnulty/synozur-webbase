import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/context/auth";
import type { PortalForbiddenReason } from "@workspace/api-client-react";

interface Props {
  reason: PortalForbiddenReason | null;
}

const COPY: Record<PortalForbiddenReason, { title: string; body: string }> = {
  not_a_customer: {
    title: "This portal is for Synozur customers",
    body: "You're signed in, but your account doesn't have customer access yet. If you're expecting access, your Synozur contact can grant it from the admin console.",
  },
  no_organization: {
    title: "Your account isn't linked to an organization",
    body: "Customer portal access is granted at the organization level. Reach out to your Synozur contact to get linked to your team.",
  },
  organization_inactive: {
    title: "Your organization isn't active right now",
    body: "Your organization's portal access is currently paused. Please contact your Synozur account manager to reactivate it.",
  },
};

export default function NotCustomer({ reason }: Props) {
  const { user, signOut } = useAuth();
  const copy = (reason && COPY[reason]) ?? COPY.not_a_customer;
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6">
      <Card className="max-w-lg w-full p-8 space-y-5">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Galaxy customer portal
          </p>
          <h1 className="text-2xl font-semibold">{copy.title}</h1>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {copy.body}
        </p>
        {user?.email ? (
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        ) : null}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
          <Button asChild>
            <a href="/">Back to synozur.com</a>
          </Button>
        </div>
      </Card>
    </div>
  );
}
