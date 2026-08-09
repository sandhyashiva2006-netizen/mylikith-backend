const express = require("express");
const router = express.Router();

const db = require("../db");


/* =========================================================
   GET ALL PUBLISHED ORIGINALS
   GET /api/originals
   Supports:
   ?search=
   ?language=
   ?category=
========================================================= */

router.get("/", async (req, res) => {

    try {

        const {
            search,
            language,
            category
        } = req.query;

        const conditions = [
            "publish_status = 'published'",
            "visibility = 'public'"
        ];

        const values = [];

        if (search && search.trim()) {

            values.push(`%${search.trim()}%`);

            conditions.push(`
                (
                    title ILIKE $${values.length}
                    OR description ILIKE $${values.length}
                )
            `);

        }

        if (language && language.trim()) {

            values.push(language.trim());

            conditions.push(
                `language = $${values.length}`
            );

        }

        if (category && category.trim()) {

            values.push(category.trim());

            conditions.push(
                `category = $${values.length}`
            );

        }

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE ${conditions.join(" AND ")}
            ORDER BY
                featured DESC,
                release_date DESC NULLS LAST,
                created_at DESC
        `, values);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Originals API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load MyLikith Originals."
        });

    }

});


/* =========================================================
   GET FEATURED ORIGINALS
   GET /api/originals/featured
========================================================= */

router.get("/featured", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE
                publish_status = 'published'
                AND visibility = 'public'
                AND featured = TRUE
            ORDER BY
                release_date DESC NULLS LAST,
                created_at DESC
        `);

        res.json({
            success: true,
            originals: result.rows
        });

    } catch (err) {

        console.error(
            "Featured Originals API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load featured Originals."
        });

    }

});


/* =========================================================
   GET SINGLE ORIGINAL
   GET /api/originals/:id
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const originalId = Number(req.params.id);

        if (!Number.isInteger(originalId)) {

            return res.status(400).json({
                success: false,
                message: "Invalid Original ID."
            });

        }

        const result = await db.query(`
            SELECT
                id,
                title,
                description,
                cover_url,
                language,
                category,
                categories,
                content_type,
                status,
                premium_only,
                featured,
                views,
                likes,
                rating,
                release_date,
                created_at
            FROM originals
            WHERE
                id = $1
                AND publish_status = 'published'
                AND visibility = 'public'
        `, [originalId]);

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
            "Original detail error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Original."
        });

    }

});


module.exports = router;