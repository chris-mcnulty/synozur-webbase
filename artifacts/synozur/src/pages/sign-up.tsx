import { SignUp } from "@clerk/react";

export default function SignUpPage() {
  const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
  return (
    <div className="min-h-[80vh] flex items-center justify-center py-16 px-4">
      <SignUp
        routing="path"
        path={`${baseUrl || ""}/sign-up`}
        signInUrl={`${baseUrl || ""}/sign-in`}
        forceRedirectUrl={`${baseUrl || ""}/admin`}
      />
    </div>
  );
}
