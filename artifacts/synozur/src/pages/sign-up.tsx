import { useEffect } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";

// We don't self-serve sign-up. Identity is provisioned in Entra by IT, and
// CMS roles are granted from the admin panel. This page exists only to keep
// previously-published `/sign-up` URLs from 404ing — we redirect to the
// public site with a short hint.

export default function SignUpPage() {
  useEffect(() => {
    const t = setTimeout(() => {
      window.location.replace((import.meta.env.BASE_URL || "/").replace(/\/$/, "") + "/contact");
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Request access" noindex />
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold mb-3">Request access</h1>
        <p className="text-muted-foreground mb-6">
          Synozur staff sign in with Microsoft. If you need an account, contact
          your administrator. Visitors looking to get in touch should use the
          contact form.
        </p>
        <div className="flex gap-3 justify-center">
          <Link href="/contact">
            <Button>Contact us</Button>
          </Link>
          <Link href="/sign-in">
            <Button variant="outline">Sign in with Microsoft</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
