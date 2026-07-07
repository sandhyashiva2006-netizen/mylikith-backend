const { BrevoClient } = require("@getbrevo/brevo");

const brevo = new BrevoClient({
    apiKey: process.env.BREVO_API_KEY
});

async function sendPasswordResetEmail(email, resetLink) {

    await brevo.transactionalEmails.sendTransacEmail({

        sender: {
            name: "MyLikith",
            email: process.env.EMAIL_USER
        },

        to: [
            {
                email
            }
        ],

        subject: "Reset your MyLikith password",

        htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">

            <h2 style="color:#7c3aed">
                MyLikith Password Reset
            </h2>

            <p>
                We received a request to reset your password.
            </p>

            <p>
                Click the button below to reset your password.
            </p>

            <p style="margin:30px 0">
                <a
                    href="${resetLink}"
                    style="
                        background:#7c3aed;
                        color:#fff;
                        padding:14px 24px;
                        border-radius:8px;
                        text-decoration:none;
                    "
                >
                    Reset Password
                </a>
            </p>

            <p>
                This link expires in <strong>15 minutes</strong>.
            </p>

            <hr>

            <small>© MyLikith</small>

        </div>
        `

    });

}

module.exports = {
    sendPasswordResetEmail
};