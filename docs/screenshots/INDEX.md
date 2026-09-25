# RestoAI screenshots

Captured 2026-09-24 with headless Chrome (Puppeteer) from the local build of `main` (commit c829beb), running against the live database and the demo tenant *Lahore Karahi House*. Light mode, 2x pixel density, no browser chrome. Admin and desktop pages use a 1440x900 viewport (a few are taller full-length captures or modal crops). Customer and rider pages use a 390x844 phone viewport. The Kitchen Display and display boards are dark by design.

Two images are redacted: the rider PIN in `A39-rider-pin.png` and the invite token in `A73-staff-invite-link.png`.

## A: Owner / Manager (admin app)

- `A01-owner-login.png`: Sign-in screen (owner, manager and staff all use this page)
- `A02-owner-login-filled.png`: Sign-in screen with credentials entered
- `A03-dashboard.png`: Dashboard: "Needs your attention" cards, today's KPIs and branch panel
- `A04-dashboard-full.png`: Dashboard, full length
- `A05-dashboard-branch-this-month.png`: Branch drill-down switched to "This month"
- `A06-owner-ai-assistant-panel.png`: In-app AI Assistant panel with suggested questions
- `A07-owner-ai-assistant-answer.png`: AI Assistant answering "Any ingredients running low?"
- `A08-command-palette.png`: Quick navigation (Ctrl+K) command palette
- `A09-menu-list.png`: Menu item list
- `A10-menu-add-item.png`: Add Menu Item form (full screen)
- `A11-menu-add-item-form.png`: Add Menu Item form
- `A12-menu-edit-item.png`: Edit Menu Item with photo upload and recipe sections
- `A13-menu-edit-item-recipe.png`: Edit Menu Item: recipe line (Chicken (whole), 1 kg) that deducts stock
- `A14-orders-list.png`: Orders list with status filters
- `A15-order-detail.png`: Order expanded: address, bill breakdown, customer note, status actions
- `A16-kitchen-new-order.png`: Kitchen Display: new web order #145 with customer note
- `A17-kitchen-preparing.png`: Kitchen Display: order in preparation
- `A18-kitchen-all-caught-up.png`: Kitchen Display after the order is marked ready
- `A19-kitchen-multiple-orders.png`: Kitchen Display with dine-in, WhatsApp and counter orders
- `A20-kitchen-whatsapp-order.png`: Kitchen Display: WhatsApp order after confirmation
- `A21-pos-no-shift.png`: POS before a shift is opened
- `A22-pos-open-shift.png`: Open Shift: opening cash float
- `A23-pos-shift-open.png`: POS with an open shift
- `A24-pos-new-tab.png`: New Tab: Counter, Dine-in or Phone
- `A25-pos-adding-items.png`: Adding items to a tab
- `A26-pos-round-sent.png`: Round sent to the kitchen, discount box and Settle Bill
- `A27-pos-settle.png`: Settle Bill
- `A28-pos-settle-split.png`: Settle Bill split across Cash and Card
- `A29-pos-receipt.png`: Receipt with PRA tax line and split payment
- `A30-pos-receipt-full.png`: Receipt shown over the POS screen
- `A31-pos-close-shift.png`: Close Shift: counted cash
- `A32-pos-z-report.png`: Z-Report after closing the shift
- `A33-pos-z-report-full.png`: Z-Report over the POS screen
- `A34-tables.png`: Tables page with QR and session controls
- `A35-table-qr.png`: A table's QR code, ready to print
- `A36-tables-close-session.png`: Confirming Close session
- `A37-tables-bill-requested.png`: Tables page after a guest requests the bill
- `A38-riders-roster.png`: Riders & Delivery: roster, auto-assigned delivery, reconciliation history
- `A39-rider-pin.png`: New rider PIN, shown once (PIN blurred in this image)
- `A40-riders-active-delivery.png`: Active delivery showing "Out for delivery"
- `A41-rider-reconcile.png`: Reconcile a rider's cash for a date range
- `A42-inventory-ingredients.png`: Inventory: ingredients with low-stock status
- `A43-inventory-suppliers.png`: Inventory: suppliers
- `A44-inventory-purchase-orders.png`: Inventory: purchase orders
- `A45-customers-list.png`: Customers list with tags
- `A46-customer-profile.png`: Customer profile: orders, spend, loyalty points, tags
- `A47-customer-profile-full.png`: Customer profile with order history
- `A48-customer-segments-rfm.png`: RFM segments and custom segments
- `A49-customer-segments-full.png`: Segments, full length
- `A50-coupons-list.png`: Coupons list (manual and agent-minted codes)
- `A51-coupon-create.png`: New Coupon form
- `A52-coupon-created.png`: New coupon FRIDAY15 at the top of the list
- `A53-campaigns-list.png`: Campaigns list
- `A54-campaign-create.png`: New Broadcast Campaign with live preview
- `A55-campaign-recipients.png`: Choose recipients: all customers, a saved segment, or an RFM segment
- `A56-campaign-results.png`: Sent campaign results
- `A57-reservations-day.png`: Reservations day view
- `A58-support-tickets.png`: Support tickets
- `A59-support-ticket-detail.png`: Escalated support ticket with conversation and AI classification
- `A60-insights-question.png`: AI Insights: menu insights and the question box
- `A61-insights-answer.png`: AI Insights answer
- `A62-ai-agents.png`: AI Agents overview and automation controls
- `A63-ai-agents-full.png`: AI Agents, full length
- `A64-website-builder.png`: Website Builder: templates, address and live preview
- `A65-website-builder-full.png`: Website Builder content editor, full length
- `A66-website-template-preview.png`: Previewing the Modern Minimal template
- `A67-whatsapp-connect.png`: WhatsApp Connect: not connected
- `A68-whatsapp-precheck.png`: Pre-check: "Do you already use this number on WhatsApp?"
- `A69-whatsapp-precheck-existing.png`: Guidance for a number already on the WhatsApp app
- `A70-whatsapp-precheck-provider.png`: Guidance for a number on another provider
- `A71-staff-empty.png`: Staff page before any invites
- `A72-staff-invite.png`: Invite Staff form
- `A73-staff-invite-link.png`: Invite link to share (token blurred in this image)
- `A74-staff-invite-accept.png`: What the invitee sees: Accept your invite
- `A75-staff-invites-list.png`: Pending invite in the Staff list
- `A76-permissions.png`: Staff Permissions matrix
- `A77-permissions-full.png`: Staff Permissions, full length
- `A78-token-board.png`: Token board (Ready for Pickup screen)
- `A79-menu-board.png`: Digital menu board

