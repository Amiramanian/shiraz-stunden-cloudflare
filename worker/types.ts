export interface Env extends Cloudflare.Env {
  REQUIRE_ACCESS?: string;
  APP_PIN: string;
  LOGIN_RATE_LIMITER: RateLimit;

  GOOGLE_CLIENT_EMAIL: string;
  GOOGLE_PRIVATE_KEY: string;

  GEMINI_API_KEY: string;
  GROQ_API_KEY: string;
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
  source?: 'gemini' | 'ocr' | 'merged' | 'manual';
}

export interface ScanShiftsRequest {
  business: 'Shiraz' | 'Djadoo' | 'Catering';
  todayIso: string;
  directory: string;
  images: string[];
  imageNames?: string[];
  ocrTexts?: string[];
}

export interface ScanShiftsResponse {
  shifts: ScannedShift[];
  provider: string;
  warnings?: string[];
  manualFallback?: boolean;
}

export interface ScanCorrectionShift {
  employee?: string;
  department?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
}

export interface ScanCorrectionInput {
  rawEmployee: string;
  suggestedEmployee?: string;
  rawDepartment?: string;
  original?: ScanCorrectionShift;
  final: ScanCorrectionShift & {
    employee: string;
    department: string;
  };
}
