const Brevo = require("@getbrevo/brevo");

const apiInstance = new Brevo.TransactionalEmailsApi();

apiInstance.setApiKey(
    Brevo.TransactionalEmailsApiApiKeys.apiKey,
    process.env.BREVO_API_KEY
);

async function sendPasswordResetEmail(email, resetLink) {

    const emailData = {

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
                Click the button below to create a new password.
            </p>

            <p style="margin:30px 0">

                <a
                    href="${resetLink}"
                    style="
                        background:#7c3aed;
                        color:white;
                        padding:14px 24px;
                        border-radius:8px;
                        text-decoration:none;
                        display:inline-block;
                    "
                >

                    Reset Password

                </a>

            </p>

            <p>

                This link expires in
                <strong>15 minutes</strong>.

            </p>

            <p>

                If you did not request this,
                you can safely ignore this email.

            </p>

            <hr>

            <small>

                © MyLikith

            </small>

        </div>

        `

    };

    await apiInstance.sendTransacEmail(emailData);

}

module.exports = {

    sendPasswordResetEmail

};