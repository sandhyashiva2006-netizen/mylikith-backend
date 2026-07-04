const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("../db");

const router = express.Router();

const { requireFields } = require("../utils/validate");

router.post("/register", async (req, res) => {

const validation = requireFields(req.body, [
    "name",
    "email",
    "password"
]);

if (!validation.success) {

    return res.status(400).json({
        success: false,
        message: `${validation.field} is required.`
    });

}

try {

const { name, email, password } = req.body;

const existing = await db.query(

`
SELECT id
FROM users
WHERE email=$1
`,

[email]

);

if(existing.rows.length){

return res.status(400).json({

success:false,

message:"Email already registered."

});

}

const hashedPassword =
await bcrypt.hash(password, 10);

const result = await db.query(

`
INSERT INTO users
(name,email,password_hash)

VALUES($1,$2,$3)

RETURNING
id,
name,
email,
role
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

const validation = requireFields(req.body, [
    "email",
    "password"
]);

if (!validation.success) {

    return res.status(400).json({
        success: false,
        message: `${validation.field} is required.`
    });

}

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
user.rows[0].password_hash
);

if(!valid){

return res.status(400).json({
message:"Wrong password"
});

}

const token =
jwt.sign(

{
id:user.rows[0].id,
role:user.rows[0].role
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

email:user.rows[0].email,

role:user.rows[0].role

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