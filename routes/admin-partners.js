const express=require('express');
const router=express.Router();
const db=require('../db');
const auth=require('../middleware/auth');
router.use(auth,(req,res,next)=>{if(req.user.role!=='admin')return res.status(403).json({success:false,message:'Admin access required.'});next();});
const code=()=>`MAGP${Math.random().toString(36).slice(2,8).toUpperCase()}`;

router.get('/applications',async(req,res)=>{try{const r=await db.query(`SELECT a.*,u.name,u.email FROM partner_applications a JOIN users u ON u.id=a.user_id ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END,a.created_at DESC`);res.json({success:true,applications:r.rows});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.post('/applications/:id/decision',async(req,res)=>{
 const status=req.body.status; if(!['approved','rejected'].includes(status))return res.status(400).json({success:false,message:'Invalid decision.'});
 const client=await db.connect();try{await client.query('BEGIN');const a=await client.query('SELECT * FROM partner_applications WHERE id=$1 FOR UPDATE',[req.params.id]);if(!a.rows.length){await client.query('ROLLBACK');return res.status(404).json({success:false,message:'Application not found.'});}
 const app=a.rows[0];await client.query('UPDATE partner_applications SET status=$1,admin_note=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW() WHERE id=$4',[status,String(req.body.admin_note||'').slice(0,2000),req.user.id,app.id]);
 if(status==='approved') {let referralCode=code();for(let i=0;i<5;i++){const exists=await client.query('SELECT 1 FROM partner_profiles WHERE partner_code=$1',[referralCode]);if(!exists.rows.length)break;referralCode=code();}await client.query(`INSERT INTO partner_profiles(user_id,partner_code) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET status='active'`,[app.user_id,referralCode]);}
 await client.query('COMMIT');res.json({success:true,message:`Application ${status}.`});
 }catch(e){await client.query('ROLLBACK');console.error(e);res.status(500).json({success:false});}finally{client.release();}});
router.get('/list',async(req,res)=>{try{const r=await db.query(`SELECT pp.*,u.name,u.email,(SELECT COUNT(*) FROM partner_referrals pr WHERE pr.partner_id=pp.id) AS referrals,(SELECT COALESCE(SUM(commission_amount),0) FROM partner_commission_ledger cl WHERE cl.partner_id=pp.id) AS commissions FROM partner_profiles pp JOIN users u ON u.id=pp.user_id ORDER BY pp.created_at DESC`);res.json({success:true,partners:r.rows});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.get('/referrals',async(req,res)=>{try{const r=await db.query(`SELECT pr.*,u.name AS author_name,u.email AS author_email,pp.partner_code,pu.name AS partner_name FROM partner_referrals pr JOIN users u ON u.id=pr.author_user_id JOIN partner_profiles pp ON pp.id=pr.partner_id JOIN users pu ON pu.id=pp.user_id ORDER BY CASE pr.status WHEN 'pending' THEN 0 ELSE 1 END,pr.created_at DESC`);res.json({success:true,referrals:r.rows});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.post('/referrals/:id/decision',async(req,res)=>{const status=req.body.status;if(!['approved','rejected'].includes(status))return res.status(400).json({success:false,message:'Invalid referral decision.'});try{const r=await db.query(`UPDATE partner_referrals SET status=$1::varchar,admin_note=$2,attribution_start=CASE WHEN $1::varchar='approved' THEN NOW() ELSE attribution_start END,attribution_end=CASE WHEN $1::varchar='approved' THEN NOW()+INTERVAL '12 months' ELSE attribution_end END WHERE id=$3 AND status='pending' RETURNING *`,[status,String(req.body.admin_note||'').slice(0,1000),req.params.id]);if(!r.rows.length)return res.status(404).json({success:false,message:'Pending referral not found.'});res.json({success:true,referral:r.rows[0]});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.post('/referrals',async(req,res)=>{const partnerId=Number(req.body.partner_id),authorId=Number(req.body.author_user_id);if(!partnerId||!authorId)return res.status(400).json({success:false,message:'Partner and author are required.'});try{const p=await db.query("SELECT id,partner_code FROM partner_profiles WHERE id=$1 AND status='active'",[partnerId]);if(!p.rows.length)return res.status(404).json({success:false,message:'Active partner not found.'});const r=await db.query(`INSERT INTO partner_referrals(partner_id,author_user_id,referral_code,attribution_end,status) VALUES($1,$2,$3,NOW()+INTERVAL '12 months','approved') RETURNING *`,[partnerId,authorId,p.rows[0].partner_code]);res.status(201).json({success:true,referral:r.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({success:false,message:'This author already has a partner attribution.'});console.error(e);res.status(500).json({success:false});}});
// Audited admin posting: platform_share_amount must be the realised, reconciled share, never coin purchase value.
router.post('/commissions',async(req,res)=>{const ledgerStatus=process.env.MAGP_TAX_REVIEW_COMPLETED==='true'?'pending':'pending_tax_review';const partnerId=Number(req.body.partner_id),referralId=Number(req.body.referral_id),platformShare=Number(req.body.platform_share_amount),gross=Number(req.body.gross_eligible_amount||0);const sourceType=String(req.body.source_type||'').slice(0,40),sourceRef=String(req.body.source_reference||'').slice(0,120);if(!partnerId||!referralId||!sourceType||!sourceRef||!Number.isFinite(platformShare)||platformShare<0||!Number.isFinite(gross)||gross<0)return res.status(400).json({success:false,message:'Valid source and amounts are required.'});try{const p=await db.query("SELECT id,commission_rate FROM partner_profiles WHERE id=$1 AND status='active'",[partnerId]);if(!p.rows.length)return res.status(404).json({success:false,message:'Active partner not found.'});const referral=await db.query(`SELECT id FROM partner_referrals WHERE id=$1 AND partner_id=$2 AND status='approved' AND NOW() BETWEEN attribution_start AND attribution_end`,[referralId,partnerId]);if(!referral.rows.length)return res.status(400).json({success:false,message:'Approved, in-period author attribution is required.'});const rate=Number(p.rows[0].commission_rate),commission=Number((platformShare*rate/100).toFixed(2));const r=await db.query(`INSERT INTO partner_commission_ledger(partner_id,referral_id,source_type,source_reference,gross_eligible_amount,platform_share_amount,commission_rate,commission_amount,status,notes,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[partnerId,referralId,sourceType,sourceRef,gross,platformShare,rate,commission,ledgerStatus,String(req.body.notes||'').slice(0,1000),req.user.id]);res.status(201).json({success:true,commission:r.rows[0]});}catch(e){if(e.code==='23505')return res.status(409).json({success:false,message:'A commission entry already exists for this source reference.'});console.error(e);res.status(500).json({success:false});}});
router.get('/commissions',async(req,res)=>{try{const r=await db.query(`SELECT cl.*,pp.partner_code,u.name AS partner_name,pr.author_user_id,au.name AS author_name FROM partner_commission_ledger cl JOIN partner_profiles pp ON pp.id=cl.partner_id JOIN users u ON u.id=pp.user_id LEFT JOIN partner_referrals pr ON pr.id=cl.referral_id LEFT JOIN users au ON au.id=pr.author_user_id ORDER BY cl.created_at DESC LIMIT 500`);res.json({success:true,commissions:r.rows});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.post('/commissions/:id/decision',async(req,res)=>{const status=req.body.status;if(!['approved','reversed'].includes(status))return res.status(400).json({success:false,message:'Invalid commission decision.'});if(status==='approved'&&(process.env.MAGP_TAX_REVIEW_COMPLETED!=='true'||process.env.MAGP_REFUND_REVERSALS_READY!=='true'))return res.status(409).json({success:false,message:'Commission approval is locked until tax review and refund-reversal handling are confirmed.'});try{const r=await db.query(`UPDATE partner_commission_ledger SET status=$1,notes=CONCAT(COALESCE(notes,''),CASE WHEN $2<>'' THEN E'\n' || $2 ELSE '' END) WHERE id=$3 AND status='pending' RETURNING *`,[status,String(req.body.notes||'').slice(0,1000),req.params.id]);if(!r.rows.length)return res.status(404).json({success:false,message:'Pending commission not found.'});res.json({success:true,commission:r.rows[0]});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.get('/payouts',async(req,res)=>{try{const r=await db.query(`SELECT po.*,u.name,u.email,pp.partner_code FROM partner_payouts po JOIN partner_profiles pp ON pp.id=po.partner_id JOIN users u ON u.id=pp.user_id ORDER BY po.requested_at DESC`);res.json({success:true,payouts:r.rows});}catch(e){console.error(e);res.status(500).json({success:false});}});
router.post('/payouts/:id/decision',async(req,res)=>{
 const status=req.body.status;
 if(!['approved','paid','rejected'].includes(status))return res.status(400).json({success:false,message:'Invalid payout status.'});
 if((status==='approved'||status==='paid')&&(process.env.MAGP_TAX_REVIEW_COMPLETED!=='true'||process.env.MAGP_REFUND_REVERSALS_READY!=='true'))return res.status(409).json({success:false,message:'Partner payout processing is locked until tax review and refund-reversal handling are confirmed.'});
 const client=await db.connect();
 try{
  await client.query('BEGIN');
  // Serialize all payout state changes for this partner. Payout requests lock this
  // same profile row before calculating the available balance.
  const owner=await client.query('SELECT partner_id FROM partner_payouts WHERE id=$1',[req.params.id]);
  if(!owner.rows.length){await client.query('ROLLBACK');return res.status(404).json({success:false,message:'Payout not found.'});}
  await client.query('SELECT id FROM partner_profiles WHERE id=$1 FOR UPDATE',[owner.rows[0].partner_id]);
  const found=await client.query('SELECT * FROM partner_payouts WHERE id=$1 FOR UPDATE',[req.params.id]);
  if(!found.rows.length||!['pending','approved'].includes(found.rows[0].status)){
   await client.query('ROLLBACK');
   return res.status(404).json({success:false,message:'Payout not found or already processed.'});
  }
  const po=found.rows[0];
  if(status==='paid'){
   // Other pending/approved payouts reserve their amounts. Do not let this payment
   // consume funds already reserved for another payout request.
   const capacity=await client.query(`
    SELECT
      COALESCE((SELECT SUM(commission_amount) FROM partner_commission_ledger WHERE partner_id=$1 AND status='approved'),0)
      - COALESCE((SELECT SUM(pa.allocated_amount) FROM partner_payout_allocations pa JOIN partner_payouts p2 ON p2.id=pa.payout_id WHERE p2.partner_id=$1 AND p2.status='paid'),0)
      - COALESCE((SELECT SUM(amount) FROM partner_payouts WHERE partner_id=$1 AND id<>$2 AND status IN ('pending','approved')),0)
      AS available_for_this_payout
   `,[po.partner_id,po.id]);
   if(Number(capacity.rows[0].available_for_this_payout)+0.001<Number(po.amount)){
    await client.query('ROLLBACK');
    return res.status(400).json({success:false,message:'Insufficient unreserved approved commission balance to mark this payout paid.'});
   }
   let remaining=Number(Number(po.amount).toFixed(2));
   const items=await client.query(`
    SELECT cl.id,
      cl.commission_amount-COALESCE((SELECT SUM(pa.allocated_amount)
        FROM partner_payout_allocations pa JOIN partner_payouts p2 ON p2.id=pa.payout_id
        WHERE pa.commission_id=cl.id AND p2.status='paid'),0) AS available
    FROM partner_commission_ledger cl
    WHERE cl.partner_id=$1 AND cl.status='approved'
    ORDER BY cl.created_at,cl.id
    FOR UPDATE
   `,[po.partner_id]);
   for(const item of items.rows){
    if(remaining<=0.001)break;
    const available=Number(item.available);
    if(available<=0.001)continue;
    const use=Number(Math.min(available,remaining).toFixed(2));
    if(use<=0)continue;
    await client.query('INSERT INTO partner_payout_allocations(payout_id,commission_id,allocated_amount) VALUES($1,$2,$3)',[po.id,item.id,use]);
    remaining=Number((remaining-use).toFixed(2));
   }
   if(remaining>0.001){
    await client.query('ROLLBACK');
    return res.status(400).json({success:false,message:'Unable to allocate the full payout from approved commissions.'});
   }
  }
  const updated=await client.query(`
   UPDATE partner_payouts SET status=$1,payment_reference=$2,admin_note=$3,processed_by=$4,
    processed_at=CASE WHEN $1 IN ('paid','rejected') THEN NOW() ELSE processed_at END
   WHERE id=$5 RETURNING *
  `,[status,String(req.body.payment_reference||'').slice(0,120),String(req.body.admin_note||'').slice(0,1000),req.user.id,po.id]);
  await client.query('COMMIT');
  res.json({success:true,payout:updated.rows[0]});
 }catch(e){
  await client.query('ROLLBACK');
  console.error('Partner payout decision:',e);
  res.status(500).json({success:false,message:'Unable to update payout.'});
 }finally{client.release();}
});
module.exports=router;
