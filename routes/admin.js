const express = require("express");

const router = express.Router();

const db = require("../db");

const{

createNotification

}=require("./writers");

const auth = require("../middleware/auth");

router.use(auth);

router.use((req,res,next)=>{

    if(req.user.role!=="admin"){

        return res.status(403).json({

            success:false,
            message:"Admin access required."

        });

    }

    next();

});

/* ==========================================
   GET WRITER APPLICATIONS
========================================== */

router.get(
"/writer-applications",
async(req,res)=>{

try{

const result=await db.query(

`
SELECT

wp.*,

u.name,

u.email

FROM writer_profiles wp

JOIN users u

ON wp.user_id=u.id

ORDER BY wp.created_at DESC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

/* ==========================================
   APPROVE WRITER APPLICATION
========================================== */

router.put(
"/writer-applications/:id/approve",
async(req,res)=>{

try{

const application=await db.query(

`
SELECT *

FROM writer_profiles

WHERE id=$1
`,

[
req.params.id
]

);

if(!application.rows.length){

return res.status(404).json({

success:false,

message:"Application not found."

});

}

const writer=application.rows[0];

await db.query(

`
UPDATE writer_profiles

SET

status='Approved',

approved_at=NOW(),

approved_by=1,

first_novel_approved=false

WHERE id=$1
`,

[
req.params.id
]

);

const writerData=await db.query(

`
SELECT user_id

FROM writer_profiles

WHERE id=$1
`,

[
req.params.id
]

);

await createNotification(

writerData.rows[0].user_id,

"✅ Writer Application Approved",

"Congratulations! Your writer application has been approved. You can now publish novels.",

"writer",

req.params.id

);

await db.query(

`
UPDATE users

SET

role='writer'

WHERE id=$1
`,

[
writerData.rows[0].user_id
]

);

res.json({

success:true,

message:"Writer approved successfully."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false,

message:"Unable to approve writer."

});

}

});

/* ==========================================
   REJECT WRITER
========================================== */

router.put(
"/writer-applications/:id/reject",
async(req,res)=>{

try{

await db.query(

`
UPDATE writer_profiles

SET

status='Rejected'

WHERE id=$1
`,

[
req.params.id
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

/* ==========================================
   GET NOVELS PENDING APPROVAL
========================================== */

router.get(
"/novel-approvals",
async(req,res)=>{

try{

const result=await db.query(

`
SELECT

n.*,

u.name

FROM novels n

JOIN users u

ON n.author_id=u.id

WHERE

LOWER(n.approval_status)='pending'

ORDER BY n.created_at ASC
`

);

res.json(result.rows);

}catch(err){

console.log(err);

res.status(500).json([]);

}

});

/* ==========================================
   APPROVE NOVEL
========================================== */

router.put(
"/novel-approvals/:id/approve",
async(req,res)=>{

try{

const novel=await db.query(

`
SELECT *

FROM novels

WHERE id=$1
`,

[
req.params.id
]

);

if(!novel.rows.length){

return res.status(404).json({

success:false

});

}

await db.query(

`
UPDATE novels

SET

approval_status='Approved',

publish_status='Published',

published_at=NOW()

WHERE id=$1
`,

[
req.params.id
]

);

const novelData=await db.query(

`
SELECT

author_id,
title

FROM novels

WHERE id=$1
`,

[
req.params.id
]

);

await createNotification(

novelData.rows[0].author_id,

"📚 Novel Approved",

`Congratulations! Your novel "${novelData.rows[0].title}" has been approved and is now available to readers.`,

"novel",

req.params.id

);

await db.query(

`
UPDATE writer_profiles

SET

first_novel_approved=true

WHERE user_id=$1
`,

[
novelData.rows[0].author_id
]

);

res.json({

success:true,

message:"Novel approved."

});

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

/* ==========================================
   REJECT NOVEL
========================================== */

router.put(
"/novel-approvals/:id/reject",
async(req,res)=>{

try{

await db.query(

`
UPDATE novels

SET

approval_status='Rejected',

publish_status='Draft'

WHERE id=$1
`,

[
req.params.id
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

/* ==========================================
   GET ALL SITE PAGES
========================================== */

router.get("/pages", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT *
            FROM site_pages
            ORDER BY title
        `);

        res.json(result.rows);

    } catch (err) {

        console.log(err);

        res.status(500).json([]);

    }

});

/* ==========================================
   GET SITE PAGE
========================================== */

router.get("/pages/:slug", async (req, res) => {

    try {

        const result = await db.query(

            `
            SELECT *
            FROM site_pages
            WHERE slug=$1
            `,

            [req.params.slug]

        );

        if (!result.rows.length) {

            return res.status(404).json({
                success: false
            });

        }

        res.json(result.rows[0]);

    } catch (err) {

        console.log(err);

        res.status(500).json({
            success: false
        });

    }

});

/* ==========================================
   UPDATE SITE PAGE
========================================== */

router.put("/pages/:slug", async (req, res) => {

    try {

        const {
            title,
            content
        } = req.body;

        await db.query(

            `
            UPDATE site_pages

            SET

            title=$1,
            content=$2,
            updated_at=NOW()

            WHERE slug=$3
            `,

            [
                title,
                content,
                req.params.slug
            ]

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


module.exports = router;