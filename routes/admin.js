const express = require("express");

const router = express.Router();

const db = require("../db");

const {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand
} = require("@aws-sdk/client-s3");

const {
    getSignedUrl
} = require("@aws-sdk/s3-request-presigner");


/* =========================================================
   BACKBLAZE B2 S3 CLIENT
   ========================================================= */

const b2S3 =
    new S3Client({

        region:
            process.env.B2_REGION,

        endpoint:
            process.env.B2_ENDPOINT,

        credentials: {

            accessKeyId:
                process.env.B2_KEY_ID,

            secretAccessKey:
                process.env.B2_APPLICATION_KEY

        },

        forcePathStyle:
            true

    });

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

/*
=========================================================
ADMIN UPDATE AUDIO NOVEL
PUT /api/admin/audio/novels/:id
=========================================================
*/

router.put(
    "/audio/novels/:id",
    async (req, res) => {

        try {

            const novelId =
                Number(req.params.id);

            if (
                !Number.isInteger(novelId) ||
                novelId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid Audio Novel ID."
                });

            }

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


            if (
                !title ||
                !String(title).trim()
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Audio Novel title is required."
                });

            }


            const categoryArray =
                Array.isArray(categories)
                    ? categories
                        .map(item => String(item).trim())
                        .filter(Boolean)
                    : [];


            const result =
                await db.query(
                    `
                    UPDATE audio_novels

                    SET
                        title = $1,
                        description = $2,
                        cover_url = $3,
                        language = $4,
                        category = $5,
                        categories = $6,
                        content_type = $7,
                        status = $8,
                        publish_status = $9,
                        visibility = $10,
                        premium_only = $11,
                        featured = $12,
                        release_date = $13,
                        updated_at = NOW()

                    WHERE id = $14

                    RETURNING *
                    `,
                    [

                        String(title).trim(),

                        description
                            ? String(description).trim()
                            : null,

                        cover_url
                            ? String(cover_url).trim()
                            : null,

                        language
                            ? String(language).trim()
                            : null,

                        category
                            ? String(category).trim()
                            : null,

                        categoryArray,

                        content_type || "story",

                        status || "ongoing",

                        publish_status || "draft",

                        visibility || "private",

                        Boolean(premium_only),

                        Boolean(featured),

                        release_date || null,

                        novelId

                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Audio Novel not found."
                });

            }


            return res.json({

                success: true,

                message:
                    "Audio Novel updated successfully.",

                audio:
                    result.rows[0]

            });


        } catch (error) {

            console.error(
                "Admin Audio Novel UPDATE error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to update Audio Novel."

            });

        }

    }
);


/*
=========================================================
ADMIN PUBLISH / UNPUBLISH AUDIO NOVEL
PATCH /api/admin/audio/novels/:id/publish
=========================================================
*/

router.patch(
    "/audio/novels/:id/publish",
    async (req, res) => {

        try {

            const novelId =
                Number(req.params.id);

            if (
                !Number.isInteger(novelId) ||
                novelId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid Audio Novel ID."
                });

            }


            const published =
                Boolean(req.body.published);


            const result =
                await db.query(
                    `
                    UPDATE audio_novels

                    SET
                        publish_status = $1,
                        visibility = $2,
                        status = $3,
                        updated_at = NOW()

                    WHERE id = $4

                    RETURNING
                        id,
                        title,
                        publish_status,
                        visibility,
                        status,
                        featured,
                        updated_at
                    `,
                    [

                        published
                            ? "published"
                            : "draft",

                        published
                            ? "public"
                            : "private",

                        published
                            ? "published"
                            : "draft",

                        novelId

                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Audio Novel not found."
                });

            }


            return res.json({

                success: true,

                message:
                    published
                        ? "Audio Novel published successfully."
                        : "Audio Novel unpublished successfully.",

                audio:
                    result.rows[0]

            });


        } catch (error) {

            console.error(
                "Admin Audio Novel PUBLISH error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to update Audio Novel publish status."

            });

        }

    }
);


