import { SignIn } from "@clerk/react";
import { Meta } from "@/lib/meta";

export default function SignInPage() {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Sign in" noindex />
      <SignIn
        routing="path"
        path={`${baseUrl || ""}/sign-in`}
        signUpUrl={`${baseUrl || ""}/sign-up`}
        forceRedirectUrl={`${baseUrl || ""}/admin`}
        appearance={{
          elements: {
            card: "shadow-lg border border-border",
            headerTitle: "text-foreground",
            formButtonPrimary: "bg-primary hover:bg-primary/90",
          },
        }}
      />
    </div>
  );
}
