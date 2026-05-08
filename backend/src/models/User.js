const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firstName: { type: String, trim: true },
  lastName: { type: String, trim: true },
  email: { type: String, trim: true, lowercase: true },
  username: { type: String, required: true, unique: true, trim: true },
  password: { type: String, required: true },
  roles: { type: String, default: 'USER' },
  tokenVersion: { type: Number, default: 0 }
}, {
  timestamps: true
});

module.exports = mongoose.model('User', userSchema);
