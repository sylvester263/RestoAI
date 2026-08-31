// One-off script: converts captured product screenshots into optimized WebP
// assets for the impl-26 marketing landing page redesign. Not part of the
// build — run manually, then delete or leave as a reference for re-capturing
// later. See impl-26-landing-page-redesign.md Section 3.
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const SHOTS = 'C:/Users/SYLVES~1/AppData/Local/Temp/claude-chrome-screenshots-B7RETj';
const ROOT = 'C:/Users/Sylvester Joseph/Documents/Qoder/2026-08-26/chat-1';
const OUT = `${ROOT}/client/src/assets/marketing`;

const jobs = [
  // [source, destination filename, max width]
  [`${SHOTS}/screenshot-1788133028227-3.png`, 'whatsapp-chat.webp', 900],
  [`${SHOTS}/screenshot-1788132785596-1.jpg`, 'ai-ask-anything.webp', 1400],
  [`${SHOTS}/screenshot-1788133379492-13.png`, 'ai-agents-controls.webp', 1400],
  [`${SHOTS}/screenshot-1788132627925-0.jpg`, 'ai-reconciliation.webp', 1400],
  [`${SHOTS}/screenshot-1788133151626-7.jpg`, 'pos-till.webp', 1400],
  [`${SHOTS}/screenshot-1788133253704-11.jpg`, 'branch-analytics.webp', 1400],
  [`${SHOTS}/screenshot-1788133197866-9.jpg`, 'customer-profile.webp', 1400],
  [`${SHOTS}/screenshot-1788133224483-10.jpg`, 'coupons-list.webp', 1400],
  [`${SHOTS}/screenshot-1788133319962-12.jpg`, 'tenant-site.webp', 1400],
  [`${ROOT}/demo-02-public-menu.png`, 'public-menu.webp', 1400],
  [`${ROOT}/demo-02-checkout-filled.png`, 'checkout.webp', 1400],
  [`${ROOT}/demo-04-kitchen-display.png`, 'kitchen-display.webp', 1400],
  [`${ROOT}/demo-09-inventory-all.png`, 'inventory.webp', 1400],
  [`${ROOT}/demo-07-campaign-created.png`, 'campaign.webp', 1400],
  [`${ROOT}/demo-08-token-board.png`, 'token-board.webp', 1400],
];

mkdirSync(OUT, { recursive: true });

for (const [src, name, maxWidth] of jobs) {
  const dest = `${OUT}/${name}`;
  mkdirSync(dirname(dest), { recursive: true });
  await sharp(src)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(dest);
  console.log('wrote', name);
}
