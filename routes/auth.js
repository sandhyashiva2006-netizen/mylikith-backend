const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../db");

const router = express.Router();

router.post("/register", async (req, res) => {

try {

const { name, email, password } = req.body;

const hashedPassword =
await bcrypt.hash(password, 10);

const result = await db.query(

`
INSERT INTO users
(name,email,password)

VALUES($1,$2,$3)

RETURNING id,name,email
`,

[name,email,hashedPassword]

);

res.json({
success:true,
user:result.rows[0]
});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

router.post("/login", async (req,res)=>{

try{

const { email,password } = req.body;

const user = await db.query(

`
SELECT *
FROM users
WHERE email=$1
`,

[email]

);

if(user.rows.length===0){

return res.status(400).json({
message:"User not found"
});

}

const valid =
await bcrypt.compare(
password,
user.rows[0].password
);

if(!valid){

return res.status(400).json({
message:"Wrong password"
});

}

const token =
jwt.sign(

{
id:user.rows[0].id
},

process.env.JWT_SECRET,

{
expiresIn:"7d"
}

);

res.json({

success:true,

token,

user:{
id:user.rows[0].id,
name:user.rows[0].name,
email:user.rows[0].email
}

});

}

catch(err){

console.log(err);

res.status(500).json({
success:false
});

}

});

module.exports = router;