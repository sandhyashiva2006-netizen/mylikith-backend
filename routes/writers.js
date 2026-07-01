const express = require("express");
const db = require("../db");

const router = express.Router();

router.post("/novels", async (req, res) => {

try {

const {
author_id,
title,
description,
language,
category
} = req.body;

const result =
await db.query(

`
INSERT INTO novels
(
author_id,
title,
description,
language,
category
)

VALUES
($1,$2,$3,$4,$5)

RETURNING *
`,

[
author_id,
title,
description,
language,
category
]

);

res.json({
success:true,
novel:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/my-novels/:authorId",
async(req,res)=>{

try{

const result=await db.query(

`
SELECT

n.*,

COALESCE(ch.total_chapters,0) AS chapters,

COALESCE(l.total_likes,0) AS likes

FROM novels n

LEFT JOIN(

SELECT

novel_id,

COUNT(*) AS total_chapters

FROM chapters

GROUP BY novel_id

) ch

ON n.id=ch.novel_id

LEFT JOIN(

SELECT

c.novel_id,

COUNT(cl.id) AS total_likes

FROM chapters c

LEFT JOIN chapter_likes cl

ON c.id=cl.chapter_id

GROUP BY c.novel_id

) l

ON n.id=l.novel_id

WHERE n.author_id=$1

ORDER BY n.id DESC
`,

[
req.params.authorId
]

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.delete(
"/novels/:id",
async (req,res)=>{

try{

await db.query(

`
DELETE FROM novels
WHERE id=$1
`,

[
req.params.id
]

);

res.json({
success:true
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post(
"/chapters",
async (req,res)=>{

try{

const {
novel_id,
chapter_no,
title,
content
} = req.body;

const result =
await db.query(

`
INSERT INTO chapters
(
novel_id,
chapter_no,
title,
content
)

VALUES
($1,$2,$3,$4)

RETURNING *
`,

[
novel_id,
chapter_no,
title,
content
]

);

res.json({
success:true,
chapter:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.put(
"/novels/:id",
async (req,res)=>{

try{

const {
title,
description,
language,
category
} = req.body;

const result =
await db.query(

`
UPDATE novels

SET

title=$1,
description=$2,
language=$3,
category=$4

WHERE id=$5

RETURNING *
`,

[
title,
description,
language,
category,
req.params.id
]

);

res.json({
success:true,
novel:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/chapters/:novelId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT
    c.*,
    COALESCE(l.likes,0) AS likes
FROM chapters c
LEFT JOIN (
    SELECT
        chapter_id,
        COUNT(*) AS likes
    FROM chapter_likes
    GROUP BY chapter_id
) l
ON c.id=l.chapter_id
WHERE c.novel_id=$1
ORDER BY c.chapter_no;
`,

[
req.params.novelId
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.delete(
"/chapters/:id",
async (req,res)=>{

try{

const chapterId = req.params.id;

await db.query(
`DELETE FROM comments WHERE chapter_id=$1`,
[chapterId]
);

await db.query(
`DELETE FROM bookmarks WHERE chapter_id=$1`,
[chapterId]
);

await db.query(
`DELETE FROM reading_progress WHERE chapter_id=$1`,
[chapterId]
);

await db.query(
`DELETE FROM reading_history WHERE chapter_id=$1`,
[chapterId]
);

await db.query(
`DELETE FROM chapters WHERE id=$1`,
[chapterId]
);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.put(
"/chapters/:id",
async (req,res)=>{

try{

const {

title,
content,
is_premium,
coins_required

} = req.body;

const result =
await db.query(

`
UPDATE chapters

SET

title=$1,
content=$2,
is_premium=$3,
coins_required=$4

WHERE id=$5

RETURNING *
`,

[

title,
content,
is_premium,
coins_required,
req.params.id

]

);

res.json({

success:true,
chapter:result.rows[0]

});

}
catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});


router.post(
"/bookmark",
async (req,res)=>{

try{

const {
user_id,
chapter_id
} = req.body;

const result =
await db.query(

`
INSERT INTO bookmarks
(
user_id,
chapter_id
)

VALUES
($1,$2)

RETURNING *
`,

[
user_id,
chapter_id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/bookmarks/:userId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT
b.id,
c.title,
c.chapter_no

FROM bookmarks b

JOIN chapters c

ON b.chapter_id = c.id

WHERE b.user_id=$1

ORDER BY b.id DESC
`,

[
req.params.userId
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post(
"/reading-progress",
async (req,res)=>{

try{

const {
user_id,
chapter_id
} = req.body;

await db.query(

`
DELETE FROM reading_progress
WHERE user_id=$1
`,

[user_id]

);

await db.query(

`
INSERT INTO reading_progress
(
user_id,
chapter_id
)

VALUES
($1,$2)
`,

[
user_id,
chapter_id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/reading-progress/:userId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT

c.id,
c.title,
c.chapter_no

FROM reading_progress rp

JOIN chapters c

ON rp.chapter_id=c.id

WHERE rp.user_id=$1

LIMIT 1
`,

[
req.params.userId
]

);

res.json(
result.rows[0]
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post(
"/reading-history",
async (req,res)=>{

try{

const {
user_id,
novel_id,
chapter_id
} = req.body;

await db.query(

`
INSERT INTO reading_history
(
user_id,
novel_id,
chapter_id
)

VALUES
($1,$2,$3)
`,

[
user_id,
novel_id,
chapter_id
]

);

res.json({
success:true
});

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.get(
"/reading-history/:userId",
async (req,res)=>{

try{

const result =
await db.query(

`
SELECT

c.id,
c.title,
c.chapter_no

FROM reading_history rh

JOIN chapters c

ON rh.chapter_id=c.id

WHERE rh.user_id=$1

ORDER BY rh.id DESC

LIMIT 10
`,

[
req.params.userId
]

);

res.json(
result.rows
);

}
catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.delete(
"/bookmark/:id",
async(req,res)=>{

try{

await db.query(

`DELETE FROM bookmarks WHERE id=$1`,

[req.params.id]

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
"/notifications/:userId",
async(req,res)=>{

try{

const result=

await db.query(

`
SELECT
title,
created_at

FROM notifications

WHERE user_id=$1

ORDER BY id DESC

LIMIT 20
`,

[
req.params.userId
]

);

res.json(

result.rows

);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.get(
"/earnings/:writerId",
async(req,res)=>{

try{

const writerId=req.params.writerId;

/* ===========================
   TOTAL EARNINGS
=========================== */

const earnings=
await db.query(

`
SELECT

COALESCE(SUM(amount),0) total_earnings,

COALESCE(SUM(coins),0) total_coins

FROM writer_earnings

WHERE writer_id=$1
`,

[
writerId
]

);

/* ===========================
   PENDING WITHDRAWALS
=========================== */

const pending=
await db.query(

`
SELECT

COALESCE(SUM(amount),0) pending

FROM withdrawal_requests

WHERE

writer_id=$1

AND

status='Pending'
`,

[
writerId
]

);

/* ===========================
   PAID WITHDRAWALS
=========================== */

const paid=
await db.query(

`
SELECT

COALESCE(SUM(amount),0) paid

FROM withdrawal_requests

WHERE

writer_id=$1

AND

status IN
(
'Approved',
'Completed'
)
`,

[
writerId
]

);

/* ===========================
   RECENT EARNINGS
=========================== */

const history=
await db.query(

`
SELECT

u.name,

n.title AS novel,

c.chapter_no,

w.coins,

w.amount,

w.created_at

FROM writer_earnings w

JOIN users u
ON w.user_id=u.id

JOIN novels n
ON w.novel_id=n.id

JOIN chapters c
ON w.chapter_id=c.id

WHERE w.writer_id=$1

ORDER BY w.id DESC

LIMIT 50
`,

[
writerId
]

);

const total=
Number(
earnings.rows[0].total_earnings
);

const pendingAmount=
Number(
pending.rows[0].pending
);

const paidAmount=
Number(
paid.rows[0].paid
);

const withdrawable=

total-

pendingAmount-

paidAmount;

res.json({

summary:{

coins:
Number(
earnings.rows[0].total_coins
),

amount:total,

withdrawable:
withdrawable,

pending:
pendingAmount,

paid:
paidAmount

},

history:
history.rows

});

}
catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});


router.get(
"/payment-details/:writerId",
async(req,res)=>{

try{

const result=
await db.query(

`
SELECT *

FROM writer_payment_details

WHERE writer_id=$1
`,

[
req.params.writerId
]

);

if(result.rows.length===0){

return res.json({

success:false

});

}

res.json({

success:true,

details:result.rows[0]

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.post(
"/payment-details",
async(req,res)=>{

try{

const{

writer_id,
payment_method,
upi_id,
account_name,
bank_name,
account_number,
ifsc_code

}=req.body;

await db.query(

`
INSERT INTO writer_payment_details
(

writer_id,

payment_method,

upi_id,

account_name,

bank_name,

account_number,

ifsc_code

)

VALUES
(

$1,$2,$3,$4,$5,$6,$7

)

ON CONFLICT(writer_id)

DO UPDATE SET

payment_method=EXCLUDED.payment_method,

upi_id=EXCLUDED.upi_id,

account_name=EXCLUDED.account_name,

bank_name=EXCLUDED.bank_name,

account_number=EXCLUDED.account_number,

ifsc_code=EXCLUDED.ifsc_code
`,

[

writer_id,
payment_method,
upi_id,
account_name,
bank_name,
account_number,
ifsc_code

]

);

res.json({

success:true,

message:"Payment details saved."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to save."

});

}

});

router.post(
"/withdraw",
async(req,res)=>{

console.log(req.body);

try{

const{

writer_id,
amount

}=req.body;

const settings=
await db.query(

`
SELECT *

FROM platform_settings

LIMIT 1
`

);

const minimum=
Number(
settings.rows[0].minimum_withdrawal
);

if(Number(amount) < minimum){

return res.json({

success:false,

message:
`Minimum withdrawal is ₹${minimum}`

});

}

const payment=
await db.query(

`
SELECT *

FROM writer_payment_details

WHERE writer_id=$1
`,

[
writer_id
]

);

if(payment.rows.length===0){

return res.json({

success:false,

message:
"Please save payment details first."

});

}

const existing =
await db.query(
`
SELECT id
FROM withdrawal_requests
WHERE writer_id=$1
AND status='Pending'
LIMIT 1
`,
[
writer_id
]
);

if(existing.rows.length){

return res.json({

success:false,

message:"You already have a pending withdrawal request."

});

}

const earnings =
await db.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM writer_earnings
WHERE writer_id=$1
`,
[
writer_id
]
);

const pending =
await db.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM withdrawal_requests
WHERE writer_id=$1
AND status='Pending'
`,
[
writer_id
]
);

const approved =
await db.query(
`
SELECT
COALESCE(SUM(amount),0) total
FROM withdrawal_requests
WHERE writer_id=$1
AND status IN('Approved','Completed')
`,
[
writer_id
]
);

const withdrawable =

Number(earnings.rows[0].total)

-

Number(pending.rows[0].total)

-

Number(approved.rows[0].total);

if(withdrawable <= 0){

return res.json({

success:false,

message:"No withdrawable balance available."

});

}

if(amount > withdrawable){

return res.json({

success:false,

message:`Only ₹${withdrawable.toFixed(2)} is available to withdraw.`

});

}

await db.query(

`
INSERT INTO withdrawal_requests
(

writer_id,

amount,

payment_method,

account_name,

account_number,

ifsc_code,

upi_id,

status

)

VALUES
(

$1,$2,$3,$4,$5,$6,$7,'Pending'

)
`,

[

writer_id,

amount,

payment.rows[0].payment_method,

payment.rows[0].account_name,

payment.rows[0].account_number,

payment.rows[0].ifsc_code,

payment.rows[0].upi_id

]

);

res.json({

success:true,

message:"Withdrawal request submitted successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:
"Unable to submit request."

});

}

});

router.get(
"/withdraw-history/:writerId",
async(req,res)=>{

try{

const result=
await db.query(

`
SELECT *

FROM withdrawal_requests

WHERE writer_id=$1

ORDER BY id DESC
`,

[
req.params.writerId
]

);

res.json(

result.rows

);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});


module.exports = router;