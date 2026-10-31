const express = require("express");

const router = express.Router();

const db = require("../db");

const auth = require("../middleware/auth");

const{

createNotification

}=require("./writers");

const crypto = require("crypto");

const axios = require("axios");
const { recordPaidCoinLot, recordNonPaidCoinLot } = require("./magp-commission-engine");



/* ===========================
   GET WALLET
=========================== */

router.get("/:userId", async (req, res) => {

    

    try {

        let wallet = await db.query(
            `
            SELECT *
            FROM wallets
            WHERE user_id=$1
            `,
            [req.params.userId]
        );

        if (wallet.rows.length === 0) {

            await db.query(
                `
                INSERT INTO wallets
(
user_id,
coins,
earned_coins,
spent_coins
)
VALUES
(
$1,
0,
0,
0
)
                `,
                [req.params.userId]
            );

            wallet = await db.query(
                `
                SELECT *
                FROM wallets
                WHERE user_id=$1
                `,
                [req.params.userId]
            );

        }

        res.json(wallet.rows[0]);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===========================
   WALLET HISTORY
=========================== */

router.get("/:userId/history", async (req, res) => {

    

    try {

        const result = await db.query(

            `
            SELECT

id,
type,
coins,
amount,
description,
created_at

FROM wallet_transactions

WHERE user_id=$1

ORDER BY id DESC
            `,
            [req.params.userId]

        );

        res.json(result.rows);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===========================
   CREDIT
=========================== */

router.post("/credit", async (req, res) => {

    try {

        const {
    user_id,
    amount,
    description
} = req.body;

        await db.query(

            `
            UPDATE wallets

            SET balance=balance+$1

            WHERE user_id=$2
            `,

            [
                amount,
                user_id
            ]

        );

        await db.query(

            `
            INSERT INTO wallet_transactions
            (
            user_id,
            type,
            amount,
            description
            )

            VALUES
            ($1,'Credit',$2,$3)
            `,

            [
                user_id,
                amount,
                description
            ]

        );

        res.json({
            success: true
        });

    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false
        });

    }

});


/* ===========================
   DEBIT
=========================== */

router.post("/debit", async (req, res) => {

    try {

        const {
    user_id,
    amount,
    description
} = req.body;

        const wallet = await db.query(

            `
            SELECT balance
FROM wallets

            WHERE user_id=$1
            `,

            [
                user_id
            ]

        );

        if (wallet.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message: "Wallet not found"

            });

        }

        if (Number(wallet.rows[0].balance) < Number(amount)) {

            return res.status(400).json({

                success: false,

                message: "Insufficient Balance"

            });

        }

        await db.query(

            `
            UPDATE wallets

            SET balance=balance-$1

            WHERE user_id=$2
            `,

            [
                amount,
                user_id
            ]

        );

        await db.query(

            `
            INSERT INTO wallet_transactions
            (
            user_id,
            type,
            amount,
            description
            )

            VALUES
            ($1,'Debit',$2,$3)
            `,

            [
                user_id,
                amount,
                description
            ]

        );

        res.json({

            success: true

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false

        });

    }

});


/* ===========================
   SUMMARY
=========================== */

router.get("/:userId/summary", async (req, res) => {

  

    try {

        const wallet = await db.query(

            `
            SELECT

coins,

earned_coins,

spent_coins

FROM wallets

WHERE user_id=$1
            `,

            [
                req.params.userId
            ]

        );

        const credit = await db.query(

            `
            SELECT
            COALESCE(SUM(amount),0) total

            FROM wallet_transactions

            WHERE

            user_id=$1

            AND

            type='Credit'
            `,

            [
                req.params.userId
            ]

        );

        const debit = await db.query(

            `
            SELECT
            COALESCE(SUM(amount),0) total

            FROM wallet_transactions

            WHERE

            user_id=$1

            AND

            type='Debit'
            `,

            [
                req.params.userId
            ]

        );

        const total = await db.query(

            `
            SELECT COUNT(*) total

            FROM wallet_transactions

            WHERE user_id=$1
            `,

            [
                req.params.userId
            ]

        );

        res.json({

coins:
wallet.rows[0]?.coins || 0,

earned_coins:
wallet.rows[0]?.earned_coins || 0,

spent_coins:
wallet.rows[0]?.spent_coins || 0,

transactions:
Number(total.rows[0].total)

});

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false

        });

    }

});

