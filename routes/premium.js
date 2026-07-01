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

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

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

router.post(
"/create-order",
async(req,res)=>{

try{

const{

user_id,

plan_id

}=req.body;

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

return res.json({

success:false,

message:"Plan not found."

});

}

const orderId=

`PRE_${Date.now()}`;

const axios=require("axios");

const response=

await axios.post(

"https://sandbox.cashfree.com/pg/orders",

{

order_id:orderId,

order_amount:Number(plan.rows[0].price),

order_currency:"INR",

customer_details:{

customer_id:String(user_id),

customer_name:"Reader",

customer_email:"reader@mylikith.com",

customer_phone:"9999999999"

}

},

{

headers:{

"x-client-id":

process.env.CASHFREE_APP_ID,

"x-client-secret":

process.env.CASHFREE_SECRET_KEY,

"x-api-version":"2023-08-01"

}

}

);

res.json({

success:true,

orderId,

planId:plan_id,

paymentSessionId:

response.data.payment_session_id

});

}catch(err){

console.log(err.response?.data||err);

res.status(500).json({

success:false,

message:"Unable to create order."

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

return res.json({

success:false,

message:"Plan not found."

});

}

const orderId=

`PRE_${Date.now()}`;

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

return_url:`https://mylikith-frontend.pages.dev/premium-success.html?order_id={order_id}&plan_id=${plan_id}`

}

};

console.log(orderPayload);

const response=await axios.post(

"https://sandbox.cashfree.com/pg/orders",

orderPayload,

{

headers:{

"x-client-id":process.env.CASHFREE_APP_ID,

"x-client-secret":process.env.CASHFREE_SECRET_KEY,

"x-api-version":"2025-01-01",

"Content-Type":"application/json"

}

}

);

res.json({

success:true,

paymentSessionId:

response.data.payment_session_id,

orderId

});

}catch(err){

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

module.exports=router;