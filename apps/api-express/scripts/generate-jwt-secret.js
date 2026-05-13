#!/usr/bin/env node
const crypto = require("crypto");
// 48 bytes => ~64 char base64, well above the 32-char production minimum
console.log(crypto.randomBytes(48).toString("base64"));
