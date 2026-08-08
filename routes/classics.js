const express = require("express");
const router = express.Router();

const db = require("../db");


/* =========================================================
   GET PUBLISHED CLASSICS
   GET /api/classics
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
            "is_published = TRUE"
        ];


        const values = [];


        /* =====================================================
           SEARCH
           Searches title + author
        ===================================================== */

        if (
            search &&
            search.trim()
        ) {

            values.push(
                `%${search.trim()}%`
            );

            conditions.push(`
                (
                    title ILIKE $${values.length}
                    OR author_name ILIKE $${values.length}
                )
            `);

        }


        /* =====================================================
           LANGUAGE FILTER
        ===================================================== */

        if (
            language &&
            language.trim()
        ) {

            values.push(
                language.trim()
            );

            conditions.push(
                `language = $${values.length}`
            );

        }


        /* =====================================================
           CATEGORY FILTER
        ===================================================== */

        if (
            category &&
            category.trim()
        ) {

            values.push(
                category.trim()
            );

            conditions.push(
                `category = $${values.length}`
            );

        }


        const query = `
            SELECT
                id,
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                view_count,
                created_at

            FROM classics

            WHERE
                ${conditions.join(" AND ")}

            ORDER BY
                is_featured DESC,
                title ASC
        `;


        const result =
            await db.query(
                query,
                values
            );


        res.json({
            success: true,
            classics: result.rows
        });


    } catch (err) {

        console.error(
            "Classics API error:",
            err
        );


        res.status(500).json({
            success: false,
            message:
                "Unable to load Classics."
        });

    }

});


/* =========================================================
   GET FEATURED CLASSICS
   GET /api/classics/featured
========================================================= */

router.get("/featured", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                view_count,
                created_at
            FROM classics
            WHERE
                is_published = TRUE
                AND is_featured = TRUE
            ORDER BY title ASC
        `);

        res.json({
            success: true,
            classics: result.rows
        });

    } catch (err) {

        console.error(
            "Featured Classics API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load featured Classics."
        });

    }

});


/* =========================================================
   GET SINGLE CLASSIC
   GET /api/classics/:id
========================================================= */

router.get("/:id", async (req, res) => {

    try {

        const result = await db.query(`
            SELECT
                id,
                title,
                author_name,
                original_language,
                language,
                description,
                cover_image,
                publication_year,
                source_name,
                source_url,
                license,
                category,
                is_featured,
                view_count,
                created_at
            FROM classics
            WHERE
                id = $1
                AND is_published = TRUE
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        res.json({
            success: true,
            classic: result.rows[0]
        });

    } catch (err) {

        console.error(
            "Single Classic API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Classic."
        });

    }

});


/* =========================================================
   GET CLASSIC CHAPTERS
   GET /api/classics/:id/chapters
========================================================= */

router.get("/:id/chapters", async (req, res) => {

    try {

        const classicCheck = await db.query(`
            SELECT id
            FROM classics
            WHERE
                id = $1
                AND is_published = TRUE
        `, [
            req.params.id
        ]);


        if (!classicCheck.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        const result = await db.query(`
            SELECT
                id,
                classic_id,
                chapter_number,
                title,
                content,
                created_at
            FROM classic_chapters
            WHERE classic_id = $1
            ORDER BY chapter_number ASC
        `, [
            req.params.id
        ]);


        res.json({
            success: true,
            chapters: result.rows
        });

    } catch (err) {

        console.error(
            "Classic chapters API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to load Classic chapters."
        });

    }

});


/* =========================================================
   INCREMENT VIEW COUNT
   POST /api/classics/:id/view
========================================================= */

router.post("/:id/view", async (req, res) => {

    try {

        const result = await db.query(`
            UPDATE classics
            SET view_count = view_count + 1
            WHERE
                id = $1
                AND is_published = TRUE
            RETURNING view_count
        `, [
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Classic not found."
            });

        }


        res.json({
            success: true,
            view_count: result.rows[0].view_count
        });

    } catch (err) {

        console.error(
            "Classic view API error:",
            err
        );

        res.status(500).json({
            success: false,
            message: "Unable to update view count."
        });

    }

});


module.exports = router;