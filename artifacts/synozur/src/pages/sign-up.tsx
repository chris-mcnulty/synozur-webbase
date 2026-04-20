import { SignUp } from "@clerk/react";
import { Meta } from "@/lib/meta";

export default function SignUpPage() {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <Meta title="Sign up" noindex />
      <SignUp
        routing="path"
        path={`${baseUrl || ""}/sign-up`}
        signInUrl={`${baseUrl || ""}/sign-in`}
        forceRedirectUrl={`${baseUrl || ""}/admin`}
      />
    </div>
  );
}
