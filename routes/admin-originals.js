const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");


/* =========================================================
   ADMIN AUTHENTICATION
========================================================= */

router.use(auth);

router.use((req, res, next) => {

    if (req.user.role !== "admin") {

        return res.status(403).json({
            success: false,
            message: "Admin access required."
        });

    }

    next();

});


/* =========================================================
   GET ALL ORIGINALS
   GET /api/admin/originals
========================================================= */

router.get("/", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                o.*,
                COUNT(oc.id)::INTEGER AS chapter_count
            FROM originals o
            LEFT JOIN original_chapters oc
                ON oc.original_id = o.id
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Admin Originals GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Originals."
        });

    }

});


/* =========================================================
   GET SINGLE ORIGINAL
   GET /api/admin/originals/:id
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT *
            FROM originals
            WHERE id = $1
        `, [
            req.params.id
        ]);

        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }

        res.json({
            success: true,
            original: result.rows[0]
        });

    } catch (err) {

        console.error(
            "Admin Original GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original."
        });

    }

});


/* =========================================================
   CREATE ORIGINAL
   POST /api/admin/originals
========================================================= */

router.post("/", async (req, res) => {

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


        if (!title || !title.trim()) {

            return res.status(400).json({
                success: false,
                message: "Original title is required."
            });

        }


        const result = await db.query(`
            INSERT INTO originals (
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
        `, [

            title.trim(),
            description || null,
            cover_url || null,
            language || null,
            category || null,
            Array.isArray(categories)
                ? categories
                : [],
            content_type || "story",
            status || "ongoing",
            publish_status || "draft",
            visibility || "private",
            Boolean(premium_only),
            Boolean(featured),
            release_date || null,
            req.user.id

        ]);


        res.status(201).json({
            success: true,
            message: "Original created successfully.",
            original: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Admin Original CREATE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to create Original."
        });

    }

});


/* =========================================================
   UPDATE ORIGINAL
   PUT /api/admin/originals/:id
========================================================= */

router.put("/:id", async (req, res) => {

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


        if (!title || !title.trim()) {

            return res.status(400).json({
                success: false,
                message: "Original title is required."
            });

        }


        const result = await db.query(`
            UPDATE originals
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
        `, [

            title.trim(),
            description || null,
            cover_url || null,
            language || null,
            category || null,
            Array.isArray(categories)
                ? categories
                : [],
            content_type || "story",
            status || "ongoing",
            publish_status || "draft",
            visibility || "private",
            Boolean(premium_only),
            Boolean(featured),
            release_date || null,
            req.params.id

        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        res.json({
            success: true,
            message: "Original updated successfully.",
            original: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Admin Original UPDATE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to update Original."
        });

    }

});


/* =========================================================
   DELETE ORIGINAL
   DELETE /api/admin/originals/:id
========================================================= */

router.delete("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            DELETE FROM originals
            WHERE id = $1
            RETURNING id, title
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        res.json({
            success: true,
            message: "Original deleted successfully."
        });


    } catch (err) {

        console.error(
            "Admin Original DELETE error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to delete Original."
        });

    }

});


/* =========================================================
   GET CHAPTERS
   GET /api/admin/originals/:id/chapters
========================================================= */

router.get("/:id/chapters", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT *
            FROM original_chapters
            WHERE original_id = $1
            ORDER BY chapter_no ASC
        `, [
            req.params.id
        ]);


        res.json({
            success: true,
            chapters: result.rows
        });


    } catch (err) {

        console.error(
            "Admin Original chapters GET error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load chapters."
        });

    }

});


/* =========================================================
   CREATE CHAPTER
   POST /api/admin/originals/:id/chapters
========================================================= */

router.post("/:id/chapters", async (req, res) => {

    try {

        const {
            chapter_no,
            title,
            content,
            is_premium,
            coins_required,
            early_access,
            is_draft,
            is_published,
            publish_at
        } = req.body;


        if (
            chapter_no === undefined ||
            chapter_no === null ||
            !content ||
            !content.trim()
        ) {

            return res.status(400).json({
                success: false,
                message:
                    "Chapter number and content are required."
            });

        }


        const original = await db.query(`
            SELECT id
            FROM originals
            WHERE id = $1
        `, [
            req.params.id
        ]);


        if (!original.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Original not found."
            });

        }


        const result = await db.query(`
            INSERT INTO original_chapters (
                original_id,
                chapter_no,
                title,
                content,
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
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10
            )
            RETURNING *
        `, [

            req.params.id,
            Number(chapter_no),
            title ||
                `Chapter ${Number(chapter_no)}`,
            content.trim(),
            Boolean(is_premium),
            Number(coins_required) || 0,
            Boolean(early_access),
            is_draft !== false,
            Boolean(is_published),
            publish_at || null

        ]);


        res.status(201).json({
            success: true,
            message: "Chapter created successfully.",
            chapter: result.rows[0]
        });


    } catch (err) {

        console.error(
            "Admin Original chapter CREATE error:",
            err
        );

        if (err.code === "23505") {

            return res.status(409).json({
                success: false,
                message:
                    "That chapter number already exists."
            });

        }

        res.status(500).json({
            success: false,
            message: "Unable to create chapter."
        });

    }

});


/* =========================================================
   UPDATE CHAPTER
   PUT /api/admin/originals/:id/chapters/:chapterId
========================================================= */

router.put(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const {
                chapter_no,
                title,
                content,
                is_premium,
                coins_required,
                early_access,
                is_draft,
                is_published,
                publish_at
            } = req.body;


            if (
                chapter_no === undefined ||
                chapter_no === null ||
                !content ||
                !content.trim()
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Chapter number and content are required."
                });

            }


            const result = await db.query(`
                UPDATE original_chapters
                SET
                    chapter_no = $1,
                    title = $2,
                    content = $3,
                    is_premium = $4,
                    coins_required = $5,
                    early_access = $6,
                    is_draft = $7,
                    is_published = $8,
                    publish_at = $9,
                    updated_at = NOW()
                WHERE
                    id = $10
                    AND original_id = $11
                RETURNING *
            `, [

                Number(chapter_no),
                title ||
                    `Chapter ${Number(chapter_no)}`,
                content.trim(),
                Boolean(is_premium),
                Number(coins_required) || 0,
                Boolean(early_access),
                Boolean(is_draft),
                Boolean(is_published),
                publish_at || null,
                req.params.chapterId,
                req.params.id

            ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Chapter not found."
                });

            }


            res.json({
                success: true,
                message: "Chapter updated successfully.",
                chapter: result.rows[0]
            });


        } catch (err) {

            console.error(
                "Admin Original chapter UPDATE error:",
                err
            );

            if (err.code === "23505") {

                return res.status(409).json({
                    success: false,
                    message:
                        "That chapter number already exists."
                });

            }

            res.status(500).json({
                success: false,
                message: "Unable to update chapter."
            });

        }

    }
);


/* =========================================================
   DELETE CHAPTER
   DELETE /api/admin/originals/:id/chapters/:chapterId
========================================================= */

router.delete(
    "/:id/chapters/:chapterId",
    async (req, res) => {

        try {

            const result = await db.query(`
                DELETE FROM original_chapters
                WHERE
                    id = $1
                    AND original_id = $2
                RETURNING id
            `, [
                req.params.chapterId,
                req.params.id
            ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message: "Chapter not found."
                });

            }


            res.json({
                success: true,
                message: "Chapter deleted successfully."
            });


        } catch (err) {

            console.error(
                "Admin Original chapter DELETE error:",
                err
            );

            res.status(500).json({
                success: false,
                message: "Unable to delete chapter."
            });

        }

    }
);


module.exports = router;