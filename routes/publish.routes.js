const express=require("express");
const router=express.Router();
const pool=require("../db");

router.get("/:id",async(req,res)=>{

try{

const {rows}=await pool.query(

`SELECT * FROM novels WHERE id=$1`,

[req.params.id]

);

res.json(rows[0]);

}catch(err){

res.status(500).json({error:err.message});

}

});

router.put("/:id",async(req,res)=>{

const{

visibility,

mature,

allow_comments

}=req.body;

try{

await pool.query(

`UPDATE novels

SET

visibility=$1,

mature=$2,

allow_comments=$3

WHERE id=$4`,

[

visibility,

mature,

allow_comments,

req.params.id

]

);

res.json({success:true});

}catch(err){

res.status(500).json({error:err.message});

}

});

router.post("/:id/publish",async(req,res)=>{

try{

await pool.query(

`UPDATE novels

SET

publish_status='published',

published_at=NOW()

WHERE id=$1`,

[req.params.id]

);

res.json({success:true});

}catch(err){

res.status(500).json({error:err.message});

}

});

module.exports=router;
