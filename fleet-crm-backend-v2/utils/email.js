const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = 'Fleet Searcher <hello@fleetsearcher.com>';
const CRM_URL = process.env.APP_URL || 'https://app.fleetsearcher.com';

async function sendWelcomeEmail({ toEmail, toName, tempPassword }) {
  await resend.emails.send({
    from: FROM,
    to: toEmail,
    subject: 'Welcome to Fleet Searcher — Your Login Info',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
        <div style="background:#060d1f;padding:32px;text-align:center;border-radius:8px 8px 0 0">
          <h1 style="color:#fbbf24;margin:0;font-size:24px">🦅 Fleet Searcher</h1>
          <p style="color:rgba(255,255,255,.6);margin:8px 0 0">Your Fleet Sales CRM is ready</p>
        </div>
        <div style="background:#f8fafc;padding:32px;border-radius:0 0 8px 8px;border:1px solid #e2e8f0">
          <p style="margin:0 0 16px">Hi ${toName || 'there'},</p>
          <p style="margin:0 0 24px">Your Fleet Searcher account is set up and ready to go. Here are your login details:</p>

          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:0 0 24px">
            <p style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Login URL</p>
            <a href="${CRM_URL}" style="color:#1e40af;font-weight:600">${CRM_URL}</a>

            <p style="margin:20px 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Email</p>
            <p style="margin:0;font-weight:600">${toEmail}</p>

            <p style="margin:20px 0 8px;font-size:13px;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Temporary Password</p>
            <p style="margin:0;font-weight:600;font-family:monospace;font-size:18px;letter-spacing:.1em">${tempPassword}</p>
          </div>

          <p style="margin:0 0 16px;color:#64748b;font-size:14px">
            Log in and change your password from Settings after your first login.
          </p>
          <a href="${CRM_URL}" style="display:inline-block;background:#1e40af;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600">
            Log In to Fleet Searcher →
          </a>

          <p style="margin:32px 0 0;font-size:13px;color:#94a3b8">
            Questions? Reply to this email and we'll help you get started.
          </p>
        </div>
      </div>
    `,
  });
}

module.exports = { sendWelcomeEmail };
