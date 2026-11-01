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
    await sendEmail(email, "Password Reset Request | MyLikith", shell(`
      <h2 style="color:${BRAND}">Password Reset Request</h2>
      <p>Dear MyLikith User,</p>
      <p>We have received a request to reset the password associated with your MyLikith account.</p>
      <p>To proceed, please use the secure link below to create a new password.</p>
      <p style="margin:30px 0"><a href="${resetLink}" style="background:${BRAND};color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none">Reset Password</a></p>
      <p>This link is valid for <strong>15 minutes</strong> and can be used only once.</p>
      <p>If you did not request a password reset, you may disregard this email. Your account will remain unchanged.</p>
      <p>Regards,<br><strong>MyLikith Support Team</strong></p>`));
}

async function sendReaderWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Reader");
    await sendEmail(user.email, "Welcome to MyLikith | Your Account Is Ready", shell(`
      <h2 style="color:${BRAND}">Welcome to MyLikith, ${name}</h2>
      <p>Dear ${name},</p>
      <p>Thank you for registering with MyLikith. We are pleased to welcome you to our reading community.</p>
      <p>Through MyLikith, you can discover novels and stories across languages, follow your favourite authors, save titles to your personal library, and continue reading at your convenience.</p>
      <p>We invite you to explore the platform and discover stories that interest you.</p>
      <p>Thank you for choosing MyLikith.</p>
      <p>Regards,<br><strong>MyLikith Team</strong></p>`));
}

async function sendWriterWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Writer");
    await sendEmail(user.email, "Welcome to MyLikith | Writer Account Activated", shell(`
      <h2 style="color:${BRAND}">Welcome to the MyLikith Writer Community</h2>
      <p>Dear ${name},</p>
      <p>Thank you for joining MyLikith as a writer. We are pleased to welcome you to our creator community.</p>
      <p>Through the Writer Studio, you can develop and publish your novels, manage your published work, and reach readers on the platform.</p>
      <p>Eligible monetised reading activity may generate royalties in accordance with the applicable MyLikith writer terms and platform policies.</p>
      <p>Please review the relevant publishing guidelines and account information before publishing your work.</p>
      <p>We look forward to supporting your writing journey.</p>
      <p>Regards,<br><strong>MyLikith Writer Relations Team</strong></p>`));
}

async function sendPartnerWelcomeEmail(user) {
    const name = escapeHtml(user.name || "Partner");
    await sendEmail(user.email, "MyLikith Author Growth Partner Program | Application Approved", shell(`
      <h2 style="color:${BRAND}">Your Partner Application Has Been Approved</h2>
      <p>Dear ${name},</p>
      <p>We are pleased to inform you that your application to the MyLikith Author Growth Partner Program has been approved.</p>
      <p>As an approved partner, you may introduce authors to the MyLikith platform and use your assigned referral code to track eligible referrals.</p>
      <p>Commissions, eligibility, attribution, and settlement are governed by the applicable programme terms and MyLikith policies. Please review those terms in your Partner Dashboard.</p>
      <p>You may now sign in to your Partner Dashboard to access your referral details and programme information.</p>
      <p>Thank you for your interest in supporting the MyLikith author community.</p>
      <p>Regards,<br><strong>MyLikith Partner Relations Team</strong></p>`));
}

module.exports = {
    sendPasswordResetEmail,
    sendReaderWelcomeEmail,
    sendWriterWelcomeEmail,
    sendPartnerWelcomeEmail
};
