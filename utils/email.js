const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendPasswordResetEmail(email, resetLink) {

    await transporter.sendMail({

        from: `"MyLikith" <${process.env.EMAIL_USER}>`,

        to: email,

        subject: "Reset your MyLikith password",

        html: `
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
                        color:#fff;
                        padding:14px 24px;
                        text-decoration:none;
                        border-radius:8px;
                        display:inline-block;
                    "
                >
                    Reset Password
                </a>
            </p>

            <p>
                This link expires in <strong>15 minutes</strong>.
            </p>

            <p>
                If you didn't request this, you can safely ignore this email.
            </p>

            <hr>

            <small>
                © MyLikith
            </small>

        </div>
        `
    });

}

module.exports = {
    sendPasswordResetEmail
};