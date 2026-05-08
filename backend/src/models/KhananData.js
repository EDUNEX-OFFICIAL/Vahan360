const mongoose = require('mongoose');

const khananDataSchema = new mongoose.Schema({
  district: { type: String, required: true },
  consignerName: { type: String, required: true },
  date: { type: String, required: true },
  sourceType: { type: String, required: true },
  consigneeName: { type: String, required: true },
  challanNo: { type: String, required: true },
  mineralName: { type: String, required: true },
  mineralCategory: { type: String, required: true },
  vehicleRegNo: { type: String, required: true },
  destination: { type: String, required: true },
  transportedDate: { type: String, required: true },
  quantity: { type: String, required: true },
  unit: { type: String, required: true },
  checkStatus: { type: String, default: 'Pending' }
}, {
  timestamps: true
});

// Indexes for better query performance
khananDataSchema.index({ district: 1, date: 1 });
khananDataSchema.index({ challanNo: 1 }, { unique: true });
khananDataSchema.index({ vehicleRegNo: 1 });

module.exports = mongoose.model('KhananData', khananDataSchema);