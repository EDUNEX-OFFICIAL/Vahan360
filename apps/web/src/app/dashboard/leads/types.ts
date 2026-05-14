export interface VehicleStats {
  totalVehicles: number;
  totalTrips: number;
  totalWeight: number;
  sandTrips: number;
  stoneTrips: number;
  avgTripsPerVehicle: number;
}

export interface VehicleRecord {
  _id: string;
  vehicleRegNo: string;
  ownerName: string;
  mobileNo: string;
  totalTrips: number;
  totalMTWeight: number;
  sandTrips: number;
  stoneTrips: number;
  make?: string;
  model?: string;
  gvwKgs?: number;
  unladenWeightKgs?: number;
  vehicleCategory?: string;
  fatherName?: string;
  currentFullAddress?: string;
  currentPincode?: string;
  currentDistrict?: string;
  permanentFullAddress?: string;
  permanentPincode?: string;
  permanentDistrict?: string;
  insuranceCompany?: string;
  insurancePolicyNo?: string;
  insuranceDueDate?: string;
  permitValidUpto?: string;
  fitnessValidUpto?: string;
  pollutionValidUpto?: string;
  mvTaxPaidUpto?: string;
  leadSource?: string;
  offence?: string;
  panNumber?: string;
  panAddress?: string;
  gstin?: string;
  legalName?: string;
  gstTradeName?: string;
  gstContact?: string;
  gstEmail?: string;
  khananPhone?: string;
  customerType?: string;
  status?: string;
  nextFollowUp?: string;
  assignedExecutive?: string;
  createdAt?: string;
  updatedAt: string;
}

export interface NormalizedVehicle extends VehicleRecord {
  vehicleCategory: '2WN' | 'LMV' | 'LGV' | 'HGV';
  customerType: 'Individual' | 'Firm';
  currentFullAddress: string;
  fatherName: string;
  panNumber: string;
  insuranceCompany: string;
  insurancePolicyNo: string;
  permitValidUpto: string;
  fitnessValidUpto: string;
  pollutionValidUpto: string;
  leadSource: string;
}

export type FilterOperator = 'contains' | 'equals' | 'startsWith' | 'endsWith';

export interface LeadFilters {
  createdDate: string;
  insuranceFilterType: string;
  insuranceDateFilter: string;
  fitnessFilterType: string;
  fitnessDateFilter: string;
  puccFilterType: string;
  puccDateFilter: string;
  vehicleType: string;
  classType: string;
  grossWeight: string;
  vehicleAge: string;
  manufacturer: string;
  model: string;
  bodyType: string;
  norms: string;
  rtoOffice: string;
  mobileNumber: string;
  searchMobileNumber: string;
  searchOwnerName: string;
  searchPanNumber: string;
  ownershipSerialNo: string;
  vehicleFinancer: string;
  customerType: string;
  pincode: string;
  pincodePermanentAddress: string;
  presentState: string;
  presentDistrict: string;
  permanentState: string;
  permanentDistrict: string;
  ownerAddressType: string;
  minVehicleCount: string;
  ownerCustomerType: string;
}

export interface TableFilterState {
  column: string;
  operator: FilterOperator;
  value: string;
}

export interface ColumnDefinition {
  key: string;
  label: string;
}
