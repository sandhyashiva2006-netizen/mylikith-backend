const express = require("express");
const router = express.Router();

const pool = require("../db");

// GET /api/universe/modules
router.get("/modules", async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id,
                name,
                title,
                description,
                icon,
                route,
                enabled,
                coming_soon,
                display_order
            FROM universe_modules
            ORDER BY display_order ASC
        `);

        res.json(result.rows);
    } catch (error) {
        console.error("Universe modules error:", error);
        res.status(500).json({
            message: "Failed to load Universe modules"
        });
    }
});

module.exports = router;