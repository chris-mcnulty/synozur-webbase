import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Meta } from "@/lib/meta";

export default function CareersAppliedPage() {
  return (
    <div className="px-4 py-24 max-w-2xl mx-auto text-center">
      <Meta title="Application received" />
      <h1 className="text-4xl font-bold" data-testid="applied-heading">
        Application received
      </h1>
      <p className="mt-4 text-muted-foreground">
        Thanks for applying. We've sent you a confirmation email and our team
        will be in touch if there's a fit.
      </p>
      <div className="mt-8">
        <Link href="/careers">
          {/* eslint-disable-next-line jsx-a11y/anchor-is-valid -- wouter <Link> injects href into the inner <a>. */}
          <a><Button>View other openings</Button></a>
        </Link>
      </div>
    </div>
  );
}
