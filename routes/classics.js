const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");



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
   GET MY CLASSIC BOOKMARKS
   GET /api/classics/bookmarks
========================================================= */

router.get(
    "/bookmarks",
    auth,
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT
                        cb.id,
                        cb.classic_id,
                        cb.classic_chapter_id,
                        cb.created_at,

                        c.title AS classic_title,
                        c.author_name,
                        c.cover_image,

                        cc.chapter_number,
                        cc.title AS chapter_title

                    FROM classic_bookmarks cb

                    JOIN classics c
                        ON c.id = cb.classic_id

                    JOIN classic_chapters cc
                        ON cc.id =
                            cb.classic_chapter_id

                    WHERE
                        cb.user_id = $1

                    ORDER BY
                        cb.created_at DESC
                `, [
                    req.user.id
                ]);


            res.json({
                success: true,
                bookmarks: result.rows
            });


        } catch (err) {

            console.error(
                "Classic bookmarks error:",
                err
            );


            res.status(500).json({
                success: false,
                message:
                    "Unable to load Classic bookmarks."
            });

        }

    }
);

/* =========================================================
   ADD CLASSIC BOOKMARK
   POST /api/classics/:id/bookmark
========================================================= */

router.post(
    "/:id/bookmark",
    auth,
    async (req, res) => {

        try {

            const classicId =
                Number(req.params.id);

            const chapterId =
                Number(req.body.chapter_id);


            if (
                !Number.isInteger(classicId) ||
                !Number.isInteger(chapterId)
            ) {

                return res.status(400).json({
                    success: false,
                    message:
                        "Valid Classic and chapter are required."
                });

            }


            /* ================================================
               VERIFY CLASSIC
            ================================================= */

            const classicCheck =
                await db.query(`
                    SELECT id
                    FROM classics

                    WHERE
                        id = $1
                        AND is_published = TRUE
                `, [
                    classicId
                ]);


            if (!classicCheck.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Classic not found."
                });

            }


            /* ================================================
               VERIFY CHAPTER BELONGS TO CLASSIC
            ================================================= */

            const chapterCheck =
                await db.query(`
                    SELECT id
                    FROM classic_chapters

                    WHERE
                        id = $1
                        AND classic_id = $2
                `, [
                    chapterId,
                    classicId
                ]);


            if (!chapterCheck.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Classic chapter not found."
                });

            }


            /* ================================================
               INSERT BOOKMARK
            ================================================= */

            const result =
                await db.query(`
                    INSERT INTO classic_bookmarks (
                        user_id,
                        classic_id,
                        classic_chapter_id
                    )

                    VALUES (
                        $1,
                        $2,
                        $3
                    )

                    ON CONFLICT (
                        user_id,
                        classic_chapter_id
                    )

                    DO NOTHING

                    RETURNING
                        id,
                        classic_id,
                        classic_chapter_id,
                        created_at
                `, [
                    req.user.id,
                    classicId,
                    chapterId
                ]);


            if (!result.rows.length) {

                return res.json({
                    success: true,
                    bookmarked: true,
                    message:
                        "Chapter is already bookmarked."
                });

            }


            res.status(201).json({
                success: true,
                bookmarked: true,
                bookmark:
                    result.rows[0]
            });


        } catch (err) {

            console.error(
                "Add Classic bookmark error:",
                err
            );


            res.status(500).json({
                success: false,
                message:
                    "Unable to bookmark chapter."
            });

        }

    }
);


/* =========================================================
   CHECK CLASSIC BOOKMARK
   GET /api/classics/:id/bookmark/:chapterId
========================================================= */

router.get(
    "/:id/bookmark/:chapterId",
    auth,
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    SELECT id
                    FROM classic_bookmarks

                    WHERE
                        user_id = $1
                        AND classic_id = $2
                        AND classic_chapter_id = $3

                    LIMIT 1
                `, [
                    req.user.id,
                    req.params.id,
                    req.params.chapterId
                ]);


            res.json({
                success: true,
                bookmarked:
                    result.rows.length > 0
            });


        } catch (err) {

            console.error(
                "Classic bookmark status error:",
                err
            );


            res.status(500).json({
                success: false,
                message:
                    "Unable to check bookmark."
            });

        }

    }
);

/* =========================================================
   REMOVE CLASSIC BOOKMARK
   DELETE /api/classics/:id/bookmark/:chapterId
========================================================= */

router.delete(
    "/:id/bookmark/:chapterId",
    auth,
    async (req, res) => {

        try {

            const result =
                await db.query(`
                    DELETE FROM classic_bookmarks

                    WHERE
                        user_id = $1
                        AND classic_id = $2
                        AND classic_chapter_id = $3

                    RETURNING id
                `, [
                    req.user.id,
                    req.params.id,
                    req.params.chapterId
                ]);


            if (!result.rows.length) {

                return res.status(404).json({
                    success: false,
                    message:
                        "Bookmark not found."
                });

            }


            res.json({
                success: true,
                bookmarked: false,
                message:
                    "Bookmark removed."
            });


        } catch (err) {

            console.error(
                "Remove Classic bookmark error:",
                err
            );


            res.status(500).json({
                success: false,
                message:
                    "Unable to remove bookmark."
            });

        }

    }
);

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