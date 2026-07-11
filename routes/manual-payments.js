const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");

router.use(auth);

/* =====================================
   SUBMIT MANUAL PAYMENT
===================================== */

router.post("/submit", async (req, res) => {

    try {

        const {

    payment_type,
    package_id,
    plan_id,
    transaction_id,
    screenshot

} = req.body;

if(

payment_type!=="coin"

&&

payment_type!=="premium"

){

return res.status(400).json({

success:false,

message:"Invalid payment type."

});

}

        const user_id = req.user.id;

let amount = 0;
let coins = 0;

if(

payment_type==="coin"

&&

!package_id

){

return res.status(400).json({

success:false,

message:"Package is required."

});

}

if(

payment_type==="premium"

&&

!plan_id

){

return res.status(400).json({

success:false,

message:"Premium plan is required."

});

}

if(

!payment_type||

!transaction_id

){

return res.status(400).json({

success:false,

message:"Missing required fields."

});

}

/* ==========================
   VALIDATE PACKAGE
========================== */

if(payment_type==="coin"){

const pkg=await db.query(

`
SELECT *

FROM coin_packages

WHERE id=$1
`,

[
package_id
]

);

if(!pkg.rows.length){

return res.status(400).json({

success:false,

message:"Invalid package."

});

}

amount=Number(pkg.rows[0].price);

coins=

Number(pkg.rows[0].coins)

+

Number(pkg.rows[0].bonus_coins);

}

/* ==========================
   VALIDATE PREMIUM PLAN
========================== */

if(payment_type==="premium"){

const plan=await db.query(

`
SELECT
price,
coins
FROM premium_plans
WHERE id=$1
`,

[
plan_id
]

);

if(!plan.rows.length){

return res.status(400).json({

success:false,

message:"Invalid plan."

});

}

amount=Number(plan.rows[0].price);

coins=Number(plan.rows[0].coins);

}

        const exists = await db.query(
            `
            SELECT id,status

FROM manual_payments

WHERE transaction_id=$1
            `,
            [transaction_id]
        );

        if(exists.rows.length){

return res.status(400).json({

success:false,

message:

"This UPI Transaction ID has already been submitted."

});

}

if(transaction_id.length<8){

return res.status(400).json({

success:false,

message:"Invalid Transaction ID."

});

}

        await db.query(

            `
            INSERT INTO manual_payments
            (
                user_id,
                payment_type,
                package_id,
                plan_id,
                amount,
                coins,
                transaction_id,
                screenshot
            )

            VALUES
            (
                $1,$2,$3,$4,$5,$6,$7,$8
            )
            `,

            [
                user_id,
                payment_type,
                package_id || null,
                plan_id || null,
                amount,
                coins,
                transaction_id,
                screenshot || null
            ]

        );

        res.json({

            success: true,
            message: "Payment submitted successfully."

        });

    } catch (err) {

        console.log(err);

        res.status(500).json({

            success: false,
            message: "Unable to submit payment."

        });

    }

});

/* =====================================
   USER PAYMENT HISTORY
===================================== */

router.get("/history", async (req, res) => {

    try {

        const result = await db.query(

            `
            SELECT *
            FROM manual_payments

            WHERE user_id=$1

            ORDER BY id DESC
            `,

            [req.user.id]

        );

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json([]);

    }

});

/* =====================================
   GET ALL MANUAL PAYMENTS (ADMIN)
===================================== */

router.get("/admin/list", async (req, res) => {

    try {

        if (req.user.role !== "admin") {

            return res.status(403).json({
                success:false,
                message:"Access denied."
            });

        }

        const result = await db.query(`
            SELECT
                mp.*,
                u.name,
                u.email
            FROM manual_payments mp
            JOIN users u
            ON mp.user_id=u.id
            ORDER BY mp.created_at DESC
        `);

        res.json(result.rows);

    } catch(err){

        console.log(err);

        res.status(500).json([]);

    }

});

/* =====================================
   APPROVE MANUAL PAYMENT
===================================== */

