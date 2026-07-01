const express = require("express");

const router = express.Router();

const db = require("../db");

/* ==========================================
   GET ALL WITHDRAWALS
========================================== */

router.get(
"/withdrawals",
async(req,res)=>{

try{

const result=
await db.query(

`
SELECT

wr.id,

wr.writer_id,

wr.amount,

wr.status,

wr.remarks,

wr.requested_at,

wr.processed_at,

u.name AS writer_name,

COALESCE(
wp.payment_method,
wr.payment_method
) AS payment_method,

COALESCE(
wp.upi_id,
wr.upi_id
) AS upi_id,

COALESCE(
wp.account_name,
wr.account_name
) AS account_name,

COALESCE(
wp.bank_name,
''
) AS bank_name,

COALESCE(
wp.account_number,
wr.account_number
) AS account_number,

COALESCE(
wp.ifsc_code,
wr.ifsc_code
) AS ifsc_code

FROM withdrawal_requests wr

JOIN users u
ON wr.writer_id = u.id

LEFT JOIN writer_payment_details wp
ON wr.writer_id = wp.writer_id

ORDER BY wr.requested_at DESC;
`

);

res.json(

result.rows

);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

/* ==========================================
   APPROVE WITHDRAWAL
========================================== */

router.put(
"/withdrawals/:id/approve",
async(req,res)=>{

try{

await db.query(

`
UPDATE withdrawal_requests

SET

status='Approved',

processed_at=NOW()

WHERE id=$1
`,

[
req.params.id
]

);

res.json({

success:true,

message:"Withdrawal approved successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to approve."

});

}

});

/* ==========================================
   REJECT WITHDRAWAL
========================================== */

router.put(
"/withdrawals/:id/reject",
async(req,res)=>{

try{

const{
remarks
}=req.body;

await db.query(

`
UPDATE withdrawal_requests

SET

status='Rejected',

remarks=$2,

processed_at=NOW()

WHERE id=$1
`,

[
req.params.id,
remarks
]

);

res.json({

success:true,

message:"Withdrawal rejected."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to reject."

});

}

});

module.exports = router;