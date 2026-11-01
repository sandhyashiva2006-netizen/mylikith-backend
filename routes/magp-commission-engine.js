'use strict';

const MAGP_COMMISSION_RATE = 10;

function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 0;
    return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error(`Invalid ${label} for MAGP coin accounting.`);
    }
    return number;
}

function sourceValue(value, label, maxLength) {
    const text = String(value ?? '').trim();
    if (!text || text.length > maxLength) {
        throw new Error(`Invalid ${label} for MAGP coin accounting.`);
    }
    return text;
}

/**
 * Record base coins purchased with a verified real-money payment.
 * paidCoins must exclude all package bonus coins.
 * Call on the SAME transaction client used for the wallet credit.
 */
async function recordPaidCoinLot(client, {
    userId,
    walletTransactionId = null,
    sourceReference,
    paidAmount,
    paidCoins
}) {
    const uid = positiveInteger(userId, 'user ID');
    const coins = positiveInteger(paidCoins, 'paid coin count');
    const amount = money(paidAmount);
    const reference = sourceValue(sourceReference, 'payment source reference', 240);

    if (amount <= 0) throw new Error('Paid coin lot must have a positive verified payment amount.');

    await client.query(`
        INSERT INTO magp_paid_coin_lots
            (user_id, wallet_transaction_id, source_reference,
             original_coins, remaining_coins, original_amount, remaining_amount)
        VALUES ($1, $2, $3, $4, $4, $5, $5)
        ON CONFLICT (source_reference) DO NOTHING
    `, [uid, walletTransactionId || null, reference, coins, amount]);
}

/**
 * Record bonus, free, promotional, reward, or legacy coins at zero INR value.
 * Call on the SAME transaction client used for the wallet credit.
 */
async function recordNonPaidCoinLot(client, {
    userId,
    walletTransactionId = null,
    sourceReference,
    coins,
    expiresAt = null
}) {
    const count = Math.max(0, Math.floor(Number(coins) || 0));
    if (count === 0) return;

    const uid = positiveInteger(userId, 'user ID');
    const reference = sourceValue(sourceReference, 'non-paid coin source reference', 240);

    await client.query(`
        INSERT INTO magp_paid_coin_lots
            (user_id, wallet_transaction_id, source_reference,
             original_coins, remaining_coins, original_amount, remaining_amount,
             expires_at)
        VALUES ($1, $2, $3, $4, $4, 0, 0, $5)
        ON CONFLICT (source_reference) DO NOTHING
    `, [uid, walletTransactionId || null, reference, count, expiresAt]);
}

/**
 * Consume wallet coin lots FIFO after a successful monetized-content debit.
 * Only the INR value attached to verified paid-coin lots is commissionable.
 *
 * IMPORTANT: Call this with the same PostgreSQL transaction client used by
 * the wallet debit and unlock insert. If this function throws, the caller
 * must ROLLBACK that transaction so the unlock/debit is not committed alone.
 */
