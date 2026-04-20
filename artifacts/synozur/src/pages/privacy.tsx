import { Meta } from "@/lib/meta";

export default function Privacy() {
  return (
    <div className="w-full">
      <Meta
        title="Privacy Policy"
        description="How The Synozur Alliance collects, uses, and protects personal information, including cookies and analytics used on synozur.com."
      />

      <section className="bg-[#0B0B1A] py-20">
        <div className="container mx-auto px-4 max-w-4xl">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Privacy Policy
          </h1>
          <p className="text-zinc-300 text-lg">
            How we collect, use, and protect your information at The Synozur Alliance.
          </p>
        </div>
      </section>

      <section className="py-16 bg-background">
        <div className="container mx-auto px-4 max-w-3xl prose prose-neutral dark:prose-invert prose-headings:font-bold prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4 prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3 prose-p:leading-relaxed prose-li:leading-relaxed prose-a:text-primary">
          <p>
            At Synozur, we are committed to protecting the privacy and security of our
            customers and partners. This privacy statement outlines our practices
            regarding the collection, use, and sharing of personal information.
          </p>

          <h2>Collection of Information</h2>
          <p>
            We collect personal information such as name, email address, phone number,
            and company affiliation when you:
          </p>
          <ul>
            <li>Register for our webinars, events, or newsletters.</li>
            <li>Request information or assistance through our website.</li>
            <li>Participate in surveys, promotions, or other marketing activities.</li>
            <li>Provide contact information at a Synozur-sponsored event.</li>
          </ul>

          <h2>Use of Information</h2>
          <p>The information we collect is used to:</p>
          <ul>
            <li>Provide you with the services or information you have requested.</li>
            <li>Improve our products, services, and customer experience.</li>
            <li>
              Communicate with you about updates, offers, and events that might interest
              you.
            </li>
            <li>Conduct market research and analysis.</li>
            <li>
              Analyze anonymized, aggregated data to identify industry trends without
              exposing individual identities.
            </li>
          </ul>

          <h2>Sharing of Information</h2>
          <p>We may share your personal information with our trusted partners to:</p>
          <ul>
            <li>Facilitate the provision of requested services or information.</li>
            <li>Enhance our offerings through collaborative efforts.</li>
            <li>Inform you about products or services that may be of interest.</li>
          </ul>
          <p>
            We ensure that our partners are committed to maintaining the confidentiality
            and security of your information and use it only for the purposes for which
            we have shared it.
          </p>

          <h2>Cookies and Similar Technologies</h2>
          <p>
            We use cookies and similar technologies on www.synozur.com to operate the
            site and to measure and improve its performance. When you first visit the
            site, we present a cookie consent banner that lets you accept or decline
            non-essential cookies. The categories below describe what is loaded under
            each choice.
          </p>

          <h3>Strictly necessary</h3>
          <p>
            These are required for the site to function and are always active. They
            include the small browser-storage entry that records your cookie consent
            choice (so we don&rsquo;t prompt you on every visit) and any session state
            needed to keep you signed in to authenticated areas of the site.
          </p>

          <h3>Marketing and analytics (loaded only with your consent)</h3>
          <p>
            If you accept cookies, we load the following third-party tags. If you
            decline, none of these are loaded and no data is sent to these providers.
          </p>
          <ul>
            <li>
              <strong>Google Analytics 4 (GA4)</strong> &mdash; measures aggregate
              traffic, page views, and on-site engagement so we can understand which
              content is useful. See{" "}
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noreferrer"
              >
                Google&rsquo;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>LinkedIn Insight Tag</strong> &mdash; helps us measure the
              effectiveness of LinkedIn campaigns and reach professionally relevant
              audiences. See{" "}
              <a
                href="https://www.linkedin.com/legal/privacy-policy"
                target="_blank"
                rel="noreferrer"
              >
                LinkedIn&rsquo;s privacy policy
              </a>
              .
            </li>
            <li>
              <strong>Meta Pixel</strong> &mdash; helps us measure the effectiveness of
              campaigns on Meta platforms (Facebook, Instagram). See{" "}
              <a
                href="https://www.facebook.com/privacy/policy/"
                target="_blank"
                rel="noreferrer"
              >
                Meta&rsquo;s privacy policy
              </a>
              .
            </li>
          </ul>
          <p>
            You can change your choice at any time by clearing the
            <code> synozur.cookieConsent.v1 </code>
            entry in your browser&rsquo;s site storage for www.synozur.com, which will
            cause the consent banner to reappear on your next visit. You can also
            control cookies generally through your browser settings.
          </p>

          <h2>Form Submissions</h2>
          <p>
            When you complete a contact form, subscribe form, or &ldquo;Get
            Started&rdquo; intake on our site, we collect the information you submit
            (such as name, email, company, and message) for the purpose of responding
            to your inquiry, providing the requested information, and following up about
            related Synozur services.
          </p>

          <h2>Your Choices</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Opt-out of receiving marketing communications from us at any time.</li>
            <li>
              Request access to, correction of, or deletion of your personal
              information.
            </li>
          </ul>

          <h2>Security</h2>
          <p>
            We implement appropriate technical and organizational measures to protect
            your personal information against unauthorized access, alteration,
            disclosure, or destruction.
          </p>

          <h2>Changes to This Privacy Statement</h2>
          <p>
            We may update this privacy statement from time to time. We will notify you
            by updating this privacy statement.
          </p>

          <h2>Contact Us</h2>
          <p>
            If you have any questions or concerns about our privacy practices, please
            contact us at{" "}
            <a href="mailto:privacy@synozur.com">privacy@synozur.com</a>.
          </p>

          <p>
            By providing your personal information to The Synozur Alliance, you consent
            to the collection, use, and sharing of your information as described in this
            privacy statement.
          </p>
        </div>
      </section>
    </div>
  );
}
