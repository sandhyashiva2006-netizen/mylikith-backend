const express=require("express");

const router=express.Router();

const db=require("../db");

/* ===========================
GET PLANS
=========================== */

router.get(
"/plans",
async(req,res)=>{

try{

const result=

await db.query(

`
SELECT *

FROM premium_plans

WHERE active=true

ORDER BY price
`

);

await checkPremiumAchievements(user_id);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

/* ===========================
PREMIUM ACCESS CHECK
=========================== */

router.get(
"/access/:userId",
async(req,res)=>{

try{

const result=await db.query(

`
SELECT

up.id,
up.expiry_date,
pp.name

FROM user_premium up

JOIN premium_plans pp
ON up.plan_id=pp.id

WHERE

up.user_id=$1

AND up.status='Active'

AND up.expiry_date>NOW()

LIMIT 1
`,

[
req.params.userId
]

);

if(result.rows.length===0){

return res.json({

premium:false

});

}

res.json({

premium:true,

plan:result.rows[0].name,

expiry:result.rows[0].expiry_date

});

}catch(err){

console.log(err);

res.status(500).json({

premium:false

});

}

});

/* ===========================
PREMIUM STATUS
=========================== */

router.get(
"/status/:userId",
async(req,res)=>{

try{

const result=

await db.query(

`
SELECT

up.*,

pp.name,

pp.coins

FROM user_premium up

JOIN premium_plans pp

ON up.plan_id=pp.id

WHERE

up.user_id=$1

AND

up.status='Active'

AND

up.expiry_date>NOW()

LIMIT 1
`,

[
req.params.userId
]

);

if(result.rows.length===0){

return res.json({

premium:false

});

}

if(new Date(result.rows[0].expiry_date)<new Date()){

await db.query(

`
UPDATE user_premium

SET status='Expired'

WHERE id=$1
`,

[
result.rows[0].id
]

);

return res.json({

premium:false

});

}

res.json({

premium:true,

details:result.rows[0]

});

}catch(err){

console.log(err);

res.status(500).json({

premium:false

});

}

});

/* ===========================
PURCHASE
=========================== */

router.post(
"/purchase",
async(req,res)=>{

try{

const{

user_id,

plan_id,

payment_order_id

}=req.body;

const activePremium=await db.query(

`
SELECT id
FROM user_premium
WHERE
user_id=$1
AND status='Active'
AND expiry_date>NOW()
LIMIT 1
`,

[
user_id
]

);

if(activePremium.rows.length){

return res.json({

success:false,

message:"Premium membership already active."

});

}

const plan=

await db.query(

`
SELECT *

FROM premium_plans

WHERE id=$1
`,

[
plan_id
]

);

if(plan.rows.length===0){

return res.status(404).json({

success:false,

message:"Plan not found."

});

}

const days=
plan.rows[0].duration_days;

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

user_id,

plan_id,

payment_order_id,

days

]

);

await db.query(

`
UPDATE wallets

SET

coins=coins+$1

WHERE user_id=$2
`,

[

plan.rows[0].coins,

user_id

]

);

res.json({

success:true,

message:"Premium activated."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});



router.post("/activate", async(req,res)=>{

try{

const{

user_id,
plan_id,
order_id

}=req.body;

const activePremium=await db.query(

`
SELECT id
FROM user_premium
WHERE
user_id=$1
AND status='Active'
AND expiry_date>NOW()
LIMIT 1
`,

[
user_id
]

);

if(activePremium.rows.length){

return res.json({

success:true

});

}

const plan=await db.query(
`
SELECT *
FROM premium_plans
WHERE id=$1
`,
[plan_id]
);

const days=plan.rows[0].duration_days;

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
user_id,
plan_id,
order_id,
days
]
);

await db.query(
`
UPDATE wallets
SET coins=coins+$1
WHERE user_id=$2
`,
[
plan.rows[0].coins,
user_id
]
);

res.json({

success:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

const axios=require("axios");

router.post(
"/create-order",
async(req,res)=>{

try{

const{
user_id,
plan_id
}=req.body;

const plan=await db.query(
`
SELECT *
FROM premium_plans
WHERE id=$1
`,
[plan_id]
);

if(plan.rows.length===0){

return res.json({
success:false,
message:"Plan not found."
});

}

const orderId=`PRE_${Date.now()}`;

const orderPayload={

order_id:orderId,

order_amount:Number(plan.rows[0].price),

order_currency:"INR",

customer_details:{

customer_id:String(user_id),

customer_name:"MyLikith Reader",

customer_email:"premium@mylikith.com",

customer_phone:"9999999999"

},

order_meta:{

return_url:
`https://mylikith-frontend.pages.dev/payment-success.html?type=premium&order_id={order_id}&plan_id=${plan_id}`

}

};

console.log("========== PREMIUM ORDER ==========");
console.log(orderPayload);

const response=await axios.post(

"https://sandbox.cashfree.com/pg/orders",

orderPayload,

{

headers:{

"x-client-id":
process.env.CASHFREE_APP_ID,

"x-client-secret":
process.env.CASHFREE_SECRET_KEY,

"x-api-version":
"2025-01-01",

"Content-Type":
"application/json"

}

}

);

console.log("========== CASHFREE RESPONSE ==========");
console.log(response.data);

res.json({

success:true,

paymentSessionId:
response.data.payment_session_id,

orderId

});

}catch(err){

console.log("========== PREMIUM ORDER ERROR ==========");

console.log(err.response?.data||err);

res.status(500).json({

success:false,

message:"Unable to create premium order."

});

}

});

router.post(
"/verify-payment",
async(req,res)=>{

try{

const{

order_id,
plan_id,
user_id

}=req.body;

const activePremium=await db.query(

`
SELECT id
FROM user_premium
WHERE
user_id=$1
AND status='Active'
AND expiry_date>NOW()
LIMIT 1
`,

[
user_id
]

);

if(activePremium.rows.length){

return res.json({

success:true

});

}

const response=
await axios.get(

`https://sandbox.cashfree.com/pg/orders/${order_id}`,

{

headers:{

"x-client-id":
process.env.CASHFREE_APP_ID,

"x-client-secret":
process.env.CASHFREE_SECRET_KEY,

"x-api-version":
"2025-01-01"

}

}

);

if(response.data.order_status!=="PAID"){

return res.json({

success:false,

message:"Payment Pending"

});

}

const exists=
await db.query(

`
SELECT id

FROM user_premium

WHERE payment_order_id=$1
`,

[
order_id
]

);

if(exists.rows.length){

return res.json({

success:true

});

}

const plan=
await db.query(

`
SELECT *

FROM premium_plans

WHERE id=$1
`,

[
plan_id
]

);

const days=
plan.rows[0].duration_days;

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

user_id,

plan_id,

order_id,

days

]

);

await db.query(

`
UPDATE wallets

SET

coins=coins+$1

WHERE user_id=$2
`,

[

plan.rows[0].coins,

user_id

]

);

res.json({

success:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

/* ===========================
AUTO EXPIRE
=========================== */

router.post(
"/expire",
async(req,res)=>{

try{

await db.query(

`
UPDATE user_premium

SET status='Expired'

WHERE

status='Active'

AND expiry_date<NOW()
`

);

res.json({

success:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.post(

"/reading-stats",

async(req,res)=>{

try{

const{

user_id,

chapter_id,

reading_seconds,

words_read,

completed

}=req.body;

await db.query(

`
INSERT INTO premium_reading_stats
(
user_id,
chapter_id,
reading_seconds,
words_read,
completed
)
VALUES
($1,$2,$3,$4,$5)
`,

[
user_id,
chapter_id,
reading_seconds,
words_read,
completed
]

);

res.json({

success:true

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.get(

"/reading-stats/:userId",

async(req,res)=>{

try{

const userId=req.params.userId;

const premium=await db.query(

`
SELECT id

FROM user_premium

WHERE

user_id=$1

AND status='Active'

AND expiry_date>NOW()

LIMIT 1
`,

[userId]

);

if(!premium.rows.length){

return res.json({

premium:false

});

}

const stats=await db.query(

`
SELECT

COALESCE(
SUM(reading_seconds),0
) total_seconds,

COALESCE(
SUM(words_read),0
) total_words,

COUNT(
DISTINCT chapter_id
) total_chapters,

COUNT(
DISTINCT DATE(created_at)
) total_days,

COUNT(*) FILTER(
WHERE completed=true
) completed_chapters

FROM premium_reading_stats

WHERE user_id=$1
`,

[userId]

);

res.json({

premium:true,

totalHours:
(stats.rows[0].total_seconds/3600).toFixed(1),

totalWords:
stats.rows[0].total_words,

totalChapters:
stats.rows[0].total_chapters,

completed:
stats.rows[0].completed_chapters,

totalDays:
stats.rows[0].total_days

});

}catch(err){

console.log(err);

res.status(500).json({

premium:false

});

}

});

async function checkPremiumAchievements(user_id){

const stats=await db.query(

`
SELECT

COUNT(DISTINCT chapter_id) chapters,

COALESCE(SUM(words_read),0) words,

COALESCE(SUM(reading_seconds),0) seconds

FROM premium_reading_stats

WHERE user_id=$1
`,

[user_id]

);

const s=stats.rows[0];

if(Number(s.chapters)>=10){

await db.query(

`
INSERT INTO premium_achievements
(user_id,title,description,icon)

SELECT
$1,
'Book Explorer',
'Completed 10 chapters.',
'📚'

WHERE NOT EXISTS(

SELECT 1

FROM premium_achievements

WHERE

user_id=$1

AND title='Book Explorer'

)
`,

[user_id]

);

}

if(Number(s.words)>=50000){

await db.query(

`
INSERT INTO premium_achievements
(user_id,title,description,icon)

SELECT
$1,
'Word Master',
'Read 50,000 words.',
'📝'

WHERE NOT EXISTS(

SELECT 1

FROM premium_achievements

WHERE

user_id=$1

AND title='Word Master'

)
`,

[user_id]

);

}

if(Number(s.seconds)>=36000){

await db.query(

`
INSERT INTO premium_achievements
(user_id,title,description,icon)

SELECT
$1,
'Reading Legend',
'Read for 10 hours.',
'🏆'

WHERE NOT EXISTS(

SELECT 1

FROM premium_achievements

WHERE

user_id=$1

AND title='Reading Legend'

)
`,

[user_id]

);

}

}

router.get(

"/achievements/:userId",

async(req,res)=>{

try{

const result=await db.query(

`
SELECT *

FROM premium_achievements

WHERE user_id=$1

ORDER BY created_at DESC
`,

[
req.params.userId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

module.exports=router;