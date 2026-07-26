export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  APP_TIMEZONE?: string;
  REQUIRE_ACCESS?: string;

  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_SPREADSHEET_ID?: string;
  GOOGLE_SHEET_URL?: string;

  FREEMODEL_API_KEY?: string;
  FREEMODEL_MODEL?: string;
  FREEMODEL_BASE_URL?: string;
}

export interface ShiftRecord {
  id: string;
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  department: string;
  employee: string;
  employeeKey: string;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
}

export interface HinweisRecord {
  id: string;
  employee: string;
  employeeKey: string;
  date: string;
  text: string;
}

export interface StaffMemberRecord {
  id: string;
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  department: string;
  employee: string;
  employeeKey: string;
  hidden: boolean;
}

export interface ScannedShift {
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  department: string;
  employee: string;
  date: string;
  startTime: string;
  endTime: string;
  confidence?: number;
  source?: 'freemodel' | 'ocr' | 'merged';
}

export interface ScanShiftsRequest {
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  todayIso: string;
  directory: string;
  images: string[];
  ocrText?: string;
}

export interface ScanShiftsResponse {
  shifts: ScannedShift[];
  provider: string;
  warnings?: string[];
}