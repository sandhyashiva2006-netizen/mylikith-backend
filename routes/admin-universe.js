const express = require("express");
const router = express.Router();

const db = require("../db");
const auth = require("../middleware/auth");


/* ==========================================
   ADMIN AUTHENTICATION
========================================== */

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


/* ==========================================
   GET ALL UNIVERSE MODULES
========================================== */

router.get("/modules", async (req, res) => {

    try {

        const result = await db.query(`
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

        res.json({
            success: true,
            modules: result.rows
        });

    } catch (err) {

        console.log("Universe modules error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to load Universe modules."
        });

    }

});


/* ==========================================
   UPDATE UNIVERSE MODULE
========================================== */

router.put("/modules/:id", async (req, res) => {

    try {

        const {
            title,
            description,
            icon,
            route,
            enabled,
            coming_soon,
            display_order
        } = req.body;


        const result = await db.query(`

            UPDATE universe_modules

            SET
                title = COALESCE($1, title),
                description = COALESCE($2, description),
                icon = COALESCE($3, icon),
                route = COALESCE($4, route),
                enabled = COALESCE($5, enabled),
                coming_soon = COALESCE($6, coming_soon),
                display_order = COALESCE($7, display_order),
                updated_at = NOW()

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
            req.params.id
        ]);


        if (!result.rows.length) {

            return res.status(404).json({
                success: false,
                message: "Universe module not found."
            });

        }


        res.json({
            success: true,
            message: "Universe module updated successfully.",
            module: result.rows[0]
        });


    } catch (err) {

        console.log("Universe module update error:", err);

        res.status(500).json({
            success: false,
            message: "Unable to update Universe module."
        });

    }

});


module.exports = router;