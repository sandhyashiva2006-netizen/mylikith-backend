const express = require("express");
const db = require("../db");

const router = express.Router();

/* ==========================================
   APPLY FOR WRITER
========================================== */

router.post("/apply", async (req,res)=>{

try{

const{

user_id,
pen_name,
bio,
experience

}=req.body;

const existing=await db.query(

`
SELECT id
FROM writer_profiles
WHERE user_id=$1
`,

[user_id]

);

if(existing.rows.length){

return res.json({

success:false,

message:"Application already submitted."

});

}

await db.query(

`
INSERT INTO writer_profiles
(

user_id,

pen_name,

bio,

experience,

agreement,

agreement_accepted_at

)

VALUES

($1,$2,$3,$4,true,NOW())
`,

[
user_id,
pen_name,
bio,
experience
]

);

res.json({

success:true,

message:"Application submitted successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

/* ==========================================
   WRITER APPLICATION STATUS
========================================== */

router.get(
"/application/:userId",
async(req,res)=>{

try{

const result=

await db.query(

`
SELECT *

FROM writer_profiles

WHERE user_id=$1
`,

[
req.params.userId
]

);

if(result.rows.length===0){

return res.json({

exists:false

});

}

res.json({

exists:true,

application:result.rows[0]

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

router.post("/novels", async (req, res) => {

try {

const {

author_id,
title,
description,
language,
category,
cover_url

} = req.body;

/* ==========================================
   CHECK WRITER STATUS
========================================== */

const writer = await db.query(

`
SELECT *

FROM writer_profiles

WHERE user_id=$1
`,

[
author_id
]

);

if(!writer.rows.length){

return res.status(403).json({

success:false,

message:"You are not an approved writer."

});

}

if(writer.rows[0].status.toLowerCase()!=="approved"){

return res.status(403).json({

success:false,

message:"Your writer application is still under review."

});

}

/* ==========================================
   FIRST NOVEL APPROVAL
========================================== */

let publishStatus="draft";

let approvalStatus="Pending";

if(writer.rows[0].first_novel_approved){

publishStatus="published";

approvalStatus="Approved";

}

/* ==========================================
   CREATE NOVEL
========================================== */

const result=await db.query(

`
INSERT INTO novels
(
author_id,
title,
description,
cover_url,
language,
category,
story_status,
publish_status,
approval_status
)

VALUES
(
$1,
$2,
$3,
$4,
$5,
$6,
'Ongoing',
$7,
$8
)

RETURNING *;
`,

[
author_id,
title,
description,
cover_url,
language,
category,
publishStatus,
approvalStatus
]

);

res.json({

success:true,

novel:result.rows[0]

});

}catch(err){

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

const{

novel_id,
chapter_no,
title,
content,
is_premium=false,
coins_required=0,
early_access=false,
is_draft=false

}=req.body;

const result =
await db.query(

`
INSERT INTO chapters(
novel_id,
chapter_no,
title,
content,
is_premium,
coins_required,
early_access,
is_draft
)
VALUES(
$1,$2,$3,$4,$5,$6,$7,$8
)

RETURNING *
`,

[
novel_id,
chapter_no,
title,
content,
is_premium,
coins_required,
early_access,
true
]

);

const novel=await db.query(

`
SELECT

title,
author_id

FROM novels

WHERE id=$1
`,

[
novel_id
]

);

if(!is_draft){

const followers=await db.query(

`
SELECT user_id
FROM follows
WHERE author_id=$1
`,

[
novel.rows[0].author_id
]

);

for(const follower of followers.rows){

await db.query(

`
INSERT INTO reader_feed(

user_id,

novel_id,

chapter_id,

title,

message

)

VALUES($1,$2,$3,$4,$5)
`,

[
follower.user_id,
novel_id,
result.rows[0].id,
title,
`${novel.rows[0].title} has a new chapter.`
]

);

await db.query(

`
INSERT INTO reader_notifications(

user_id,

title,

message,

type,

reference_id

)

VALUES($1,$2,$3,$4,$5)
`,

[
follower.user_id,
"New Chapter",
`${novel.rows[0].title} has published a new chapter.`,
"chapter",
result.rows[0].id
]

);

}

}

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
category,
status,
cover_url
} = req.body;

const result =
await db.query(

`
UPDATE novels

SET

title=COALESCE($1,title),
description=COALESCE($2,description),
language=COALESCE($3,language),
category=COALESCE($4,category),
status=COALESCE($5,status),
cover_url=COALESCE($6,cover_url)

WHERE id=$7

RETURNING *
`,

[
title,
description,
language,
category,
status,
cover_url,
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
WHERE

c.novel_id=$1

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
`
DELETE FROM chapter_likes
WHERE chapter_id=$1
`,
[
chapterId
]
);

await db.query(
`
DELETE FROM reader_feed
WHERE chapter_id=$1
`,
[
chapterId
]
);

await db.query(
`
DELETE FROM reader_notifications
WHERE reference_id=$1
AND type='chapter'
`,
[
chapterId
]
);

await db.query(
`
DELETE FROM writer_earnings
WHERE chapter_id=$1
`,
[
chapterId
]
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

router.put("/chapters/:id/move", async (req, res) => {

    try {

        const { direction } = req.body;

        const current = await db.query(
            "SELECT id, novel_id, chapter_no FROM chapters WHERE id=$1",
            [req.params.id]
        );

        if (!current.rows.length) {

            return res.status(404).json({
                success: false
            });

        }

        const chapter = current.rows[0];

        const swap = await db.query(

            `
            SELECT id, chapter_no
            FROM chapters

            WHERE novel_id=$1

            AND chapter_no=$2
            `,

            [
                chapter.novel_id,
                direction === "up"
                    ? chapter.chapter_no - 1
                    : chapter.chapter_no + 1
            ]

        );

        if (!swap.rows.length) {

            return res.json({
                success: true
            });

        }

        await db.query(
            "UPDATE chapters SET chapter_no=$1 WHERE id=$2",
            [swap.rows[0].chapter_no, chapter.id]
        );

        await db.query(
            "UPDATE chapters SET chapter_no=$1 WHERE id=$2",
            [chapter.chapter_no, swap.rows[0].id]
        );

        res.json({
            success: true
        });

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

router.post("/chapters/:id/duplicate", async (req,res)=>{

try{

const chapter=await db.query(

`
SELECT *
FROM chapters
WHERE id=$1
`,

[req.params.id]

);

if(!chapter.rows.length){

return res.json({
success:false
});

}

const ch=chapter.rows[0];

const next=await db.query(

`
SELECT
COALESCE(MAX(chapter_no),0)+1 next
FROM chapters
WHERE novel_id=$1
`,

[ch.novel_id]

);

const chapterNo=next.rows[0].next;

await db.query(

`
INSERT INTO chapters
(

novel_id,
chapter_no,
title,
content,
is_draft,
is_premium,
coins_required,
early_access

)

VALUES

($1,$2,$3,$4,$5,$6,$7,$8)
`,

[
ch.novel_id,
chapterNo,
ch.title+" (Copy)",
ch.content,
true,
ch.is_premium,
ch.coins_required,
ch.early_access
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

async function duplicateChapter(id){

const response=await fetch(

`${API}/api/writers/chapters/${id}/duplicate`,

{

method:"POST"

}

);

const data=await response.json();

if(data.success){

loadChapters();

}else{

alert("Unable to duplicate chapter.");

}

}

router.put(
"/chapters/:id",
async (req,res)=>{

try{

const{

title,
content,
is_premium,
coins_required,
early_access,
is_scheduled=false,
publish_at=null

}=req.body;

const result =
await db.query(

`
UPDATE chapters

SET

title=$1,
content=$2,
is_premium=$3,
coins_required=$4,
early_access=$5,
is_scheduled=$6,
publish_at=$7

WHERE id=$8

RETURNING *
`,

[
title,
content,
is_premium,
coins_required,
early_access,
is_scheduled,
publish_at,
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

async function publishChapter(chapterId){

const chapter=await db.query(

`
SELECT

c.*,

n.title AS novel_title,

n.author_id

FROM chapters c

JOIN novels n
ON c.novel_id=n.id

WHERE c.id=$1
`,

[
chapterId
]

);

if(!chapter.rows.length){

return false;

}

await db.query(

`
UPDATE chapters

SET

is_draft=false,
is_scheduled=false,
publish_at=NULL

WHERE id=$1
`,

[
chapterId
]

);

const followers=await db.query(

`
SELECT user_id

FROM follows

WHERE author_id=$1
`,

[
chapter.rows[0].author_id
]

);

for(const follower of followers.rows){

await db.query(

`
INSERT INTO reader_feed(

user_id,
novel_id,
chapter_id,
title,
message

)

VALUES($1,$2,$3,$4,$5)
`,

[
follower.user_id,
chapter.rows[0].novel_id,
chapterId,
chapter.rows[0].title,
`${chapter.rows[0].novel_title} has a new chapter.`
]

);

await db.query(

`
INSERT INTO reader_notifications(

user_id,
title,
message,
type,
reference_id

)

VALUES($1,$2,$3,$4,$5)
`,

[
follower.user_id,
"New Chapter",
`${chapter.rows[0].novel_title} has published a new chapter.`,
"chapter",
chapterId
]

);

}

return true;

}

router.put(
"/chapters/:id/publish",
async(req,res)=>{

try{

const ok=await publishChapter(req.params.id);

res.json({

success:ok

});

}catch(err){

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

await db.query(

`
INSERT INTO reader_activity(

user_id,

activity_type,

title,

reference_id

)

VALUES($1,$2,$3,$4)
`,

[
user_id,
"bookmark",
"Bookmarked a chapter",
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

const{

user_id,

chapter_id,

progress

}=req.body;

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

chapter_id,

progress_percent,

updated_at

)

VALUES

($1,$2,$3,NOW())
`,

[
user_id,
chapter_id,
progress
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
module.exports.publishChapter = publishChapter;