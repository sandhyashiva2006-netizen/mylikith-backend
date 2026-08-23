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

/*
=========================================================
ADMIN AUDIO NOVELS
GET /api/admin/audio/novels
=========================================================
*/

router.get(
    "/audio/novels",
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT
                        an.id,
                        an.title,
                        an.description,
                        an.cover_url,
                        an.language,
                        an.category,
                        an.categories,
                        an.content_type,
                        an.status,
                        an.publish_status,
                        an.visibility,
                        an.premium_only,
                        an.featured,
                        an.views,
                        an.likes,
                        an.rating,
                        an.rating_count,
                        an.release_date,
                        an.created_by,
                        an.created_at,
                        an.updated_at,

                        u.name AS writer_name,
                        u.profile_image AS writer_profile_image

                    FROM audio_novels an

                    LEFT JOIN users u
                        ON u.id = an.created_by

                    ORDER BY
                        an.created_at DESC
                `);


            return res.json({

                success: true,

                audio:
                    result.rows

            });


        } catch (error) {

            console.error(
                "GET /api/admin/audio/novels error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load admin audio novels."
            });

        }

    }
);

/*
=========================================================
ADMIN AUDIO CHAPTERS
GET /api/admin/audio/chapters
=========================================================
*/

router.get(
    "/audio/chapters",
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT
                        ac.id,
                        ac.audio_novel_id,
                        ac.chapter_no,
                        ac.title,

                        ac.audio_provider,
                        ac.audio_mime_type,
                        ac.audio_size_bytes,
                        ac.audio_duration_seconds,
                        ac.audio_status,

                        ac.is_premium,
                        ac.coins_required,
                        ac.early_access,

                        ac.is_draft,
                        ac.is_published,
                        ac.publish_at,

                        ac.views,
                        ac.likes,
                        ac.rating,
                        ac.rating_count,

                        ac.created_at,
                        ac.updated_at,

                        an.title AS audio_novel_title,
                        an.cover_url AS audio_novel_cover_url

                    FROM audio_chapters ac

                    JOIN audio_novels an
                        ON an.id = ac.audio_novel_id

                    ORDER BY
                        an.title ASC,
                        ac.chapter_no ASC
                `);


            return res.json({

                success: true,

                chapters:
                    result.rows

            });


        } catch (error) {

            console.error(
                "GET /api/admin/audio/chapters error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to load admin audio chapters."

            });

        }

    }
);

/*
=========================================================
ADMIN AUDIO COMMENTS
GET /api/admin/audio/comments
=========================================================
*/

router.get(
    "/audio/comments",
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT
                        acc.id,
                        acc.chapter_id,
                        acc.user_id,
                        acc.comment,
                        acc.created_at,
                        acc.updated_at,

                        ac.chapter_no,
                        ac.title AS chapter_title,
                        ac.audio_novel_id,

                        an.title AS audio_novel_title,

                        u.name AS user_name,
                        u.profile_image

                    FROM audio_chapter_comments acc

                    JOIN audio_chapters ac
                        ON ac.id = acc.chapter_id

                    JOIN audio_novels an
                        ON an.id = ac.audio_novel_id

                    JOIN users u
                        ON u.id = acc.user_id

                    ORDER BY
                        acc.created_at DESC
                `);

            return res.json({
                success: true,
                comments: result.rows
            });

        } catch (error) {

            console.error(
                "GET /api/admin/audio/comments error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to load admin audio comments."
            });

        }

    }
);

/*
=========================================================
ADMIN DELETE AUDIO COMMENT
DELETE /api/admin/audio/comments/:commentId
=========================================================
*/

router.delete(
    "/audio/comments/:commentId",
    async (req, res) => {

        try {

            const commentId =
                Number(req.params.commentId);

            if(
                !Number.isInteger(commentId) ||
                commentId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message: "Invalid comment ID."
                });

            }

            const result =
                await db.query(`
                    DELETE FROM audio_chapter_comments
                    WHERE id = $1
                    RETURNING id
                `, [
                    commentId
                ]);

            if(!result.rows.length){

                return res.status(404).json({
                    success: false,
                    message: "Audio comment not found."
                });

            }

            return res.json({
                success: true,
                message:
                    "Audio comment deleted successfully."
            });

        } catch(error) {

            console.error(
                "DELETE /api/admin/audio/comments error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Failed to delete audio comment."
            });

        }

    }
);

/*
=========================================================
ADMIN AUDIO REPORTS
GET /api/admin/audio/reports
=========================================================
*/

router.get(
    "/audio/reports",
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT *
                    FROM (

                        /* ---------------------------------
                           AUDIO NOVEL COMMENT REPORTS
                        --------------------------------- */

                        SELECT
                            acr.id AS report_id,

                            'audio_comment'
                                AS report_type,

                            acr.comment_id,

                            acr.reporter_user_id,

                            acr.reason,

                            acr.status,

                            acr.reviewed_by,

                            acr.reviewed_at,

                            acr.created_at,

                            ac.comment,

                            NULL::bigint
                                AS chapter_id,

                            NULL::integer
                                AS chapter_no,

                            NULL::text
                                AS chapter_title,

                            an.id
                                AS audio_novel_id,

                            an.title
                                AS audio_novel_title,

                            reporter.name
                                AS reporter_name,

                            reporter.profile_image
                                AS reporter_profile_image,

                            commenter.name
                                AS commenter_name

                        FROM audio_comment_reports acr

                        JOIN audio_comments ac
                            ON ac.id = acr.comment_id

                        JOIN audio_novels an
                            ON an.id = ac.audio_novel_id

                        JOIN users reporter
                            ON reporter.id =
                                acr.reporter_user_id

                        JOIN users commenter
                            ON commenter.id =
                                ac.user_id


                        UNION ALL


                        /* ---------------------------------
                           AUDIO CHAPTER COMMENT REPORTS
                        --------------------------------- */

                        SELECT
                            accr.id AS report_id,

                            'audio_chapter_comment'
                                AS report_type,

                            accr.comment_id,

                            accr.reporter_user_id,

                            accr.reason,

                            accr.status,

                            accr.reviewed_by,

                            accr.reviewed_at,

                            accr.created_at,

                            acc.comment,

                            ch.id
                                AS chapter_id,

                            ch.chapter_no,

                            ch.title
                                AS chapter_title,

                            an.id
                                AS audio_novel_id,

                            an.title
                                AS audio_novel_title,

                            reporter.name
                                AS reporter_name,

                            reporter.profile_image
                                AS reporter_profile_image,

                            commenter.name
                                AS commenter_name

                        FROM audio_chapter_comment_reports accr

                        JOIN audio_chapter_comments acc
                            ON acc.id =
                                accr.comment_id

                        JOIN audio_chapters ch
                            ON ch.id =
                                acc.chapter_id

                        JOIN audio_novels an
                            ON an.id =
                                ch.audio_novel_id

                        JOIN users reporter
                            ON reporter.id =
                                accr.reporter_user_id

                        JOIN users commenter
                            ON commenter.id =
                                acc.user_id

                    ) reports

                    ORDER BY
                        CASE
                            WHEN LOWER(
                                COALESCE(
                                    reports.status,
                                    'pending'
                                )
                            ) = 'pending'
                            THEN 0
                            ELSE 1
                        END,

                        reports.created_at DESC
                `);


            return res.json({

                success: true,

                reports:
                    result.rows

            });


        } catch (error) {

            console.error(
                "GET /api/admin/audio/reports error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to load audio reports."

            });

        }

    }
);