async function recordMonetisedUnlock(client, {
    userId,
    authorId,
    coins,
    sourceType,
    sourceReference
}) {
    const uid = positiveInteger(userId, 'user ID');
    const aid = positiveInteger(authorId, 'author ID');
    const coinCount = positiveInteger(coins, 'unlock coin count');
    const type = sourceValue(sourceType, 'unlock source type', 40);
    const reference = sourceValue(sourceReference, 'unlock source reference', 180);

    // Serialize spending for this wallet; FIFO row locks then protect each lot.
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [uid]);

    const prior = await client.query(`
        SELECT id
        FROM magp_paid_coin_consumptions
        WHERE source_type = $1 AND source_reference = $2
        FOR UPDATE
    `, [type, reference]);

    if (prior.rows.length) {
        throw new Error('Duplicate MAGP coin consumption detected; unlock transaction must be rolled back.');
    }

    const lotsResult = await client.query(`
        SELECT id, original_amount, remaining_coins, remaining_amount
        FROM magp_paid_coin_lots
        WHERE user_id = $1
          AND remaining_coins > 0
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at ASC, id ASC
        FOR UPDATE
    `, [uid]);

    const availableCoins = lotsResult.rows.reduce(
        (sum, lot) => sum + Number(lot.remaining_coins || 0), 0
    );

    // Never silently classify missing coins as free or paid. A missing lot
    // means a credit path was not integrated or the ledger needs reconciliation.
    if (availableCoins < coinCount) {
        throw new Error(
            `MAGP coin reconciliation required for user ${uid}: ` +
            `unlock needs ${coinCount} coins but only ${availableCoins} tracked coins remain.`
        );
    }

    let needed = coinCount;
    let paidCoins = 0;
    let eligibleAmount = 0;
    const allocations = [];

    for (const lot of lotsResult.rows) {
        if (needed <= 0) break;

        const remainingCoins = Number(lot.remaining_coins);
        const remainingAmount = money(lot.remaining_amount);
        const take = Math.min(needed, remainingCoins);
        const value = take === remainingCoins
            ? remainingAmount
            : money((remainingAmount * take) / remainingCoins);

        allocations.push({
            lotId: lot.id,
            coins: take,
            amount: value,
            nextCoins: remainingCoins - take,
            nextAmount: money(remainingAmount - value)
        });

        // A lot is cash-backed only when its original verified amount is > 0.
        if (Number(lot.original_amount) > 0) paidCoins += take;
        needed -= take;
        eligibleAmount = money(eligibleAmount + value);
    }

    if (needed !== 0) {
        throw new Error('MAGP FIFO allocation failed; unlock transaction must be rolled back.');
    }

    for (const allocation of allocations) {
        await client.query(`
            UPDATE magp_paid_coin_lots
            SET remaining_coins = $1,
                remaining_amount = $2
            WHERE id = $3
        `, [allocation.nextCoins, allocation.nextAmount, allocation.lotId]);
    }

    const consumption = await client.query(`
        INSERT INTO magp_paid_coin_consumptions
            (user_id, author_id, source_type, source_reference,
             coins_spent, paid_coins_spent, eligible_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (source_type, source_reference) DO NOTHING
        RETURNING id
    `, [uid, aid, type, reference, coinCount, paidCoins, eligibleAmount]);

    if (!consumption.rows.length) {
        throw new Error('Duplicate MAGP coin consumption detected; unlock transaction must be rolled back.');
    }

    for (const allocation of allocations) {
        await client.query(`
            INSERT INTO magp_paid_coin_consumption_allocations
                (consumption_id, coin_lot_id, coins_consumed, eligible_amount)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (consumption_id, coin_lot_id) DO NOTHING
        `, [consumption.rows[0].id, allocation.lotId, allocation.coins, allocation.amount]);
    }

    if (eligibleAmount <= 0) {
        return { paidCoins, eligibleAmount: 0, platformShareAmount: 0, commission: 0 };
    }

    const referral = await client.query(`
        SELECT pr.id AS referral_id,
               pr.partner_id
        FROM partner_referrals pr
        JOIN partner_profiles pp ON pp.id = pr.partner_id
        WHERE pr.author_user_id = $1
          AND pr.status = 'approved'
          AND pp.status = 'active'
          AND (pr.attribution_start IS NULL OR pr.attribution_start <= NOW())
          AND pr.attribution_end >= NOW()
        ORDER BY pr.id DESC
        LIMIT 1
        FOR UPDATE OF pr
    `, [aid]);

    if (!referral.rows.length) {
        return { paidCoins, eligibleAmount, platformShareAmount: 0, commission: 0 };
    }

    const settings = await client.query(`
        SELECT platform_share
        FROM platform_settings
        ORDER BY id ASC
        LIMIT 1
    `);

    const platformShareRate = Number(settings.rows[0]?.platform_share);
    if (!Number.isFinite(platformShareRate) || platformShareRate < 0 || platformShareRate > 100) {
        throw new Error('A valid platform_share setting is required for MAGP commission calculation.');
    }

    const platformShareAmount = money(eligibleAmount * platformShareRate / 100);
    const commission = money(platformShareAmount * MAGP_COMMISSION_RATE / 100);

    if (commission > 0) {
        // Every automatically generated commission enters the admin review queue.
        // It is not payable until an administrator explicitly approves it.
        const ledgerStatus = 'pending';
        const ledgerNote = 'Automatically calculated from verified paid-coin value consumed on referred-author content. Awaiting administrator approval.';

        await client.query(`
            INSERT INTO partner_commission_ledger
                (partner_id, referral_id, source_type, source_reference,
                 gross_eligible_amount, platform_share_amount, commission_rate,
                 commission_amount, status, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (source_type, source_reference) DO NOTHING
        `, [
            referral.rows[0].partner_id,
            referral.rows[0].referral_id,
            type,
            reference,
            eligibleAmount,
            platformShareAmount,
            MAGP_COMMISSION_RATE,
            commission,
            ledgerStatus,
            ledgerNote
        ]);
    }

    return { paidCoins, eligibleAmount, platformShareAmount, commission };
}

module.exports = {
    recordPaidCoinLot,
    recordNonPaidCoinLot,
    recordMonetisedUnlock
};