/*
=========================================================
ADMIN FEATURE / UNFEATURE AUDIO NOVEL
PATCH /api/admin/audio/novels/:id/featured
=========================================================
*/

router.patch(
    "/audio/novels/:id/featured",
    async (req, res) => {

        try {

            const novelId =
                Number(req.params.id);

            if (
                !Number.isInteger(novelId) ||
                novelId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid Audio Novel ID."
                });

            }


            const featured =
                Boolean(req.body.featured);


            const result =
                await db.query(
                    `
                    UPDATE audio_novels

                    SET
                        featured = $1,
                        updated_at = NOW()

                    WHERE id = $2

                    RETURNING
                        id,
                        title,
                        featured,
                        updated_at
                    `,
                    [
                        featured,
                        novelId
                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Audio Novel not found."
                });

            }


            return res.json({

                success: true,

                message:
                    featured
                        ? "Audio Novel featured successfully."
                        : "Audio Novel removed from featured.",

                audio:
                    result.rows[0]

            });


        } catch (error) {

            console.error(
                "Admin Audio Novel FEATURED error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to update featured status."

            });

        }

    }
);


/*
=========================================================
ADMIN DELETE AUDIO NOVEL
DELETE /api/admin/audio/novels/:id
=========================================================
*/

router.delete(
    "/audio/novels/:id",
    async (req, res) => {

        try {

            const novelId =
                Number(req.params.id);

            if (
                !Number.isInteger(novelId) ||
                novelId <= 0
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Invalid Audio Novel ID."
                });

            }


            /*
            -------------------------------------------------
            Prevent accidental deletion when chapters exist.
            Chapters should be handled first.
            -------------------------------------------------
            */

            const chapterCheck =
                await db.query(
                    `
                    SELECT
                        COUNT(*)::int AS chapter_count

                    FROM audio_chapters

                    WHERE audio_novel_id = $1
                    `,
                    [
                        novelId
                    ]
                );


            const chapterCount =
                chapterCheck.rows[0]?.chapter_count || 0;


            if (chapterCount > 0) {

                return res.status(409).json({

                    success: false,

                    message:
                        "This Audio Novel has chapters. Delete its chapters first."

                });

            }


            const result =
                await db.query(
                    `
                    DELETE FROM audio_novels

                    WHERE id = $1

                    RETURNING
                        id,
                        title
                    `,
                    [
                        novelId
                    ]
                );


            if (!result.rows.length) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Audio Novel not found."

                });

            }


            return res.json({

                success: true,

                message:
                    "Audio Novel deleted successfully.",

                audio:
                    result.rows[0]

            });


        } catch (error) {

            console.error(
                "Admin Audio Novel DELETE error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to delete Audio Novel."

            });

        }

    }
);

/*
=========================================================
ADMIN CREATE AUDIO CHAPTER
POST /api/admin/audio/chapters
=========================================================
*/

