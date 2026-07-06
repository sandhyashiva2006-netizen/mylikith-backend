const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

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

module.exports = router;