/* ===========================
   COIN PACKAGES
=========================== */

router.get("/packages/list",async(req,res)=>{

try{

const result=await db.query(

`
SELECT *

FROM coin_packages

WHERE status=TRUE

ORDER BY price
`

);

res.json(result.rows);

}catch(err){

console.error(err);

res.status(500).json({

success:false

});

}

});

/* ===========================
   CREATE CASHFREE ORDER
=========================== */

router.post("/create-order", async (req, res) => {

    try {


const { user_id, package_id } = req.body;

        const pkg = await db.query(
            `
            SELECT *
            FROM coin_packages
            WHERE id=$1
            `,
            [package_id]
        );

        if (pkg.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Package not found"
            });

        }

        const packageData = pkg.rows[0];

        const orderId =
            "MLK_" +
            Date.now() +
            "_" +
            crypto.randomBytes(4).toString("hex");



        const response = await axios.post(

            "https://sandbox.cashfree.com/pg/orders",

            {

                order_id: orderId,

                order_amount: Number(packageData.price),

                order_currency: "INR",

                customer_details: {

                    customer_id: String(user_id),

                    customer_name: "MyLikith Reader",

                    customer_email: "reader@mylikith.com",

                    customer_phone: "9999999999"

                },

                order_meta: {

                    return_url:
"https://mylikith-frontend.pages.dev/payment-success.html?order_id={order_id}"

                }

            },

            {

                headers: {

                    "x-client-id":
                        process.env.CASHFREE_APP_ID,

                    "x-client-secret":
                        process.env.CASHFREE_SECRET_KEY,

                    "x-api-version":
                        "2025-01-01",

                    "Content-Type":
                        "application/json"

                }

            }

        );

        res.json({

            success: true,

            paymentSessionId:
                response.data.payment_session_id,

            orderId

        });

    }

    catch (err) {

        console.log("==============");
        console.log(err.response?.data || err.message);
        console.log("==============");

        res.status(500).json({

            success: false,

            error: err.response?.data || err.message

        });

    }

});

/* ===========================
   VERIFY PAYMENT
=========================== */

