const mongoose = require('mongoose');

const vehicleTripSummarySchema = new mongoose.Schema({
  vehicleRegNo: { type: String, required: true, unique: true },
  totalTrips: { type: Number, default: 0 },
  totalMTWeight: { type: Number, default: 0 },
  sandTrips: { type: Number, default: 0 },
  sandMTWeight: { type: Number, default: 0 },
  stoneTrips: { type: Number, default: 0 },
  stoneMTWeight: { type: Number, default: 0 },
  ownerName: { type: String },
  mobileNo: { type: String },
  make: { type: String },
  model: { type: String },
  gvwKgs: { type: Number },
  unladenWeightKgs: { type: Number },
  vehicleCategory: { type: String },
  fatherName: { type: String },
  currentFullAddress: { type: String },
  currentPincode: { type: String },
  currentDistrict: { type: String },
  permanentFullAddress: { type: String },
  permanentPincode: { type: String },
  permanentDistrict: { type: String },
  insuranceCompany: { type: String },
  insurancePolicyNo: { type: String },
  insuranceDueDate: { type: Date },
  permitValidUpto: { type: Date },
  fitnessValidUpto: { type: Date },
  pollutionValidUpto: { type: Date },
  mvTaxPaidUpto: { type: Date },
  leadSource: { type: String },
  offence: { type: String },
  panNumber: { type: String },
  panAddress: { type: String },
  gstin: { type: String },
  legalName: { type: String },
  gstTradeName: { type: String },
  gstContact: { type: String },
  gstEmail: { type: String },
  khananPhone: { type: String },
  customerType: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'in-progress', 'completed'], 
    default: 'pending' 
  },
  nextFollowUp: { type: Date },
  assignedExecutive: { type: String }
}, {
  timestamps: true
});

// Indexes
vehicleTripSummarySchema.index({ ownerName: 1 });
vehicleTripSummarySchema.index({ status: 1 });
vehicleTripSummarySchema.index({ vehicleCategory: 1, customerType: 1 });
vehicleTripSummarySchema.index({ make: 1, model: 1 });
vehicleTripSummarySchema.index({ currentDistrict: 1, currentPincode: 1 });
vehicleTripSummarySchema.index({ permanentDistrict: 1, permanentPincode: 1 });
vehicleTripSummarySchema.index({ createdAt: -1 });
vehicleTripSummarySchema.index({ insuranceDueDate: 1 });
vehicleTripSummarySchema.index({ fitnessValidUpto: 1 });
vehicleTripSummarySchema.index({ pollutionValidUpto: 1 });
vehicleTripSummarySchema.index({ permitValidUpto: 1 });
vehicleTripSummarySchema.index({ nextFollowUp: 1 });
vehicleTripSummarySchema.index({ assignedExecutive: 1 });

module.exports = mongoose.model('VehicleTripSummary', vehicleTripSummarySchema);