const assert = require('assert');
const {
  recordPaidCoinLot,
  recordNonPaidCoinLot,
  recordMonetisedUnlock
} = require('../routes/magp-commission-engine');

function makeClient({ duplicate = false, referral = true, lots = [], settings = [{ platform_share: '40' }] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      calls.push({ q, params });
      if (q.includes('FROM magp_paid_coin_consumptions')) return { rows: duplicate ? [{ id: 5 }] : [] };
      if (q.includes('FROM magp_paid_coin_lots')) return { rows: lots.map(x => ({ ...x })) };
      if (q.includes('INSERT INTO magp_paid_coin_consumptions')) return { rows: [{ id: 99 }] };
      if (q.includes('FROM partner_referrals')) return { rows: referral ? [{ referral_id: 7, partner_id: 3 }] : [] };
      if (q.includes('FROM platform_settings')) return { rows: settings };
      return { rows: [] };
    }
  };
}

(async () => {
  const creditClient = makeClient();
  await recordPaidCoinLot(creditClient, {
    userId: 10, walletTransactionId: 100, sourceReference: 'manual-payment:100', paidAmount: 100, paidCoins: 100
  });
  assert(creditClient.calls[0].q.includes('INSERT INTO magp_paid_coin_lots'));
  assert.deepStrictEqual(creditClient.calls[0].params.slice(3, 5), [100, 100]);

  const bonusClient = makeClient();
  await recordNonPaidCoinLot(bonusClient, {
    userId: 10, walletTransactionId: 101, sourceReference: 'manual-payment:100:bonus', coins: 25
  });
  assert(bonusClient.calls[0].q.includes('INSERT INTO magp_paid_coin_lots'));
  assert.strictEqual(bonusClient.calls[0].params[3], 25);
  assert(bonusClient.calls[0].q.includes('0, 0'));

  const lots = [
    { id: 1, original_amount: '100', remaining_coins: 100, remaining_amount: '100' },
    { id: 2, original_amount: '0', remaining_coins: 25, remaining_amount: '0' }
  ];
  const spendClient = makeClient({ lots });
  const result = await recordMonetisedUnlock(spendClient, {
    userId: 10, authorId: 20, coins: 110,
    sourceType: 'novel_chapter', sourceReference: 'novel_chapter:10:4'
  });
  assert.strictEqual(result.paidCoins, 100);
  assert.strictEqual(result.eligibleAmount, 100);
  assert.strictEqual(result.platformShareAmount, 40);
  assert.strictEqual(result.commission, 4);
  const commissionInsert = spendClient.calls.find(c => c.q.includes('INSERT INTO partner_commission_ledger'));
  assert(commissionInsert);
  assert.strictEqual(commissionInsert.params[8], 'pending');

  process.env.MAGP_TAX_REVIEW_COMPLETED = 'true';
  process.env.MAGP_REFUND_REVERSALS_READY = 'true';
  const reviewedClient = makeClient({ lots: [{ id: 3, original_amount: '20', remaining_coins: 20, remaining_amount: '20' }] });
  await recordMonetisedUnlock(reviewedClient, {
    userId: 15, authorId: 20, coins: 10,
    sourceType: 'novel_chapter', sourceReference: 'novel_chapter:15:6'
  });
  const reviewedInsert = reviewedClient.calls.find(c => c.q.includes('INSERT INTO partner_commission_ledger'));
  assert.strictEqual(reviewedInsert.params[8], 'pending');
  delete process.env.MAGP_TAX_REVIEW_COMPLETED;
  delete process.env.MAGP_REFUND_REVERSALS_READY;


  process.env.MAGP_TAX_REVIEW_COMPLETED = 'true';
  delete process.env.MAGP_REFUND_REVERSALS_READY;
  const holdClient = makeClient({ lots: [{ id: 4, original_amount: '20', remaining_coins: 20, remaining_amount: '20' }] });
  await recordMonetisedUnlock(holdClient, {
    userId: 16, authorId: 20, coins: 10,
    sourceType: 'novel_chapter', sourceReference: 'novel_chapter:16:7'
  });
  const holdInsert = holdClient.calls.find(c => c.q.includes('INSERT INTO partner_commission_ledger'));
  assert.strictEqual(holdInsert.params[8], 'pending');
  delete process.env.MAGP_TAX_REVIEW_COMPLETED;

  const shortageClient = makeClient({ lots: [{ id: 1, original_amount: '50', remaining_coins: 50, remaining_amount: '50' }] });
  await assert.rejects(() => recordMonetisedUnlock(shortageClient, {
    userId: 11, authorId: 20, coins: 51,
    sourceType: 'audio_chapter', sourceReference: 'audio_chapter:11:9'
  }), /MAGP coin reconciliation required/);

  const duplicateClient = makeClient({ duplicate: true });
  await assert.rejects(() => recordMonetisedUnlock(duplicateClient, {
    userId: 12, authorId: 20, coins: 1,
    sourceType: 'original_chapter', sourceReference: 'original_chapter:12:3'
  }), /Duplicate MAGP coin consumption detected/);
  assert(!duplicateClient.calls.some(c => c.q.includes('UPDATE magp_paid_coin_lots')));

  console.log('MAGP engine tests passed: paid/bonus credit, FIFO allocation, platform share, commission, shortage fail-safe, duplicate protection, and tax-review payout hold.');
})().catch(err => { console.error(err); process.exit(1); });