router.put("/admin/:id/approve", async (req,res)=>{

try{

if(req.user.role!=="admin"){

return res.status(403).json({

success:false

});

}

const payment=await db.query(

`
SELECT *
FROM manual_payments
WHERE id=$1
`,

[
req.params.id
]

);

if(payment.rows.length===0){

return res.status(404).json({

success:false

});

}

const{

admin_note

}=req.body;

const p=payment.rows[0];

if(p.status!=="Pending"){

return res.status(400).json({

success:false,

message:"This payment has already been processed."

});

}

if(p.status!=="Pending"){

return res.json({

success:false,

message:"Payment already processed."

});

}

if(p.status==="Approved"){

return res.json({

success:true

});

}

await db.query(

`
UPDATE manual_payments

SET

status='Approved',

admin_note=$2,

verified_at=NOW()

WHERE id=$1

`,

[
p.id,

admin_note||null

]

);

/* ===========================
   COIN PURCHASE
=========================== */

if(p.payment_type==="coin"){

const pkg = await db.query(

`
SELECT
coins,
bonus_coins,
price
FROM coin_packages
WHERE id=$1
`,

[
p.package_id
]

);

if(!pkg.rows.length){

return res.status(400).json({

success:false,

message:"Coin package not found."

});

}

const totalCoins =

Number(pkg.rows[0].coins)

+

Number(pkg.rows[0].bonus_coins);

const packageAmount =

Number(pkg.rows[0].price);

if(Number(p.amount)!==packageAmount){

return res.status(400).json({

success:false,

message:"Payment amount mismatch."

});

}

let wallet=await db.query(

`
SELECT *

FROM wallets

WHERE user_id=$1
`,

[
p.user_id
]

);

if(wallet.rows.length===0){

await db.query(

`
INSERT INTO wallets
(
user_id,
coins,
earned_coins,
spent_coins
)

VALUES

($1,0,0,0)
`,

[
p.user_id
]

);

wallet=await db.query(

`
SELECT *

FROM wallets

WHERE user_id=$1
`,

[
p.user_id
]

);

}

await db.query(

`
UPDATE wallets

SET

coins=coins+$1,

earned_coins=earned_coins+$1

WHERE user_id=$2
`,

[
totalCoins,
p.user_id
]

);

await db.query(

`
INSERT INTO wallet_transactions
(

wallet_id,

user_id,

type,

coins,

amount,

description,

reference_id

)

VALUES
(

$1,

$2,

'Credit',

$3,

$4,

'Manual Coin Purchase',

$5

)
`,

[
wallet.rows[0].id,
p.user_id,
totalCoins,
packageAmount,
p.transaction_id
]

);

}

/* ===========================
   PREMIUM PURCHASE
=========================== */

if(p.payment_type==="premium"){

const premium = await db.query(

`
SELECT
coins,
price,
duration_days
FROM premium_plans
WHERE id=$1
`,

[
p.plan_id
]

);

if(!premium.rows.length){

return res.status(400).json({

success:false,

message:"Premium plan not found."

});

}

const premiumCoins =

Number(premium.rows[0].coins);

const premiumPrice =

Number(premium.rows[0].price);

if(Number(p.amount)!==premiumPrice){

return res.status(400).json({

success:false,

message:"Payment amount mismatch."

});

}

const durationDays =

Number(premium.rows[0].duration_days);

const activePremium=await db.query(

`
SELECT id

FROM user_premium

WHERE

user_id=$1

AND

status='Active'

AND

expiry_date>NOW()

LIMIT 1
`,

[
p.user_id
]

);

if(activePremium.rows.length){

return res.json({

success:true,

message:"Premium already active."

});

}

const plan=await db.query(

`
SELECT *

FROM premium_plans

WHERE id=$1
`,

[
p.plan_id
]

);

const days = durationDays;

await db.query(

`
INSERT INTO user_premium
(

user_id,

plan_id,

payment_order_id,

expiry_date

)

VALUES
(

$1,

$2,

$3,

NOW()+($4||' days')::interval

)
`,

[
p.user_id,
p.plan_id,
p.transaction_id,
days
]

);

await db.query(

`
UPDATE wallets

SET

coins=coins+$1,

earned_coins=earned_coins+$1

WHERE user_id=$2
`,

[
premiumCoins,
p.user_id
]

);

}

await db.query(

`
INSERT INTO reader_notifications
(

user_id,

title,

message,

type,

created_at

)

VALUES

(

$1,

$2,

$3,

$4,

NOW()

)
`,

[
p.user_id,

"✅ Payment Approved",

p.payment_type==="coin"

? `Your payment has been verified. ${totalCoins} coins have been added to your wallet.`

: "Your Premium Membership has been activated successfully.",

"payment"

]

);

res.json({

success:true,

message:"Payment approved."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

/* =====================================
   REJECT MANUAL PAYMENT
===================================== */

router.put("/admin/:id/reject", async (req,res)=>{

try{

if(req.user.role!=="admin"){

return res.status(403).json({

success:false,

message:"Access denied."

});

}

const{

admin_note

}=req.body;

const payment=await db.query(

`
SELECT *

FROM manual_payments

WHERE id=$1
`,

[
req.params.id
]

);

if(payment.rows.length===0){

return res.status(404).json({

success:false,

message:"Payment not found."

});

}

await db.query(

`
UPDATE manual_payments

SET

status='Rejected',

admin_note=$2,

verified_at=NOW()

WHERE id=$1
`,

[
req.params.id,
admin_note||null
]

);

await db.query(

`
INSERT INTO reader_notifications
(

user_id,

title,

message,

type,

created_at

)

VALUES

(

$1,

$2,

$3,

$4,

NOW()

)
`,

[
payment.rows[0].user_id,

"❌ Payment Rejected",

admin_note

? `Reason: ${admin_note}`

: "Your payment request was rejected. Please contact support.",

"payment"

]

);

res.json({

success:true,

message:"Payment rejected."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to reject payment."

});

}

});

/* =====================================
   PAYMENT STATUS
===================================== */

router.get("/status/:id",async(req,res)=>{

try{

const payment=await db.query(

`
SELECT

id,

status,

admin_note,

verified_at

FROM manual_payments

WHERE

id=$1

AND

user_id=$2
`,

[
req.params.id,
req.user.id
]

);

if(payment.rows.length===0){

return res.status(404).json({

success:false

});

}

res.json(payment.rows[0]);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

module.exports = router;