## S: Staff and Manager logins

- `S01-staff-dashboard.png`: Staff login: dashboard
- `S02-staff-no-permission.png`: Staff login: Staff page shows "Insufficient permissions"
- `S03-staff-coupons.png`: Staff login: Coupons page
- `S04-staff-menu.png`: Staff login: Menu page
- `S05-manager-dashboard.png`: Manager login: dashboard

## R: Rider app

- `R01-rider-login.png`: Rider login
- `R02-rider-dashboard.png`: Rider dashboard: deliveries and cash collected
- `R03-rider-picked-up.png`: After "Mark picked up"
- `R04-rider-confirm-delivered.png`: Confirming cash collected on delivery
- `R05-rider-delivered.png`: After delivery: cash collected updated

## C: Customer-facing

- `C01-tenant-site-CRASH-desktop.png`: Published restaurant website: crashes with "Something went wrong" (bug, also on production)
- `C03-tenant-site-CRASH-mobile.png`: The same crash on a phone
- `C04-menu-mobile.png`: Online menu on a phone
- `C05-menu-desktop.png`: Online menu on a computer
- `C06-menu-cart.png`: Items added to the cart
- `C07-checkout.png`: Checkout: Delivery or Pickup, order summary, coupon box
- `C08-checkout-filled.png`: Checkout with details filled in
- `C09-order-placed.png`: Order placed confirmation
- `C10-track-confirmed.png`: Tracking: confirmed
- `C11-track-preparing.png`: Tracking: preparing
- `C12-track-ready.png`: Tracking: ready
- `C13-track-out-for-delivery.png`: Tracking: out for delivery, with rider name
- `C14-track-delivered.png`: Tracking: delivered
- `C15-review-form.png`: Leaving a review
- `C16-referral-card.png`: Referral code on the order page
- `C17-reservation-form.png`: Book a Table
- `C18-reservation-filled.png`: Book a Table, filled in
- `C19-reservation-confirmed.png`: Booking confirmed
- `C20-loyalty.png`: Loyalty points balance
- `C21-menu-assistant.png`: Menu Assistant on the online menu
- `C22-menu-assistant-answer.png`: Menu Assistant recommendation
- `C23-dinein-table.png`: Dine-in: after scanning Table 1's QR
- `C24-dinein-cart.png`: Dine-in: items added
- `C25-dinein-round-sent.png`: Dine-in: round sent to the kitchen
- `C26-dinein-bill.png`: Dine-in: itemised bill with split-evenly calculator
- `C27-dinein-bill-requested.png`: Dine-in: bill requested

## W: WhatsApp AI (simulated)

- `W01-whatsapp-recommendation.png`: WhatsApp AI: greeting and recommendation
- `W02-whatsapp-order-draft.png`: WhatsApp AI: order summary awaiting "yes"
- `W03-whatsapp-order-received.png`: WhatsApp AI: order received (#148)
- `W04-whatsapp-owner-assistant-attention.png`: Owner business assistant over WhatsApp: "What needs my attention today"
- `W05-whatsapp-owner-assistant-sales.png`: Owner business assistant answering in Roman Urdu

## M: RestoAI marketing site

- `M01-restoai-home.png`: RestoAI homepage
- `M02-restoai-ordering.png`: RestoAI site: Ordering section
- `M03-restoai-ai-team.png`: RestoAI site: Your AI Team section
- `M04-restoai-operations.png`: RestoAI site: Run Your Whole Operation section
- `M05-restoai-pricing.png`: RestoAI site: Pricing section

## P: Platform Super Admin

- `P01-superadmin-login.png`: Super Admin sign-in (platform operators only)
