const express=require("express");

const router=express.Router();

const db=require("../db");

router.get("/:userId",async(req,res)=>{

try{

const result=await db.query(

`
SELECT

COUNT(*) AS total_referrals,

COALESCE(SUM(reward_coins),0) AS coins_earned

FROM referrals

WHERE

referrer_id=$1

AND

status='Completed'
`,

[
req.params.userId
]

);

res.json(result.rows[0]);

}catch(err){

console.log(err);

res.status(500).json({

success:false

});

}

});

module.exports=router;