router.post(
    "/audio/chapters",
    async (req, res) => {

        try {

            const {
                audio_novel_id,
                chapter_no,
                title,
                is_premium,
                coins_required,
                early_access,
                is_draft,
                is_published,
                publish_at
            } = req.body;


            const novelId =
                Number(audio_novel_id);

            const chapterNumber =
                Number(chapter_no);

            const coins =
                Number(coins_required || 0);


            if(
                !Number.isInteger(novelId) ||
                novelId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid Audio Novel."
                });

            }


            if(
                !Number.isInteger(chapterNumber) ||
                chapterNumber <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Chapter number must be greater than zero."
                });

            }


            if(
                !title ||
                !title.trim()
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Chapter title is required."
                });

            }


            if(
                !Number.isInteger(coins) ||
                coins < 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Coins required must be zero or greater."
                });

            }


            const novel =
                await db.query(`
                    SELECT
                        id,
                        title
                    FROM audio_novels
                    WHERE id = $1
                `, [
                    novelId
                ]);


            if(
                !novel.rows.length
            ){

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio Novel not found."
                });

            }


            const existing =
                await db.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        audio_novel_id = $1
                        AND chapter_no = $2
                `, [
                    novelId,
                    chapterNumber
                ]);


            if(
                existing.rows.length
            ){

                return res.status(409).json({
                    success: false,
                    message:
                        "This chapter number already exists."
                });

            }


            const published =
                Boolean(
                    is_published
                );

            const draft =
                Boolean(
                    is_draft
                );


            const result =
                await db.query(
                    `
                    INSERT INTO audio_chapters (

                        audio_novel_id,
                        chapter_no,
                        title,

                        audio_status,

                        is_premium,
                        coins_required,
                        early_access,

                        is_draft,
                        is_published,
                        publish_at

                    )

                    VALUES (

                        $1,
                        $2,
                        $3,

                        'pending',

                        $4,
                        $5,
                        $6,

                        $7,
                        $8,
                        $9

                    )

                    RETURNING *
                    `,
                    [

                        novelId,

                        chapterNumber,

                        title.trim(),

                        Boolean(
                            is_premium
                        ),

                        coins,

                        Boolean(
                            early_access
                        ),

                        draft,

                        published,

                        publish_at ||
                            null

                    ]
                );


            return res.status(201).json({

                success: true,

                message:
                    "Audio Chapter created successfully.",

                chapter:
                    result.rows[0]

            });


        } catch(error){

            console.error(
                "Admin Audio Chapter CREATE error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to create Audio Chapter."

            });

        }

    }
);

/*
=========================================================
START AUDIO CHAPTER MULTIPART UPLOAD
POST /api/admin/audio/chapters/:chapterId/media/start
=========================================================
*/

router.post(
    "/audio/chapters/:chapterId/media/start",
    async (req, res) => {

        try {

            const chapterId =
                Number(
                    req.params.chapterId
                );


            const {
                file_name,
                mime_type,
                file_size
            } = req.body;


            if(
                !Number.isInteger(
                    chapterId
                ) ||
                chapterId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }


            if(
                !file_name ||
                !mime_type ||
                !mime_type.startsWith(
                    "audio/"
                )
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "A valid audio file is required."
                });

            }


            const size =
                Number(file_size);


            if(
                !Number.isFinite(size) ||
                size <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid audio file size."
                });

            }


            const chapter =
                await db.query(`
                    SELECT
                        ac.id,
                        ac.audio_novel_id
                    FROM audio_chapters ac
                    WHERE ac.id = $1
                `, [
                    chapterId
                ]);


            if(
                !chapter.rows.length
            ){

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio Chapter not found."
                });

            }


            const safeName =
                file_name
                    .replace(
                        /[^a-zA-Z0-9._-]/g,
                        "_"
                    );


            const objectKey =
                `audio/${chapter.rows[0].audio_novel_id}/chapters/${chapterId}/${Date.now()}-${safeName}`;


            const command =
                new CreateMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        objectKey,

                    ContentType:
                        mime_type

                });


            const upload =
                await b2S3.send(
                    command
                );


            if(
                !upload.UploadId
            ){

                throw new Error(
                    "B2 did not return an upload ID."
                );

            }


            await db.query(`
                UPDATE audio_chapters
                SET
                    audio_provider = 'b2',
                    audio_object_key = $1,
                    audio_mime_type = $2,
                    audio_original_name = $3,
                    audio_size_bytes = $4,
                    audio_status = 'uploading',
                    updated_at = NOW()
                WHERE id = $5
            `, [

                objectKey,

                mime_type,

                file_name,

                size,

                chapterId

            ]);


            return res.json({

                success: true,

                upload_id:
                    upload.UploadId,

                object_key:
                    objectKey,

                chapter_id:
                    chapterId,

                part_size:
                    10 * 1024 * 1024

            });


        } catch(error){

            console.error(
                "B2 Audio upload start error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to start audio upload."

            });

        }

    }
);

/*
=========================================================
SIGN AUDIO MULTIPART PART
POST /api/admin/audio/chapters/:chapterId/media/sign-part
=========================================================
*/

router.post(
    "/audio/chapters/:chapterId/media/sign-part",
    async (req, res) => {

        try {

            const chapterId =
                Number(
                    req.params.chapterId
                );


            const {
                upload_id,
                object_key,
                part_number
            } = req.body;


            if(
                !Number.isInteger(
                    chapterId
                ) ||
                chapterId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }


            const partNumber =
                Number(
                    part_number
                );


            if(
                !upload_id ||
                !object_key ||
                !Number.isInteger(
                    partNumber
                ) ||
                partNumber < 1
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload information is incomplete."
                });

            }


            const chapter =
                await db.query(`
                    SELECT id
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND audio_provider = 'b2'
                        AND audio_object_key = $2
                `, [
                    chapterId,
                    object_key
                ]);


            if(
                !chapter.rows.length
            ){

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio upload session not found."
                });

            }


            const command =
                new UploadPartCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id,

                    PartNumber:
                        partNumber

                });


            const signedUrl =
                await getSignedUrl(
                    b2S3,
                    command,
                    {
                        expiresIn:
                            900
                    }
                );


            return res.json({

                success: true,

                url:
                    signedUrl,

                expires_in:
                    900

            });


        } catch(error){

            console.error(
                "B2 Audio sign part error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to create audio upload URL."

            });

        }

    }
);

/*
=========================================================
COMPLETE AUDIO MULTIPART UPLOAD
POST /api/admin/audio/chapters/:chapterId/media/complete
=========================================================
*/

router.post(
    "/audio/chapters/:chapterId/media/complete",
    async (req, res) => {

        try {

            const chapterId =
                Number(
                    req.params.chapterId
                );


            const {
                upload_id,
                object_key,
                parts,
                duration_seconds
            } = req.body;


            if(
                !Number.isInteger(
                    chapterId
                ) ||
                chapterId <= 0
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid chapter ID."
                });

            }


            if(
                !upload_id ||
                !object_key ||
                !Array.isArray(parts) ||
                !parts.length
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "Upload completion information is incomplete."
                });

            }


            const chapter =
                await db.query(`
                    SELECT
                        id,
                        audio_object_key
                    FROM audio_chapters
                    WHERE
                        id = $1
                        AND audio_provider = 'b2'
                        AND audio_object_key = $2
                `, [
                    chapterId,
                    object_key
                ]);


            if(
                !chapter.rows.length
            ){

                return res.status(404).json({
                    success: false,
                    message:
                        "Audio upload session not found."
                });

            }


            const normalizedParts =
                parts
                    .map(
                        part => ({

                            PartNumber:
                                Number(
                                    part.PartNumber
                                ),

                            ETag:
                                String(
                                    part.ETag
                                )

                        })
                    )
                    .filter(
                        part =>
                            Number.isInteger(
                                part.PartNumber
                            ) &&
                            part.PartNumber > 0 &&
                            part.ETag
                    )
                    .sort(
                        (a,b) =>
                            a.PartNumber -
                            b.PartNumber
                    );


            if(
                !normalizedParts.length
            ){

                return res.status(400).json({
                    success: false,
                    message:
                        "No valid uploaded parts."
                });

            }


            const command =
                new CompleteMultipartUploadCommand({

                    Bucket:
                        process.env.B2_BUCKET_NAME,

                    Key:
                        object_key,

                    UploadId:
                        upload_id,

                    MultipartUpload: {

                        Parts:
                            normalizedParts

                    }

                });


            await b2S3.send(
                command
            );


            const duration =
                Number(
                    duration_seconds
                );


            await db.query(`
                UPDATE audio_chapters
                SET
                    audio_status = 'ready',
                    audio_duration_seconds = $1,
                    updated_at = NOW()
                WHERE id = $2
            `, [

                Number.isFinite(
                    duration
                )
                    ? Math.max(
                        0,
                        Math.round(
                            duration
                        )
                    )
                    : null,

                chapterId

            ]);


            return res.json({

                success: true,

                message:
                    "Audio upload completed successfully.",

                chapter_id:
                    chapterId

            });


        } catch(error){

            console.error(
                "B2 Audio complete upload error:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to complete audio upload."

            });

        }

    }
);



module.exports = router;