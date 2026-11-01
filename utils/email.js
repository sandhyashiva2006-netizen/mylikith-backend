const { BrevoClient } = require("@getbrevo/brevo");

const brevo = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY
});

const BRAND = "#7c3aed";
const FROM_NAME = "MyLikith";
const FROM_EMAIL = process.env.EMAIL_USER || "support@mylikith.in";
const SITE_URL = process.env.FRONTEND_URL || "https://mylikith.in";

function escapeHtml(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[ch]);
}

function shell(content) {
    return `
    <div style="margin:0;padding:32px 12px;background:#f5f3ff;font-family:Arial,sans-serif;color:#242033">
      <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e9e3f5">
        <div style="padding:28px 32px;background:#171326;text-align:center">
          <div style="font-size:28px;font-weight:800;letter-spacing:.3px;color:#ffffff">MyLikith</div>
          <div style="font-size:12px;color:#c4b5fd;margin-top:6px">Stories. Voices. Imagination.</div>
        </div>
        <div style="padding:32px">
          ${content}
          <div style="text-align:center;margin:28px 0">
            <a href="${SITE_URL}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:13px 24px;border-radius:8px;font-weight:bold">Explore MyLikith</a>
          </div>
          <p style="font-size:13px;color:#777">Need help? Contact <a href="mailto:support@mylikith.in" style="color:${BRAND}">support@mylikith.in</a>.</p>
        </div>
        <div style="padding:18px 28px;background:#faf9fc;text-align:center;color:#888;font-size:12px">© ${new Date().getFullYear()} MyLikith. All rights reserved.</div>
      </div>
    </div>`;
}

async function sendEmail(to, subject, htmlContent) {
    if (!process.env.BREVO_API_KEY) {
        throw new Error("BREVO_API_KEY is not configured.");
    }
    await brevo.transactionalEmails.sendTransacEmail({
        sender: { name: FROM_NAME, email: FROM_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent
    });
}

async function sendPasswordResetEmail(email, resetLink) {
    await sendEmail(email, "Reset your MyLikith password", `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2 style="color:${BRAND}">MyLikith Password Reset</h2>
        <p>We received a request to reset your password.</p>
        <p>Click below to choose a new password.</p>
        <p style="margin:30px 0"><a href="${resetLink}" style="background:${BRAND};color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none">Reset Password</a></p>
        <p>This link expires in <strong>15 minutes</strong>.</p>
        <hr><small>© MyLikith</small>
      </div>`);
}

async function sendReaderWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Reader");
    await sendEmail(user.email, "Welcome to MyLikith – Your reading journey begins!", shell(`
      <h2 style="color:${BRAND}">Welcome to MyLikith, ${name}!</h2>
      <p>We're delighted to have you as part of the MyLikith reading community.</p>
      <p>Discover engaging novels, explore stories in different languages, follow your favourite authors, and build your personal library.</p>
      <p>Your next favourite story is waiting for you.</p>`));
}

async function sendWriterWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Writer");
    await sendEmail(user.email, "Welcome to MyLikith Writers!", shell(`
      <h2 style="color:${BRAND}">Your writing journey starts here, ${name}!</h2>
      <p>Congratulations on joining the MyLikith writer community.</p>
      <p>You can create and publish novels, connect with readers, grow your audience, and earn royalties from eligible monetised reading activity.</p>
      <p>Open your Writer Studio and start bringing your stories to life.</p>`));
}

async function sendPartnerWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Partner");
    await sendEmail(user.email, "Welcome to the MyLikith Author Growth Partner Program!", shell(`
      <h2 style="color:${BRAND}">Welcome aboard, ${name}!</h2>
      <p>Your application to the MyLikith Author Growth Partner Program has been approved.</p>
      <p>You can now introduce authors to MyLikith, use your partner referral code, and earn commissions in accordance with the programme terms.</p>
      <p>Visit your Partner Dashboard to view your partner details and get started.</p>`));
}

module.exports = {
    sendPasswordResetEmail,
    sendReaderWelcomeEmail,
    sendWriterWelcomeEmail,
    sendPartnerWelcomeEmail
};
