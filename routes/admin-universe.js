const express = require("express");
const router = express.Router();

const pool = require("../db");


/* =========================================================
   GET ALL UNIVERSE MODULES
   GET /api/admin/universe/modules
   ========================================================= */

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
                display_order,
                created_at,
                updated_at
            FROM universe_modules
            ORDER BY display_order ASC
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(
            "Admin Universe modules error:",
            error
        );

        res.status(500).json({
            message: "Failed to load Universe modules"
        });

    }

});


/* =========================================================
   UPDATE UNIVERSE MODULE
   PUT /api/admin/universe/modules/:id
   ========================================================= */

router.put("/modules/:id", async (req, res) => {

    try {

        const { id } = req.params;

        const {
            title,
            description,
            icon,
            route,
            enabled,
            coming_soon,
            display_order
        } = req.body;


        const result = await pool.query(`
            UPDATE universe_modules

            SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                icon = COALESCE($3, icon),
                route = COALESCE($4, route),
                enabled = COALESCE($5, enabled),
                coming_soon = COALESCE($6, coming_soon),
                display_order = COALESCE($7, display_order),
                updated_at = CURRENT_TIMESTAMP

            WHERE id = $8

            RETURNING *
        `, [
            title,
            description,
            icon,
            route,
            enabled,
            coming_soon,
            display_order,
            id
        ]);


        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Universe module not found"
            });

        }


        res.json({
            message: "Universe module updated successfully",
            module: result.rows[0]
        });


    } catch (error) {

        console.error(
            "Update Universe module error:",
            error
        );

        res.status(500).json({
            message: "Failed to update Universe module"
        });

    }

});


module.exports = router;