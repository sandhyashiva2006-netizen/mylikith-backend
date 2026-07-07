const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const crypto = require("crypto");

const {
    sendPasswordResetEmail
} = require("../utils/email");

const db = require("../db");

const { rewardCoins } = require("./wallet");

const{

createNotification

}=require("./writers");

const router = express.Router();

const { requireFields } = require("../utils/validate");

router.post("/register", async (req, res) => {

const validation = requireFields(req.body, [
    "name",
    "email",
    "password"
]);

if (!validation.success) {

    return res.status(400).json({
        success: false,
        message: `${validation.field} is required.`
    });

}

try {

const {

name,

email,

password,

referral_code

}=req.body;

const existing = await db.query(

`
SELECT id
FROM users
WHERE email=$1
`,

[email]

);

if(existing.rows.length){

return res.status(400).json({

success:false,

message:"Email already registered."

});

}

const hashedPassword =
await bcrypt.hash(password, 10);

const myReferralCode=

"MLK"+

Math.random()

.toString(36)

.substring(2,8)

.toUpperCase();

const result = await db.query(

`
INSERT INTO users
(

name,

email,

password_hash,

referral_code,

referred_by

)

VALUES
(

$1,

$2,

$3,

$4,

(

SELECT id

FROM users

WHERE referral_code=$5

)

)

RETURNING

id,

name,

email,

role,

referral_code
`,

[
name,

email,

hashedPassword,

myReferralCode,

referral_code||null
]

);

if(referral_code){

const referrer=await db.query(

`
SELECT id
FROM users
WHERE referral_code=$1
`,

[
referral_code
]

);

if(referrer.rows.length){

const referrerId=referrer.rows[0].id;

const newUserId=result.rows[0].id;

await db.query(

`
INSERT INTO referrals
(

referrer_id,

referred_user_id,

reward_coins,

status,

rewarded_at

)

VALUES

(

$1,

$2,

20,

'Completed',

NOW()

)
`,

[
referrerId,
newUserId
]

);

await rewardCoins(

referrerId,

20,

"Referral Reward"

);

await createNotification(

referrerId,

"🎁 Referral Reward",

"Congratulations! You earned 20 coins because a new user joined using your referral link.",

"referral",

newUserId

);

await rewardCoins(

newUserId,

20,

"Welcome Referral Bonus"

);

await createNotification(

newUserId,

"🎉 Welcome Bonus",

"Welcome to MyLikith! You received 20 bonus coins for joining with a referral link.",

"referral",

referrerId

);

}

}

res.json({
success:true,
user:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post("/login", async (req,res)=>{

const validation = requireFields(req.body, [
    "email",
    "password"
]);

if (!validation.success) {

    return res.status(400).json({
        success: false,
        message: `${validation.field} is required.`
    });

}

try{

const { email,password } = req.body;

const user = await db.query(

`
SELECT *
FROM users
WHERE email=$1
`,

[email]

);

if(user.rows.length===0){

return res.status(400).json({
message:"User not found"
});

}

const valid =
await bcrypt.compare(
password,
user.rows[0].password_hash
);

if(!valid){

return res.status(400).json({
message:"Wrong password"
});

}

const token =
jwt.sign(

{
id:user.rows[0].id,
role:user.rows[0].role
},

process.env.JWT_SECRET,

{
expiresIn:"7d"
}

);

res.json({

success:true,

token,

user:{

id:user.rows[0].id,

name:user.rows[0].name,

email:user.rows[0].email,

role:user.rows[0].role,

referral_code:user.rows[0].referral_code

}

});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

/* ==========================================
   FORGOT PASSWORD
========================================== */

router.post("/forgot-password", async (req, res) => {

    try {

        const { email } = req.body;

        if (!email) {

            return res.status(400).json({

                success: false,
                message: "Email is required."

            });

        }

        const user = await db.query(

            `
            SELECT id,email
            FROM users
            WHERE email=$1
            `,

            [email]

        );

        // Always return success
        // Prevents email enumeration

        if (user.rows.length === 0) {

            return res.json({

                success: true,
                message:
                    "If an account exists, a reset email has been sent."

            });

        }

        const token =
            crypto.randomBytes(32).toString("hex");

        await db.query(

            `
            DELETE FROM password_reset_tokens
            WHERE user_id=$1
            `,

            [
                user.rows[0].id
            ]

        );

        await db.query(

            `
            INSERT INTO password_reset_tokens
            (

                user_id,

                token,

                expires_at

            )

            VALUES

            (

                $1,

                $2,

                NOW()+INTERVAL '15 minutes'

            )
            `,

            [

                user.rows[0].id,

                token

            ]

        );

        const resetLink =

`${process.env.APP_URL}/reset-password.html?token=${token}`;

        await sendPasswordResetEmail(

            email,

            resetLink

        );

        res.json({

            success: true,

            message:
                "If an account exists, a reset email has been sent."

        });

    }

    catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,

            message: "Internal server error."

        });

    }

});


/* ==========================================
   RESET PASSWORD
========================================== */

router.post("/reset-password", async (req, res) => {

    try {

        const {

            token,

            password

        } = req.body;

        if (!token || !password) {

            return res.status(400).json({

                success: false,

                message:
                    "Token and password are required."

            });

        }

        const result = await db.query(

            `
            SELECT *

            FROM password_reset_tokens

            WHERE

            token=$1

            AND

            expires_at > NOW()
            `,

            [

                token

            ]

        );

        if (!result.rows.length) {

            return res.status(400).json({

                success: false,

                message:
                    "Invalid or expired reset link."

            });

        }

if (password.length < 8) {

    return res.status(400).json({

        success: false,

        message: "Password must be at least 8 characters long."

    });

}

        const hashed =

await bcrypt.hash(password,10);

        await db.query(

            `
            UPDATE users

            SET password_hash=$1

            WHERE id=$2
            `,

            [

                hashed,

                result.rows[0].user_id

            ]

        );

        await db.query(

            `
            DELETE FROM password_reset_tokens

            WHERE token=$1
            `,

            [

                token

            ]

        );

await db.query(`
DELETE FROM password_reset_tokens
WHERE expires_at < NOW()
`);

        res.json({

            success:true,

            message:"Password updated successfully."

        });

    }

    catch(err){

        console.error(err);

        res.status(500).json({

            success:false,

            message:"Internal server error."

        });

    }

});

module.exports = router;