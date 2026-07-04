const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/:slug", async (req, res) => {

    try {

        const result = await db.query(
            `
            SELECT title,content
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

module.exports = router;