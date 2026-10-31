const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const crypto = require('crypto');

router.use(auth);
const clean = (v, max=2000) => String(v || '').trim().slice(0, max);

router.post('/apply', async (req, res) => {
  const motivation = clean(req.body.motivation, 3000);
  if (req.body.accept_terms !== true) return res.status(400).json({success:false,message:'Please accept the programme terms.'});
  if (!motivation) return res.status(400).json({success:false,message:'Please tell us why you want to join.'});
  try {
    const userId = req.user.id;
    const existing = await db.query('SELECT status FROM partner_applications WHERE user_id=$1', [userId]);
    if (existing.rows[0]?.status === 'pending') return res.status(409).json({success:false,message:'Your application is already under review.'});
    if (existing.rows[0]?.status === 'approved') return res.status(409).json({success:false,message:'You are already an approved Author Growth Partner.'});
    await db.query(`INSERT INTO partner_applications(user_id,phone,language_focus,experience,motivation,social_links,status,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,'pending',NOW()) ON CONFLICT(user_id) DO UPDATE SET phone=EXCLUDED.phone,language_focus=EXCLUDED.language_focus,experience=EXCLUDED.experience,motivation=EXCLUDED.motivation,social_links=EXCLUDED.social_links,status='pending',admin_note=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=NOW()`,
      [userId,clean(req.body.phone,30),clean(req.body.language_focus,100)||'Telugu',clean(req.body.experience,2000),motivation,clean(req.body.social_links,1000)]);
    const version = 'MAGP-1.0';
    await db.query('INSERT INTO partner_policy_acceptances(user_id,policy_version,ip_address) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[userId,version,req.ip]);
    res.status(201).json({success:true,message:'Application submitted successfully.'});
  } catch(e) { console.error('Partner application:',e); res.status(500).json({success:false,message:'Unable to submit application.'}); }
});

router.post('/attribute',async(req,res)=>{const partnerCode=clean(req.body.partner_code,24).toUpperCase();if(!partnerCode)return res.status(400).json({success:false,message:'Partner code is required.'});try{const user=await db.query('SELECT id,role FROM users WHERE id=$1',[req.user.id]);if(!user.rows.length||user.rows[0].role!=='writer')return res.status(403).json({success:false,message:'Only registered writer accounts can submit partner attribution.'});const p=await db.query("SELECT id,user_id,partner_code FROM partner_profiles WHERE partner_code=$1 AND status='active'",[partnerCode]);if(!p.rows.length)return res.status(404).json({success:false,message:'Partner code not found.'});if(Number(p.rows[0].user_id)===Number(req.user.id))return res.status(400).json({success:false,message:'Self-referrals are not permitted.'});const r=await db.query(`INSERT INTO partner_referrals(partner_id,author_user_id,referral_code,attribution_end,status) VALUES($1,$2,$3,NOW()+INTERVAL '12 months','pending') RETURNING id,status`,[p.rows[0].id,req.user.id,p.rows[0].partner_code]);res.status(201).json({success:true,referral:r.rows[0],message:'Partner attribution submitted for review.'});}catch(e){if(e.code==='23505')return res.status(409).json({success:false,message:'This writer account already has a partner attribution.'});console.error(e);res.status(500).json({success:false});}});

router.get('/me', async (req,res) => {
  try {
    const p = await db.query(`SELECT pp.*,u.name,u.email FROM partner_profiles pp JOIN users u ON u.id=pp.user_id WHERE pp.user_id=$1`,[req.user.id]);
    const a = await db.query('SELECT status,admin_note,created_at,reviewed_at FROM partner_applications WHERE user_id=$1',[req.user.id]);
    if (!p.rows.length) return res.json({success:true,approved:false,application:a.rows[0]||null});
    const profile=p.rows[0];
    const [refs, ledger, payouts] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='approved')::int AS approved FROM partner_referrals WHERE partner_id=$1`,[profile.id]),
      db.query(`
        WITH commission_totals AS (
          SELECT
            COALESCE(SUM(commission_amount) FILTER (WHERE status IN ('pending','approved')),0) AS total,
            COALESCE(SUM(commission_amount) FILTER (WHERE status='pending'),0) AS pending_commission,
            COALESCE(SUM(commission_amount) FILTER (WHERE status='approved'),0) AS approved_commission
          FROM partner_commission_ledger WHERE partner_id=$1
        ), payout_totals AS (
          SELECT
            COALESCE((SELECT SUM(pa.allocated_amount)
              FROM partner_payout_allocations pa JOIN partner_payouts po ON po.id=pa.payout_id
              WHERE po.partner_id=$1 AND po.status='paid'),0) AS paid,
            COALESCE((SELECT SUM(amount) FROM partner_payouts
              WHERE partner_id=$1 AND status IN ('pending','approved')),0) AS reserved
        )
        SELECT ct.total, ct.pending_commission, ct.approved_commission,
          GREATEST(ct.approved_commission-pt.paid,0) AS unpaid,
          pt.paid, pt.reserved,
          GREATEST(ct.approved_commission-pt.paid-pt.reserved,0) AS available
        FROM commission_totals ct CROSS JOIN payout_totals pt
      `,[profile.id]),
      db.query(`SELECT id,amount,status,requested_at,processed_at,payment_reference FROM partner_payouts WHERE partner_id=$1 ORDER BY id DESC LIMIT 20`,[profile.id])
    ]);
    res.json({success:true,approved:true,profile,referrals:refs.rows[0],commissions:ledger.rows[0],payouts:payouts.rows});
  } catch(e) { console.error('Partner dashboard:',e); res.status(500).json({success:false}); }
});

router.post('/payout-request', async(req,res)=>{
  const amount=Number(req.body.amount);
  if (!Number.isFinite(amount)||amount<500) return res.status(400).json({success:false,message:'Minimum payout request is ₹500.'});
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    const p=await client.query("SELECT id FROM partner_profiles WHERE user_id=$1 AND status='active' FOR UPDATE",[req.user.id]);
    if(!p.rows.length){await client.query('ROLLBACK');return res.status(403).json({success:false,message:'Active partner account required.'});}
    const pid=p.rows[0].id;
    const bal=await client.query(`
      SELECT
        COALESCE((SELECT SUM(commission_amount) FROM partner_commission_ledger WHERE partner_id=$1 AND status='approved'),0)
        - COALESCE((SELECT SUM(pa.allocated_amount) FROM partner_payout_allocations pa JOIN partner_payouts po ON po.id=pa.payout_id WHERE po.partner_id=$1 AND po.status='paid'),0)
        - COALESCE((SELECT SUM(amount) FROM partner_payouts WHERE partner_id=$1 AND status IN ('pending','approved')),0)
        AS available
    `,[pid]);
    const available=Number(bal.rows[0].available);
    if(amount>available){await client.query('ROLLBACK');return res.status(400).json({success:false,message:`Available approved balance is ₹${Math.max(0,available).toFixed(2)}.`});}
    await client.query("INSERT INTO partner_payouts(partner_id,amount) VALUES($1,$2)",[pid,amount]);
    await client.query('COMMIT'); res.status(201).json({success:true,message:'Payout request submitted.'});
  } catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({success:false});} finally{client.release();}
});

module.exports=router;
