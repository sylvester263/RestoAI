import LegalPageShell, { LegalSection } from './LegalPageShell';

// Content sourced from `term and policy/terms-and-conditions.md`. Placeholder
// fields ([DATE], [COMPANY NAME], [TIME PERIOD], [CITY], [CONTACT EMAIL])
// filled with reasonable defaults (RestoAI as the operating brand name,
// Lahore per the project's own demo/market data, 3 months matching the
// source document's own example, support@restoai.app matching the existing
// VAPID contact convention) pending formal owner/legal sign-off — see the
// shell's own disclaimer, and PROJECT-MASTER.md for the standing "pricing
// and other business specifics need owner confirmation" pattern this follows.
export default function Terms() {
  return (
    <LegalPageShell title="Terms of Service" updatedDate="September 5, 2026">
      <LegalSection number={1} title="Acceptance of Terms">
        <p>
          By creating a RestoAI account or using RestoAI's services in any capacity — as a restaurant owner, staff
          member, rider, or as a customer ordering through a restaurant that uses RestoAI — you agree to these Terms
          of Service. If you do not agree, do not use the service.
        </p>
      </LegalSection>

      <LegalSection number={2} title="What RestoAI Is">
        <p>
          RestoAI is a restaurant operations platform providing, among other things: WhatsApp-based AI ordering, a
          public web ordering storefront, dine-in QR ordering, point-of-sale and billing, inventory management, staff
          and rider management, customer relationship tools, and a set of automated background systems ("agents")
          that support restaurant operations such as order-status updates, low-stock alerts, and customer
          re-engagement. Not every feature is available on every subscription tier.
        </p>
      </LegalSection>

      <LegalSection number={3} title="Eligibility and Accounts">
        <ul className="list-disc space-y-1 pl-5">
          <li>RestoAI is intended for use by legitimate restaurant businesses and their authorized staff, and by customers of those restaurants.</li>
          <li>The person registering a restaurant account represents that they have the authority to bind that restaurant to these Terms.</li>
          <li>You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify us immediately of any unauthorized use.</li>
          <li>Staff and rider accounts are created and managed by the restaurant owner/manager who invites them; the restaurant is responsible for managing who has access.</li>
        </ul>
      </LegalSection>

      <LegalSection number={4} title="Subscription, Billing, and Plans">
        <ul className="list-disc space-y-1 pl-5">
          <li>RestoAI is offered on a subscription basis, with plans sized to the number of branches a restaurant operates. Current plan details and pricing are set out on our pricing page and/or in your specific subscription agreement, and may be updated from time to time with notice.</li>
          <li>Fees are billed in advance for the applicable billing period unless otherwise agreed.</li>
          <li><strong>Late or failed payment:</strong> if a subscription payment is not received, we may suspend access to the account until payment is resolved. Suspension does not delete your data, but active use of the platform (ordering, WhatsApp responses, POS, etc.) will be paused.</li>
          <li>Refunds, if any, are governed by the specific terms of your plan at the time of purchase.</li>
          <li>We reserve the right to change pricing for future billing periods with reasonable advance notice.</li>
        </ul>
      </LegalSection>

      <LegalSection number={5} title="Acceptable Use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Use RestoAI for any unlawful purpose, or to facilitate fraud, harassment, or abuse of customers, staff, or riders</li>
          <li>Attempt to gain unauthorized access to another restaurant's account, data, or the platform's administrative systems</li>
          <li>Interfere with or disrupt the platform's operation, including attempting to overload, probe, or circumvent security or rate-limiting controls</li>
          <li>Use the platform's messaging capabilities (including AI agents) to send unsolicited, deceptive, or abusive communications, or in violation of WhatsApp's/Meta's own policies</li>
          <li>Misrepresent your identity or authority when creating an account</li>
        </ul>
        <p>We reserve the right to suspend or terminate accounts that violate this section, including via automated detection of suspicious patterns (see Section 8).</p>
      </LegalSection>

      <LegalSection number={6} title="Your Data and Your Customers' Data">
        <ul className="list-disc space-y-1 pl-5">
          <li>You retain ownership of the business and customer data you input into or that flows through RestoAI in the course of your restaurant's operations.</li>
          <li>
            As between you and RestoAI, <strong>you are the data controller for your own customers' personal
            information</strong>, and RestoAI acts as your data processor. You are responsible for your own
            compliance with applicable consumer protection and data protection obligations toward your customers.
            See our Privacy Policy for how RestoAI, as your processor, handles that data.
          </li>
          <li>You grant RestoAI a license to process your business and customer data as necessary to provide the service, including AI-based processing as described in our Privacy Policy.</li>
        </ul>
      </LegalSection>

      <LegalSection number={7} title="Third-Party Services">
        <p>
          RestoAI's functionality depends on third-party services we do not control, including WhatsApp/Meta's
          messaging platform and Alibaba Cloud's AI infrastructure. We are not responsible for outages, policy
          changes, or pricing changes made by these third parties, though we will make reasonable efforts to notify
          you of material changes affecting your use of RestoAI. Your use of WhatsApp-based features is also subject
          to Meta's own terms and policies.
        </p>
      </LegalSection>

      <LegalSection number={8} title="Automated Systems and AI">
        <p>
          RestoAI includes AI-assisted and automated features (conversational ordering, automated business insights,
          background "agent" processes). You acknowledge that:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            AI-generated responses, while designed to be accurate and grounded in your real business data, may
            occasionally be imperfect. Where a system detects a genuinely ambiguous, sensitive, or high-stakes
            situation (such as a customer complaint, a suspected fraud pattern, or a financial discrepancy), our
            systems are designed to flag it for human review rather than resolve it autonomously — but you remain
            responsible for reviewing and acting on such flags in a timely manner.
          </li>
          <li>
            Certain automated actions (such as sending a marketing message to a customer, or suggesting a purchase
            order) can be configured to require your explicit approval before taking effect; where this is offered as
            a toggle, it is your responsibility to configure it according to your preference.
          </li>
          <li>RestoAI is not liable for business decisions made based on AI-generated insights or recommendations — these are provided as a business aid, not a guarantee of accuracy or a substitute for your own judgment.</li>
        </ul>
      </LegalSection>

      <LegalSection number={9} title="Service Availability">
        <p>
          We aim to maintain reliable service but do not guarantee uninterrupted availability. Scheduled maintenance,
          third-party outages (including WhatsApp/Meta or our cloud infrastructure providers), and circumstances
          beyond our reasonable control may affect availability. Specific uptime commitments, if any, are set out
          separately for applicable subscription tiers.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Intellectual Property">
        <p>
          RestoAI and its underlying software, design, and branding are the property of RestoAI. Nothing in these
          Terms grants you ownership of the RestoAI platform itself. Content you upload (menu items, photos, branding
          for your own restaurant's ordering pages) remains yours; you grant us the license necessary to display and
          process it as part of providing the service to you.
        </p>
      </LegalSection>

      <LegalSection number={11} title="Suspension and Termination">
        <ul className="list-disc space-y-1 pl-5">
          <li>We may suspend or terminate your account for violation of these Terms, non-payment, or suspected fraudulent or abusive activity, following our internal review processes.</li>
          <li>You may cancel your subscription at any time in accordance with your plan's terms; cancellation takes effect at the end of the current billing period unless otherwise stated.</li>
          <li>Upon termination, your access to the platform ends; we will retain your data for a reasonable period consistent with our Privacy Policy and any legal recordkeeping obligations, after which it may be deleted.</li>
        </ul>
      </LegalSection>

      <LegalSection number={12} title="Limitation of Liability">
        <p>
          To the fullest extent permitted by applicable law, RestoAI and its operators shall not be liable for
          indirect, incidental, or consequential damages arising from your use of the platform, including lost
          profits or lost business opportunities, except where such liability cannot be excluded under applicable
          law. Our total liability for any claim arising from these Terms shall not exceed the amount you paid for
          the service in the 3 months preceding the claim.
        </p>
      </LegalSection>

      <LegalSection number={13} title="Indemnification">
        <p>
          You agree to indemnify and hold RestoAI harmless from claims arising out of your misuse of the platform,
          your violation of these Terms, or your violation of any law or third-party right in connection with your
          use of the service.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Governing Law and Disputes">
        <p>
          These Terms are governed by the laws of Pakistan. Any disputes arising from these Terms shall be subject to
          the exclusive jurisdiction of the courts of Lahore, Pakistan, unless otherwise required by applicable law.
        </p>
      </LegalSection>

      <LegalSection number={15} title="Changes to These Terms">
        <p>
          We may update these Terms from time to time. Material changes will be communicated via the admin dashboard
          and/or our website with reasonable advance notice. Continued use after changes take effect constitutes
          acceptance.
        </p>
      </LegalSection>

      <LegalSection number={16} title="Contact Us">
        <p>
          Questions about these Terms can be sent to:{' '}
          <a href="mailto:support@restoai.app" className="text-brand-600 hover:underline">support@restoai.app</a>
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
