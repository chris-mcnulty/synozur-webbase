import { Link } from "wouter";
import { Meta } from "@/lib/meta";
import { useOverride, useTrackConversion } from "@/lib/experiments";

// Trust & Security overview for enterprise buyers. Every claim below is
// either drawn from the published Privacy Statement (/privacy) or from the
// platform's actual architecture (Microsoft Entra OIDC SSO, TLS, encrypted
// token storage, bot protection, rate limiting, audit logging). Nothing here
// asserts a formal certification we don't hold.
//
// REVIEW BEFORE LAUNCH (both tracked on the admin Launch Readiness dashboard
// under the "TRUST" group — /admin/site-config/launch-readiness):
//   - "Compliance & documentation" section: if Synozur holds formal
//     attestations (SOC 2, ISO 27001, a published DPA, etc.), name them
//     there. Until then the copy stays non-committal ("available on
//     request"), which matches the Privacy Statement's subprocessor wording.
//     Operators set TRUST_COMPLIANCE_REVIEWED once this is confirmed.
//   - Confirm a monitored security-reporting mailbox. This page currently
//     routes disclosures to privacy@synozur.com + the contact page; swap in
//     security@synozur.com once that inbox is live and set
//     SECURITY_CONTACT_EMAIL.

export default function Trust() {
  // Experiment-overridable hero + CTA (page key: "trust"). Defaults below are
  // the control copy; running experiments can swap eyebrow/headline/body and
  // the closing CTA via trust.* overrides.
  const heroEyebrow = useOverride<string>("trust.hero.eyebrow", "Trust & Security");
  const heroHeadline = useOverride<string>(
    "trust.hero.headline",
    "Security and trust at Synozur",
  );
  const heroBody = useOverride<string>(
    "trust.hero.body",
    "Enterprises trust us with their strategy, their data, and their Microsoft 365 environments. This page summarizes how we protect that trust — across identity, data protection, tenant isolation, and responsible AI.",
  );
  const ctaVisible = useOverride<boolean>("trust.cta.visible", true);
  const ctaHeading = useOverride<string>(
    "trust.cta.heading",
    "Questions from your security team?",
  );
  const ctaLabel = useOverride<string>("trust.cta.label", "Talk to us about security");
  const ctaHref = useOverride<string>("trust.cta.href", "/contact");
  const trackConversion = useTrackConversion();

  return (
    <div className="w-full" data-testid="trust-page">
      <Meta
        title="Trust & Security"
        description="How The Synozur Alliance protects your data: identity and access, encryption, tenant isolation, responsible AI, and our approach to privacy and compliance."
      />

      <section className="bg-[#0B0B1A] py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <p className="text-sm uppercase tracking-[0.25em] text-primary mb-4">
            {heroEyebrow}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            {heroHeadline}
          </h1>
          <p className="text-zinc-300 text-lg max-w-2xl">{heroBody}</p>
        </div>
      </section>

      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-3xl prose prose-neutral dark:prose-invert prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-primary">
          <h2>Identity &amp; access</h2>
          <p>
            Sign-in to Synozur applications uses Microsoft Entra ID (formerly
            Azure AD) via OpenID Connect, so your organization keeps control of
            authentication, conditional access, and multi-factor enforcement
            through your own identity provider. Access within our applications
            is governed by role-based access control, and administrative
            sessions are time-bound with idle timeouts.
          </p>

          <h2>Data protection</h2>
          <p>
            Traffic to and from our sites and applications is encrypted in
            transit using TLS. Sensitive secrets — including customer
            credentials and access tokens issued by connected services — are
            encrypted at rest using AES-256-GCM, and plaintext tokens are never
            written to logs.
          </p>

          <h2>Tenant isolation &amp; data ownership</h2>
          <p>
            All content and data your team uploads or generates inside the
            Synozur applications remains the property of your organization — we
            process it only to operate the service for you. Each customer&rsquo;s
            data is stored in a logically isolated tenant, and Synozur staff
            access customer tenant data only when necessary to provide support,
            investigate a security incident, or comply with law.
          </p>

          <h2>Keep your content in your Microsoft 365 boundary</h2>
          <p>
            For file content such as documents, images, and reports, we
            encourage customers to use our SharePoint Embedded integration so
            your content is stored inside your own Microsoft 365 tenant and its
            trust boundary, rather than in our application storage.
          </p>

          <h2>Responsible AI</h2>
          <p>
            Our applications use AI models from established third-party
            providers (such as Microsoft, Anthropic, and OpenAI) to generate
            drafts, suggestions, and summaries. We send only the data needed to
            complete each request, and our provider agreements prohibit those
            providers from using your data to train their models. We do not
            train our own AI models on customer data, on content authored in
            our applications, or on data obtained from any connected
            third-party platform.
          </p>

          <h2>Application &amp; web security</h2>
          <p>
            We apply defense-in-depth controls across our web properties,
            including bot protection on public forms, rate limiting on sensitive
            endpoints, and audit logging of administrative and security-relevant
            actions. We continuously monitor our applications and apply security
            updates as part of routine operations.
          </p>

          <h2>Subprocessors</h2>
          <p>
            We use a limited set of trusted service providers — for example,
            cloud hosting, email delivery, and AI model providers — and share
            only the data necessary to operate the service. Our contracts with
            these providers require equivalent confidentiality and security
            protections. A current subprocessor list is available on request by
            emailing{" "}
            <a href="mailto:privacy@synozur.com">privacy@synozur.com</a>.
          </p>

          <h2>Data retention &amp; deletion</h2>
          <p>
            Customer data is retained for the life of your subscription. On
            termination, data is deleted within 90 days unless you request
            earlier deletion or a data export. To request an export or
            deletion, email{" "}
            <a href="mailto:privacy@synozur.com">privacy@synozur.com</a>.
          </p>

          {/* REVIEW BEFORE LAUNCH: name any formal attestations Synozur holds
              (SOC 2, ISO 27001, published DPA). Keep the copy below
              non-committal until those are confirmed. */}
          <h2>Compliance &amp; documentation</h2>
          <p>
            We&rsquo;re happy to support your security and procurement review.
            Our security documentation, subprocessor list, and data processing
            terms are available to prospective and current customers on request.
            For details specific to a particular Synozur application, see our{" "}
            <Link href="/privacy">Privacy Statement</Link>.
          </p>

          <h2>Report a security concern</h2>
          <p>
            If you believe you&rsquo;ve found a security vulnerability or have a
            security concern, please contact us at{" "}
            <a href="mailto:privacy@synozur.com">privacy@synozur.com</a> or
            through our <Link href="/contact">contact page</Link>. We take all
            reports seriously and will respond promptly.
          </p>

          <h2>Learn more</h2>
          <p>
            For a complete description of how we collect, use, and protect
            personal information, see our{" "}
            <Link href="/privacy">Privacy Statement</Link> and{" "}
            <Link href="/terms">Terms of Service</Link>.
          </p>
        </div>
      </section>

      {ctaVisible ? (
        <section className="relative overflow-hidden bg-card border-t border-border py-20">
          <div aria-hidden="true" className="absolute inset-0 nebula-gradient opacity-10" />
          <div className="container relative z-10 mx-auto px-4 text-center max-w-2xl">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">{ctaHeading}</h2>
            <p className="text-lg text-muted-foreground mb-8">
              We&rsquo;re glad to walk through our controls and provide the
              documentation your review needs.
            </p>
            <Link
              href={ctaHref}
              onClick={() =>
                trackConversion("conversion.trust.contact", { href: ctaHref })
              }
              className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              data-testid="trust-cta"
            >
              {ctaLabel}
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
