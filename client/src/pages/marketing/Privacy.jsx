import LegalPageShell, { LegalSection } from './LegalPageShell';

// Content sourced from `term and policy/privacy-policy.md`. Placeholder
// fields ([DATE], [CONTACT EMAIL]) filled with the project's existing
// conventions (support@restoai.app is already used as the VAPID push
// contact) pending formal confirmation — see the shell's own disclaimer.
export default function Privacy() {
  return (
    <LegalPageShell title="Privacy Policy" updatedDate="September 5, 2026">
      <LegalSection number={1} title="Who This Policy Covers">
        <p>This policy applies to two distinct groups, and it's important to understand which one you are:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Restaurant Accounts</strong> — owners, managers, staff, and riders who use RestoAI to run their
            restaurant. If you're reading this as a restaurant business, you are also responsible for your own
            customers' privacy under Section 11 below.
          </li>
          <li>
            <strong>End Customers</strong> — people who order food from a restaurant that uses RestoAI, via WhatsApp,
            our public ordering websites, dine-in QR codes, or in person through a restaurant's counter.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={2} title="Information We Collect">
        <div>
          <p className="font-medium text-[var(--text-primary)]">From Restaurant Accounts (owners, staff, riders)</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Name, email address, phone number, password (stored hashed, never in plain text)</li>
            <li>Business details: restaurant name, branch addresses, tax registration information if provided</li>
            <li>Role and permission level within your account</li>
            <li>
              For riders specifically: phone number and a PIN (stored encrypted, not plain text) — riders use a
              separate, lighter authentication system from staff accounts
            </li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-[var(--text-primary)]">From End Customers (a restaurant's own customers)</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Name and phone number (this is how we identify you across orders — we do not require an account, email,
              or password to order)
            </li>
            <li>Delivery address, if you order for delivery</li>
            <li>Order history: items ordered, order value, order channel (WhatsApp, website, dine-in, counter)</li>
            <li>
              The content of messages you send when ordering or asking a question via WhatsApp — including if you
              send a photo (e.g. of a menu) or a voice-adjacent text conversation
            </li>
            <li>Reviews and ratings you choose to leave</li>
            <li>Reservation details, if you book a table</li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-[var(--text-primary)]">Automatically Collected</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Standard web technical data (IP address, browser type, device type) when using our websites or ordering pages</li>
            <li>Usage patterns within the admin dashboard, for restaurant accounts</li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-[var(--text-primary)]">Payment Information</p>
          <p>
            At the time of writing, RestoAI processes orders on a Cash on Delivery basis only. We do not currently
            store or process card numbers, bank details, or other payment credentials. If and when an online payment
            gateway is introduced, this policy will be updated before that feature goes live, and payment credentials
            will be handled by a licensed payment processor, never stored directly on our servers.
          </p>
        </div>
      </LegalSection>

      <LegalSection number={3} title="How We Use Your Information">
        <ul className="list-disc space-y-1 pl-5">
          <li>To take, confirm, prepare, and deliver your order</li>
          <li>To respond to your questions and support requests, including via our AI-assisted WhatsApp conversation (see Section 4)</li>
          <li>To send you order status updates</li>
          <li>
            To operate loyalty programs, process reviews, and (where a restaurant has enabled it, and where you have
            not opted out) send you offers or re-engagement messages
          </li>
          <li>
            To help the restaurant you're ordering from manage their inventory, staffing, and operations — your order
            data feeds into their own business analytics
          </li>
          <li>To detect and prevent fraud or abuse (e.g. repeated fraudulent order cancellations)</li>
          <li>To comply with applicable law, including tax and financial recordkeeping requirements</li>
        </ul>
      </LegalSection>

      <LegalSection number={4} title="AI Processing — What You Should Know">
        <p>
          RestoAI uses AI (Qwen, provided via Alibaba Cloud's DashScope service) to understand and respond to your
          WhatsApp messages, digitize menu photos, generate business insights for restaurant owners, and power
          several automated background processes ("agents") that assist restaurant operations. Specifically:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Messages you send to place an order or ask a question are processed by this AI to understand your request and generate a response.</li>
          <li>Where a restaurant owner uploads a photo of their menu, that image is processed by the same AI service to extract menu items.</li>
          <li>This processing may involve your message content being sent to Alibaba Cloud's servers, which may be located outside Pakistan, for processing.</li>
          <li>
            Automated background systems ("agents") may analyze order patterns, payment records, and customer
            engagement history to support restaurant operations — for example, flagging when you haven't ordered in a
            while so a restaurant can send you a personalized offer, or checking that a delivered order's payment was
            properly recorded. Where these processes make a judgment that could affect you materially (such as
            flagging a pattern as potentially abusive), a human at the restaurant reviews it before any action is
            taken — our system is designed so that consequential decisions are never made by AI alone.
          </li>
        </ul>
      </LegalSection>

      <LegalSection number={5} title="WhatsApp and Meta">
        <p>
          RestoAI's ordering system operates through WhatsApp, a service provided by Meta. When you message a
          restaurant on WhatsApp, Meta's own privacy policy and terms also apply to that communication, in addition
          to this one. We encourage you to review Meta's WhatsApp privacy policy for details on how Meta itself
          handles message transport and their own data practices.
        </p>
      </LegalSection>

      <LegalSection number={6} title="Who We Share Information With">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>The restaurant you're ordering from</strong> — they can see your order history, contact details,
            and any messages/reviews related to your orders with them. They cannot see your activity with other,
            unrelated restaurants on RestoAI.
          </li>
          <li><strong>Meta / WhatsApp</strong> — as the messaging infrastructure provider, per Section 5.</li>
          <li><strong>Alibaba Cloud (DashScope)</strong> — as our AI processing provider, per Section 4.</li>
          <li>
            <strong>Our hosting and database providers</strong> (currently Vercel for application hosting and Neon
            for database hosting) — as necessary to operate the service. These providers do not use your data for
            their own purposes.
          </li>
          <li><strong>Delivery riders</strong> assigned to your order — your name, phone number, and delivery address, solely to complete delivery.</li>
          <li><strong>Law enforcement or regulators</strong>, where legally required.</li>
        </ul>
        <p>
          We do not sell your personal information to third parties, and we do not share it with other restaurants
          or businesses for their own independent marketing purposes.
        </p>
      </LegalSection>

      <LegalSection number={7} title="Data Retention">
        <p>
          We retain order and account data for as long as necessary to provide the service, meet tax/financial
          recordkeeping obligations, and resolve any disputes. A restaurant can request deletion of their own account
          data; individual customers can request that a specific restaurant delete their contact information,
          subject to the restaurant's own recordkeeping obligations (e.g. financial records may need to be retained
          regardless of a deletion request, per applicable law).
        </p>
      </LegalSection>

      <LegalSection number={8} title="Data Security">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tenant data is isolated by design — one restaurant's data is never accessible to another restaurant using the platform.</li>
          <li>Passwords are stored using industry-standard hashing, never in plain text.</li>
          <li>Sensitive values requiring reversible access (such as rider verification PINs) are stored encrypted, not in plain text.</li>
          <li>Access to administrative and platform-operator functions requires separate, more strongly secured authentication (including two-factor authentication for platform administrators) than ordinary restaurant staff accounts.</li>
          <li>No system is perfectly secure, and we cannot guarantee absolute security, but we apply current best practices and conduct regular internal security review.</li>
        </ul>
      </LegalSection>

      <LegalSection number={9} title="Your Rights">
        <p>
          Depending on applicable law, you may have rights to access, correct, or request deletion of your personal
          information. To exercise these rights regarding your order history with a specific restaurant, please
          contact that restaurant directly, or contact us at{' '}
          <a href="mailto:support@restoai.app" className="text-brand-600 hover:underline">support@restoai.app</a>{' '}
          and we will assist in routing your request. Pakistan's data protection legal framework is still developing;
          we will update this section as applicable law becomes clearer or is enacted.
        </p>
      </LegalSection>

      <LegalSection number={10} title="Marketing Communications">
        <p>
          If a restaurant sends you promotional messages (offers, win-back campaigns) via WhatsApp, you can opt out
          at any time by replying to that message as instructed, or by contacting the restaurant directly. Order
          confirmations, status updates, and direct responses to your own messages are not marketing communications
          and are not affected by opting out of marketing.
        </p>
      </LegalSection>

      <LegalSection number={11} title="If You're a Restaurant Using RestoAI">
        <p>
          You are the data controller for your own customers' personal information under most applicable data
          protection frameworks — RestoAI acts as your data processor, providing the infrastructure. This means you
          are responsible for your own compliance obligations toward your customers (e.g., honoring their requests,
          complying with any consumer protection or data protection law that applies to your business), and this
          policy describes how RestoAI, as your processor, handles that data on your behalf.
        </p>
      </LegalSection>

      <LegalSection number={12} title="Children's Privacy">
        <p>
          RestoAI is intended for use by adults placing food orders or operating a restaurant business. We do not
          knowingly collect personal information from children. If you believe a child has provided us with personal
          information, please contact us.
        </p>
      </LegalSection>

      <LegalSection number={13} title="International Data Transfers">
        <p>
          As described in Section 4, some data processing (particularly AI-related processing) may occur on servers
          outside Pakistan. By using RestoAI, you acknowledge this cross-border processing as part of how the
          service operates.
        </p>
      </LegalSection>

      <LegalSection number={14} title="Changes to This Policy">
        <p>
          We may update this policy from time to time. Material changes will be communicated via the restaurant admin
          dashboard and/or a notice on our website. Continued use of RestoAI after changes take effect constitutes
          acceptance of the updated policy.
        </p>
      </LegalSection>

      <LegalSection number={15} title="Contact Us">
        <p>
          Questions about this policy, or requests regarding your personal information, can be sent to:{' '}
          <a href="mailto:support@restoai.app" className="text-brand-600 hover:underline">support@restoai.app</a>
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