router.post("/verify-payment", async (req, res) => {

    try {

        const { order_id } = req.body;

        const response = await axios.get(

            `https://sandbox.cashfree.com/pg/orders/${order_id}`,

            {

                headers: {

                    "x-client-id":
                        process.env.CASHFREE_APP_ID,

                    "x-client-secret":
                        process.env.CASHFREE_SECRET_KEY,

                    "x-api-version":
                        "2025-01-01"

                }

            }

        );

        const order = response.data;

console.log(order);

        if (order.order_status !== "PAID") {

            return res.json({

                success: false,

                message: "Payment Pending"

            });

        }

        const customerId = Number(order.customer_details.customer_id);
        const client = await db.connect();
        try {
            await client.query("BEGIN");
            await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [String(order_id)]);
            const existing = await client.query(
                `SELECT id FROM wallet_transactions WHERE reference_id=$1 AND type='Credit' FOR UPDATE`,
                [order_id]
            );
            if (existing.rows.length) {
                await client.query("COMMIT");
                return res.json({ success: true, message: "Already Credited" });
            }
            const packageResult = await client.query(
                `SELECT id, coins, bonus_coins, price FROM coin_packages WHERE price=$1 LIMIT 1 FOR SHARE`,
                [order.order_amount]
            );
            if (!packageResult.rows.length) {
                await client.query("ROLLBACK");
                return res.status(404).json({ success: false, message: "Package not found" });
            }
            const pkg = packageResult.rows[0];
            const paidCoins = Number(pkg.coins) || 0;
            const bonusCoins = Number(pkg.bonus_coins) || 0;
            const totalCoins = paidCoins + bonusCoins;
            if (totalCoins <= 0 || paidCoins <= 0) throw new Error("Invalid coin package configuration");

            await client.query(
                `INSERT INTO wallets (user_id, coins, earned_coins, spent_coins)
                 VALUES ($1,0,0,0) ON CONFLICT (user_id) DO NOTHING`, [customerId]
            );
            const wallet = await client.query(`SELECT id FROM wallets WHERE user_id=$1 FOR UPDATE`, [customerId]);
            if (!wallet.rows.length) throw new Error("Wallet could not be created");
            await client.query(
                `UPDATE wallets SET coins=coins+$1, earned_coins=earned_coins+$1 WHERE user_id=$2`,
                [totalCoins, customerId]
            );
            const tx = await client.query(
                `INSERT INTO wallet_transactions
                 (wallet_id,user_id,type,coins,amount,description,reference_id)
                 VALUES ($1,$2,'Credit',$3,$4,'Coin Purchase',$5) RETURNING id`,
                [wallet.rows[0].id, customerId, totalCoins, order.order_amount, order_id]
            );
            await recordPaidCoinLot(client, {
                userId: customerId,
                walletTransactionId: tx.rows[0].id,
                sourceReference: `cashfree:${order_id}`,
                paidAmount: order.order_amount,
                paidCoins
            });
            await recordNonPaidCoinLot(client, {
                userId: customerId,
                walletTransactionId: tx.rows[0].id,
                sourceReference: `cashfree-bonus:${order_id}`,
                coins: bonusCoins
            });
            await client.query("COMMIT");
            return res.json({ success: true });
        } catch (transactionError) {
            await client.query("ROLLBACK");
            throw transactionError;
        } finally {
            client.release();
        }

    }

 catch (err) {

    console.log("=========== VERIFY ERROR ===========");

    console.log(err.response?.data);

    console.log(err.response?.status);

    console.log(err.response?.headers);

    console.log(err.message);

    console.error(err);

    console.log("====================================");

    res.status(500).json({

        success:false,

        message:err.response?.data || err.message

    });

}

});

async function rewardCoins(userId, coins, description) {
    const amount = Math.max(0, Math.floor(Number(coins) || 0));
    if (!amount) return;
    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query(`
            INSERT INTO wallets (user_id,coins,earned_coins,spent_coins,balance)
            VALUES ($1,0,0,0,0)
            ON CONFLICT (user_id) DO NOTHING
        `, [userId]);
        const wallet = await client.query(`SELECT id FROM wallets WHERE user_id=$1 FOR UPDATE`, [userId]);
        if (!wallet.rows.length) throw new Error("Wallet not found for coin reward");
        await client.query(`UPDATE wallets SET coins=coins+$1, earned_coins=earned_coins+$1 WHERE user_id=$2`, [amount, userId]);
        const rewardTx = await client.query(`
            INSERT INTO wallet_transactions (wallet_id,user_id,type,coins,amount,description)
            VALUES ($1,$2,'Credit',$3,0,$4) RETURNING id
        `, [wallet.rows[0].id, userId, amount, description]);
        await recordNonPaidCoinLot(client, {
            userId,
            walletTransactionId: rewardTx.rows[0].id,
            sourceReference: `reward:${rewardTx.rows[0].id}`,
            coins: amount
        });
        await client.query("COMMIT");
        await createNotification(userId, "🪙 Coins Credited", `${amount} coins have been added to your wallet.\n\nReason: ${description}`, "wallet");
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

module.exports={

router,

rewardCoins

};