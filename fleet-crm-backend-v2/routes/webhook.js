/**
 * FLEET CRM — STRIPE WEBHOOK
 * Handles checkout.session.completed → provisions new shop + sends welcome email.
 *
 * Requires env vars:
 *   STRIPE_SECRET_KEY      — from Stripe dashboard
 *   STRIPE_WEBHOOK_SECRET  — from Stripe webhook endpoint settings (whsec_...)
 *   APP_URL                — e.g. https://app.fleetsearcher.com
 */

const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { provisionTenant } = require('../db/tenant');
const { sendWelcomeEmail } = require('../utils/email');

function generatePassword(length = 10) {
  return crypto.randomBytes(length).toString('base64').slice(0, length);
}

function slugFromEmail(email) {
  return email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '_' + Date.now().toString(36);
}

// Raw body needed for Stripe signature verification — must come BEFORE express.json
router.post(
  '/',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig    = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!secret) {
      console.error('[webhook] STRIPE_WEBHOOK_SECRET not set');
      return res.status(500).send('Webhook secret not configured');
    }

    // Verify signature
    let event;
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, sig, secret);
    } catch (err) {
      console.error('[webhook] Signature verification failed:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const email   = session.customer_details?.email || session.customer_email;
      const name    = session.customer_details?.name  || '';

      if (!email) {
        console.error('[webhook] No email in session:', session.id);
        return res.json({ received: true });
      }

      const tempPassword = generatePassword();
      const shopSlug     = slugFromEmail(email);
      const shopName     = name ? `${name}'s Shop` : `Fleet Shop (${email.split('@')[0]})`;

      try {
        await provisionTenant({
          shopSlug,
          shopName,
          adminName:     name || email.split('@')[0],
          adminEmail:    email,
          adminPassword: tempPassword,
        });
        console.log(`[webhook] ✅ Provisioned shop: ${shopSlug} for ${email}`);
      } catch (err) {
        // If already provisioned (e.g. duplicate event), log and continue
        console.error('[webhook] Provision error:', err.message);
        return res.json({ received: true });
      }

      try {
        await sendWelcomeEmail({ toEmail: email, toName: name, tempPassword });
        console.log(`[webhook] ✅ Welcome email sent to ${email}`);
      } catch (err) {
        // Don't fail the webhook if email fails — account still exists
        console.error('[webhook] Email error:', err.message);
      }
    }

    res.json({ received: true });
  }
);

module.exports = router;