/*
=========================================================
ADMIN UPDATE AUDIO REPORT
PATCH /api/admin/audio/reports/:reportType/:reportId
=========================================================
*/

router.patch(
    "/audio/reports/:reportType/:reportId",
    async (req, res) => {

        try {

            const reportType =
                String(
                    req.params.reportType ||
                    ""
                );

            const reportId =
                Number(
                    req.params.reportId
                );

            const status =
                String(
                    req.body.status ||
                    ""
                )
                .trim()
                .toLowerCase();


            if(
                !Number.isInteger(reportId) ||
                reportId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid report ID."
                });

            }


            if(
                ![
                    "resolved",
                    "rejected"
                ].includes(status)
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid report status."
                });

            }


            let table;


            if(
                reportType ===
                "audio_comment"
            ){

                table =
                    "audio_comment_reports";

            }else if(
                reportType ===
                "audio_chapter_comment"
            ){

                table =
                    "audio_chapter_comment_reports";

            }else{

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid report type."
                });

            }


            const result =
                await db.query(
                    `
                    UPDATE ${table}

                    SET
                        status = $1,
                        reviewed_by = $2,
                        reviewed_at = NOW()

                    WHERE id = $3

                    RETURNING
                        id,
                        status,
                        reviewed_by,
                        reviewed_at
                    `,
                    [
                        status,
                        req.user.id,
                        reportId
                    ]
                );


            if(
                !result.rows.length
            ){

                return res.status(404).json({
                    success: false,
                    message:
                        "Report not found."
                });

            }


            return res.json({

                success: true,

                report:
                    result.rows[0]

            });


        } catch(error) {

            console.error(
                "PATCH /api/admin/audio/reports error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Failed to update audio report."

            });

        }

    }
);

/*
=========================================================
ADMIN CREATE AUDIO NOVEL
POST /api/admin/audio/novels
=========================================================
*/

router.post(
    "/audio/novels",
    async (req, res) => {

        try {

            const {
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                publish_status,
                visibility,
                premium_only,
                featured,
                release_date
            } = req.body;


            if(
                !title ||
                !title.trim()
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Audio Novel title is required."
                });

            }


            const categoryArray =
                Array.isArray(categories)
                    ? categories
                        .map(
                            item =>
                                String(item).trim()
                        )
                        .filter(Boolean)
                    : [];


            const result =
                await db.query(
                    `
                    INSERT INTO audio_novels (

                        title,
                        description,
                        cover_url,
                        language,
                        category,
                        categories,
                        content_type,
                        status,
                        publish_status,
                        visibility,
                        premium_only,
                        featured,
                        release_date,
                        created_by

                    )

                    VALUES (

                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6,
                        $7,
                        $8,
                        $9,
                        $10,
                        $11,
                        $12,
                        $13,
                        $14

                    )

                    RETURNING *
                    `,
                    [

                        title.trim(),

                        description
                            ? description.trim()
                            : null,

                        cover_url
                            ? cover_url.trim()
                            : null,

                        language
                            ? language.trim()
                            : null,

                        category
                            ? category.trim()
                            : null,

                        categoryArray,

                        content_type ||
                            "story",

                        status ||
                            "ongoing",

                        publish_status ||
                            "draft",

                        visibility ||
                            "private",

                        Boolean(
                            premium_only
                        ),

                        Boolean(
                            featured
                        ),

                        release_date ||
                            null,

                        req.user.id

                    ]
                );


            return res.status(201).json({

                success: true,

                message:
                    "Audio Novel created successfully.",

                audio:
                    result.rows[0]

            });


        } catch(error){

            console.error(
                "Admin Audio Novel CREATE error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to create Audio Novel."

            });

        }

    }
);



module.exports = router;